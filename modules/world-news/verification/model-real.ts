// Opt-in paid verification on an owned Docker test database. Re-runs retain the same 5-CNY ledger.
import { existsSync,readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import { parseTrialOptions } from './trial-options.ts';

const { target,articleIds }=parseTrialOptions(process.argv.slice(2),process.env.DATABASE_URL ?? 'postgres://unset/unset');
// Load only the existing model fields, never database/runtime switches or output credentials.
if(existsSync('.env')) {
  const values=parseEnv(readFileSync('.env','utf8'));
  for(const key of ['LLM_BASE_URL','LLM_API_KEY','LLM_MODEL','LLM_EXTRA_JSON','LLM_REASONING_TOKENS','LLM_JSON_MODE'])
    if(process.env[key]===undefined && values[key]!==undefined) process.env[key]=values[key];
}
if(process.env.LLM_MODEL!=='deepseek-flash' || new URL(process.env.LLM_BASE_URL ?? 'https://unset.invalid').hostname!=='api.deepseek.com')
  throw new Error('The verified price reservation covers only the existing official deepseek-flash configuration');
if(!process.env.LLM_API_KEY) throw new Error('Existing model key is missing');
process.env.MODEL_CALLS_ENABLED='true';process.env.COLLECT_ENABLED=articleIds ? 'false' : 'true';
process.env.FEISHU_CONTENT_PUSH_ENABLED='false';process.env.INDEXNOW_SUBMIT_ENABLED='false';
process.env.AIHOT_CREDENTIALS_DIR='/nonexistent-test-credentials';

const { default:postgres }=await import('postgres');
const adminUrl=new URL(target);adminUrl.pathname='/postgres';
const admin=postgres(adminUrl.toString(),{ max:1,onnotice:()=>{} });
try {
  if(!(await admin`SELECT 1 FROM pg_database WHERE datname='world_real_trial_test'`).length) {
    if(articleIds) throw new Error('Selected-material trial requires the existing database and cumulative ledger');
    await admin`CREATE DATABASE world_real_trial_test`;
  }
} finally { await admin.end(); }
const { sql,closeDb }=await import('@aihot/backend/db');
const { runMigrations }=await import('../../../scripts/migrate.ts');
const { installModules }=await import('@aihot/backend/modules');
const { worldNewsModule }=await import('../server.ts');
const { installWorldSources,WORLD_SOURCES }=await import('../sources.ts');
const { collectSectionSource }=await import('@aihot/backend/sources/section-collect');
const { runWorldAnalysisTask,runWorldGroupTask }=await import('../jobs.ts');
const { stopBoss }=await import('@aihot/backend/jobs/queue');
const { SectionMoneyPolicy }=await import('@aihot/backend/providers/section-money');

try {
  if(!articleIds) await runMigrations(sql,fileURLToPath(new URL('../../../',import.meta.url)));
  installModules([worldNewsModule]);
  const [previous]=await sql`SELECT value FROM settings WHERE key='sections.world.spend'`;
  if(previous) {
    const p=SectionMoneyPolicy.parse(previous.value);
    if(p.limitCny!==5 || p.service!=='llm' || p.model!=='deepseek-flash' || p.endpointHost!=='api.deepseek.com'
      || p.inputPerMillionCny!==2 || p.outputPerMillionCny!==8) throw new Error('Existing monetary policy differs; do not reset or replace it');
  } else {
    if(articleIds) throw new Error('Existing cumulative monetary policy is required; do not reset the round');
    await sql`INSERT INTO settings (key,value) VALUES ('sections.world.spend',${sql.json({ limitCny:5,
    startedAt:new Date().toISOString(),service:'llm',model:'deepseek-flash',endpointHost:'api.deepseek.com',
    inputPerMillionCny:2,outputPerMillionCny:8,reference:'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/' })})`;
  }
  await sql`INSERT INTO section_budgets (section_id,service,per_minute,per_hour,per_day) VALUES ('world','llm',30,30,30)
    ON CONFLICT (section_id,service) DO NOTHING`;
  const collection=[];
  if(!articleIds) {
    await installWorldSources('world-real-trial');
    for(const source of WORLD_SOURCES) collection.push(await collectSectionSource('world',source.id,{ force:true }));
  }
  // Two actual substantial political/economic/security candidates. This is not a gold-label selector.
  const candidates=articleIds ? await sql<{ id:string;title:string;url:string;source_id:string;backfill:boolean }[]>`
    SELECT id,title,url,source_id,backfill FROM articles WHERE section_id='world' AND id IN ${sql(articleIds)}` : await sql<{ id:string;title:string;url:string;source_id:string;backfill:boolean }[]>`
    SELECT id,title,url,source_id,backfill FROM articles WHERE section_id='world' AND length(excerpt)>150
      AND btrim(excerpt)<>btrim(title)
      AND title ~* '(Trump|Russia|Ukraine|trade|ceasefire|candidate|央行|冲突|人道|和平)'
    ORDER BY published_at DESC NULLS LAST,id LIMIT 2`;
  if(articleIds) {
    if(candidates.length!==articleIds.length) throw new Error('Requested material is missing or belongs to another section');
    candidates.sort((a,b)=>articleIds.indexOf(a.id)-articleIds.indexOf(b.id));
  }
  const results=[];
  for(const article of candidates) {
    console.log(JSON.stringify({ phase:'real-model-start',articleId:article.id,sourceId:article.source_id }));
    try {
      const analysis=await runWorldAnalysisTask({ sectionId:'world',articleId:article.id,attemptTag:'real-trial-2026-10-11' });
      const group=analysis.relevance==='pass' && !analysis.stale ? await runWorldGroupTask({ sectionId:'world',articleId:article.id }) : null;
      const [saved]=await sql`SELECT relevance,category,score,title_zh,summary_zh,reason_zh,selected,output->'scores' AS scores
        FROM analyses WHERE section_id='world' AND id=${analysis.analysisId}`;
      results.push({ ...article,status:'ok',analysis,group,result:saved });
    } catch(error) { results.push({ ...article,status:'failed',error:String(error).slice(0,500) }); }
  }
  const [money]=await sql`SELECT count(*)::int AS attempts,coalesce(sum((r.request->>'reservedCostCny')::numeric),0) AS "reservedCeilingCny",
    coalesce(sum((coalesce((a.usage->>'prompt_tokens')::numeric,0)*2+coalesce((a.usage->>'completion_tokens')::numeric,0)*8)/1000000),0) AS "peakUsageEstimateCny",
    count(*) FILTER (WHERE a.status='unknown')::int AS "unknownAttempts"
    FROM receipt_attempts a JOIN receipts r ON r.id=a.receipt_id WHERE r.section_id='world' AND a.origin='live'`;
  console.log(JSON.stringify({ checkedAt:new Date().toISOString(),database:'world_real_trial_test',mode:articleIds?'saved-materials':'collect-and-analyse',collection,results,money,
    actualBillVerified:false,publicPermissionGranted:false,automaticPublication:false },null,2));
  if(collection.some(r=>r.status==='failed') || results.some(r=>r.status==='failed') || candidates.length<(articleIds?.length ?? 2)) process.exitCode=1;
} finally { await stopBoss();await closeDb(); }
