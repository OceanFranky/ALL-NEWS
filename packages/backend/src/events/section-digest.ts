// World event summaries use current, publicly readable evidence and the section's own prompt/model.
import { z } from "zod";
import { sql } from "../db.ts";
import { sectionContext } from "../sections/context.ts";
import { sectionModelFor } from "../editorial/models.ts";
import { assertSectionResource } from "../sections/resources.ts";
import { chatJson } from "../providers/llm.ts";
import { completeReceipt } from "../providers/receipts.ts";
import { digestFactEvidence, digestInputsHash, digestReports } from "../publication/story-evidence.ts";

const Digest = z.strictObject({ digest:z.string().max(2000),latest:z.string().max(300) });

export async function composeWorldStoryDigest(storyId:number):Promise<{ updated:boolean;version?:number }> {
  if(!Number.isSafeInteger(storyId) || storyId<1) throw new Error("invalid world story id");
  await sql.begin(tx=>assertSectionResource(tx,"world",{ kind:"story",id:storyId }));
  const [story]=await sql<{ title:string;digest:string|null;version:number }[]>`
    SELECT title,digest,version FROM stories WHERE section_id='world' AND id=${storyId} AND merged_into IS NULL`;
  if(!story) return { updated:false };
  const reports=(await digestReports(sql,[storyId],new Date(),"world")).sort((a,b)=>a.at.getTime()-b.at.getTime() || a.id.localeCompare(b.id));
  if(!reports.length) {
    const cleared=await sql`UPDATE stories SET digest=NULL,latest=NULL,digest_updated_at=NULL,updated_at=now()
      WHERE section_id='world' AND id=${storyId} AND version=${story.version} AND (digest IS NOT NULL OR latest IS NOT NULL)`;
    return { updated:cleared.count>0 };
  }
  const ids=reports.map(r=>r.id).sort(),inputsHash=digestInputsHash(reports);
  const [last]=await sql<{ inputs_hash:string|null;digest:string;latest:string|null;receipt_id:number|null }[]>`
    SELECT inputs_hash,digest,latest,receipt_id FROM story_digests WHERE story_id=${storyId} ORDER BY version DESC LIMIT 1`;
  if(last?.inputs_hash===inputsHash && story.digest===last.digest) return { updated:false };
  const rules=sectionContext("world");
  const user=JSON.stringify({ eventTitle:story.title,reports:reports.slice(-40).map(r=>({
    id:r.id,at:r.at.toISOString(),title:r.title,summary:r.summary,source:r.source_name,factId:r.fact_id,
    evidence:digestFactEvidence(r),
  })) });
  const result=last?.inputs_hash===inputsHash ? { data:{ digest:last.digest,latest:last.latest ?? "" },receiptId:last.receipt_id } : await chatJson({
    sectionId:"world",resource:{ kind:"story",id:storyId },model:await sectionModelFor(rules,"digest"),
    purpose:"world.story-digest",subject:`story:${storyId}`,promptVersion:rules.prompts.version("story-digest"),
    system:rules.prompts.text("story-digest"),user,schema:Digest,temperature:0.2,maxTokens:1200,
  });
  const version=story.version+1;
  const updated=await sql.begin(async tx=>{
    const [current]=await tx<{ version:number;merged_into:number|null }[]>`SELECT version,merged_into FROM stories
      WHERE section_id='world' AND id=${storyId} FOR UPDATE`;
    if(!current || current.version!==story.version || current.merged_into!==null
      || digestInputsHash(await digestReports(tx,[storyId],new Date(),"world"))!==inputsHash) {
      if(result.receiptId!==null) await completeReceipt(tx,result.receiptId,"world");
      return false;
    }
    await tx`INSERT INTO story_digests (story_id,version,digest,latest,receipt_id,article_ids,inputs_hash)
      VALUES (${storyId},${version},${result.data.digest},${result.data.latest},${result.receiptId},${ids},${inputsHash})`;
    await tx`UPDATE stories SET digest=${result.data.digest},latest=${result.data.latest},digest_updated_at=now(),
      version=${version},updated_at=now() WHERE section_id='world' AND id=${storyId}`;
    if(result.receiptId!==null) await completeReceipt(tx,result.receiptId,"world");
    return true;
  });
  return updated ? { updated:true,version } : { updated:false };
}
