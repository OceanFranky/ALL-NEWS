import { requireSectionId,type SectionId } from '@aihot/contracts/sections';
import { sql } from '../db.ts';

export async function listSectionEvents(sectionId:SectionId,q='',limit=100) {
  requireSectionId(sectionId);
  if(q.length>500 || !Number.isSafeInteger(limit) || limit<1 || limit>100) throw new Error('invalid event filters');
  const term=q.trim().replace(/[\\%_]/g,m=>`\\${m}`);
  return { sectionId,rows:await sql`SELECT st.id,st.public_id,st.title,st.version,st.origin,st.latest_at,
    (SELECT count(*)::int FROM facts f WHERE f.section_id=st.section_id AND f.story_id=st.id) AS fact_count
    FROM stories st WHERE st.section_id=${sectionId} AND st.merged_into IS NULL
      AND (${term}='' OR st.title ILIKE ${`%${term}%`}) ORDER BY st.latest_at DESC NULLS LAST,st.id DESC LIMIT ${limit}` };
}
export async function sectionEventDetail(sectionId:SectionId,id:number) {
  requireSectionId(sectionId);
  if(!Number.isSafeInteger(id) || id<=0) throw new Error('invalid story id');
  const [story]=await sql`SELECT id,public_id,title,version,origin,merged_into,first_report_at,latest_at
    FROM stories WHERE section_id=${sectionId} AND id=${id}`;
  if(!story) return null;
  const facts=await sql`SELECT id,public_id,title,occurred_at,version FROM facts WHERE section_id=${sectionId} AND story_id=${id} ORDER BY created_at,id`;
  const reports=await sql`SELECT fa.fact_id,fa.article_id,fa.role,fa.manual,a.title,a.revision,a.grouping_status
    FROM fact_articles fa JOIN facts f ON f.id=fa.fact_id AND f.section_id=fa.section_id
      JOIN articles a ON a.id=fa.article_id AND a.section_id=fa.section_id
    WHERE fa.section_id=${sectionId} AND f.story_id=${id} ORDER BY fa.created_at,fa.article_id`;
  return { sectionId,story,facts,reports };
}
