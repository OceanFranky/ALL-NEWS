import type { FastifyInstance } from "fastify";
import { SectionResourceParams as Id,SectionPermissionReview as Permission,SectionPublicationReview as Review } from "@aihot/contracts/section-publication";
import { adminHandler } from "../../../apps/api/src/routes/admin-auth.ts";
import { actorOf } from "@aihot/backend/admin/auth";
import { reviewSectionPublication,reviewSectionSourcePermission } from "@aihot/backend/publication/section-publish";
import { SectionDailyParams,SectionDailyReview,SectionDailyGenerate } from "@aihot/contracts/section-daily";
import { listSectionDailyRevisions,reviewSectionDaily } from "@aihot/backend/reports/section-daily";
import { generateWorldDaily } from "../daily.ts";
import { z } from "zod";
import { listSources,sourceDetail,updateSource } from "@aihot/backend/admin/sources";
import { searchContent,contentChain } from "@aihot/backend/admin/content";
import { installWorldSources } from "../sources.ts";
import { computeSectionHot } from '@aihot/backend/events/section-hot';
import { currentSectionHot } from '@aihot/backend/publication/section-hot';
import { SectionGroupingCorrection,SectionStoryParams,SectionStoryMerge } from '@aihot/contracts/section-events';
import { correctSectionGrouping,mergeSectionStories } from '@aihot/backend/events/section-corrections';
import { listSectionEvents,sectionEventDetail } from '@aihot/backend/admin/section-events';
import { enqueueOn } from '@aihot/backend/jobs/queue';
import { worldGroupQueue,worldCollectQueue,worldDigestQueue } from '../jobs.ts';
import { sectionRunsOverview } from '@aihot/backend/admin/section-runs';
import { sectionModelsOverview,switchSectionModel,SectionModelSwitch } from '@aihot/backend/admin/section-models';
import { SECTION_MODEL_STEPS } from '@aihot/backend/sections/rules';
import { sql } from '@aihot/backend/db';
import { previewSectionSource } from '@aihot/backend/sources/section-collect';
import { audit } from '@aihot/backend/audit';
import { rerunWorldAnalysis,releaseWorldReceipt } from '../operations.ts';

const SourceFilters=z.strictObject({ q:z.string().max(500).optional(),kind:z.string().max(40).optional(),
  health:z.string().max(40).optional(),enabled:z.enum(['true','false']).optional(),mode:z.string().max(40).optional(),
  page:z.coerce.number().int().min(1).max(100000).optional() });

export function registerWorldAdmin(app:FastifyInstance) {
  app.post('/api/admin/world/receipts/:id/release',adminHandler(async(req,reply,admin)=>{
    const { id }=z.strictObject({ id:z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).parse(req.params);
    return await releaseWorldReceipt(id,req.body,actorOf(admin)) ?? reply.code(404).send({ error:'not_found' });
  }));
  app.post('/api/admin/world/items/:id/rerun',adminHandler(async(req,reply,admin)=>
    await rerunWorldAnalysis(Id.parse(req.params).id,req.body,actorOf(admin)) ?? reply.code(404).send({ error:'not_found' })));
  app.patch('/api/admin/world/sources/:id',adminHandler(async(req,reply,admin)=>{
    const { id }=Id.parse(req.params),input=z.strictObject({ version:z.iso.datetime(),reason:z.string().trim().min(1).max(1000),
      patch:z.strictObject({ enabled:z.boolean().optional(),interval_minutes:z.number().int().min(1).max(1440).optional() }).refine(p=>Object.keys(p).length>0) }).parse(req.body);
    return await updateSource(id,input,actorOf(admin),'world') ?? reply.code(404).send({ error:'not_found' });
  }));
  app.post('/api/admin/world/sources/:id/preview',adminHandler(async(req,reply)=>{
    z.strictObject({}).parse(req.body ?? {});
    return await previewSectionSource('world',Id.parse(req.params).id) ?? reply.code(404).send({ error:'not_found' });
  }));
  app.post('/api/admin/world/sources/:id/fetch',adminHandler(async(req,reply,admin)=>{
    const { id }=Id.parse(req.params),{ reason }=z.strictObject({ reason:z.string().trim().min(1).max(1000) }).parse(req.body);
    return sql.begin(async tx=>{
      const [source]=await tx`SELECT id FROM sources WHERE section_id='world' AND id=${id} FOR UPDATE`;
      if(!source) return reply.code(404).send({ error:'not_found' });
      if(process.env.COLLECT_ENABLED!=='true') return reply.code(409).send({ detail:'collection-disabled' });
      const job=await enqueueOn(worldCollectQueue,{ sectionId:'world',sourceId:id,force:true },{ singletonKey:`world:collect:${id}` },tx);
      await audit(actorOf(admin),'section.source.fetch',`world:source:${id}`,reason,null,{ job },{ db:tx });
      return { sectionId:'world',sourceId:id,job,status:job?'queued':'already-queued' };
    });
  }));
  app.get('/api/admin/world/runs',adminHandler(async req=>{
    z.strictObject({}).parse(req.query);return sectionRunsOverview('world');
  }));
  app.get('/api/admin/world/models',adminHandler(async req=>{
    const { days }=z.strictObject({ days:z.coerce.number().int().min(1).max(90).default(7) }).parse(req.query);
    return sectionModelsOverview('world',days);
  }));
  app.post('/api/admin/world/models/:step',adminHandler(async(req,_reply,admin)=>{
    const { step }=z.strictObject({ step:z.enum(SECTION_MODEL_STEPS) }).parse(req.params);
    return switchSectionModel('world',step,SectionModelSwitch.parse(req.body),actorOf(admin));
  }));
  app.get('/api/admin/world/events',adminHandler(async req=>{
    const { q,limit }=z.strictObject({ q:z.string().max(500).default(''),limit:z.coerce.number().int().min(1).max(100).default(100) }).parse(req.query);
    return listSectionEvents('world',q,limit);
  }));
  app.get('/api/admin/world/events/:id',adminHandler(async(req,reply)=>
    await sectionEventDetail('world',SectionStoryParams.parse(req.params).id) ?? reply.code(404).send({ error:'not_found' })));
  app.post('/api/admin/world/events/:id/merge',adminHandler(async(req,reply,admin)=>{
    try {
      return await mergeSectionStories('world',SectionStoryParams.parse(req.params).id,SectionStoryMerge.parse(req.body),actorOf(admin),
        (tx,storyId)=>enqueueOn(worldDigestQueue,{ sectionId:'world',storyId },{ singletonKey:`world:digest:${storyId}` },tx));
    }
    catch(error) {
      if(/section mismatch|resource not found/.test(String(error))) return reply.code(404).send({ error:'not_found' });
      throw error;
    }
  }));
  app.post('/api/admin/world/items/:id/grouping',adminHandler(async(req,reply,admin)=>{
    try {
      const id=Id.parse(req.params).id,input=SectionGroupingCorrection.parse(req.body);
      return await correctSectionGrouping('world',id,input,actorOf(admin),
        (tx,articleId,requestId)=>enqueueOn(worldGroupQueue,{ sectionId:'world',articleId },{ singletonKey:`world:manual:group:${articleId}:${requestId}` },tx),
        (tx,storyId)=>enqueueOn(worldDigestQueue,{ sectionId:'world',storyId },{ singletonKey:`world:digest:${storyId}` },tx));
    }
    catch(error) {
      if(/section mismatch|resource not found/.test(String(error))) return reply.code(404).send({ error:'not_found' });
      throw error;
    }
  }));
  app.get('/api/admin/world/hot',adminHandler(async()=>currentSectionHot('world',new Date(),true)));
  app.post('/api/admin/world/hot/generate',adminHandler(async(req,_reply,admin)=>{
    z.strictObject({}).parse(req.body ?? {});
    return computeSectionHot('world',actorOf(admin));
  }));
  app.get('/api/admin/world/sources',adminHandler(async(req)=>listSources(SourceFilters.parse(req.query),'world')));
  app.post('/api/admin/world/sources/install',adminHandler(async(req,_reply,admin)=>{
    z.strictObject({}).parse(req.body ?? {});
    return installWorldSources(actorOf(admin));
  }));
  app.get('/api/admin/world/sources/:id',adminHandler(async(req,reply)=>{
    const { id }=Id.parse(req.params),result=await sourceDetail(id,'world');
    if(!result) return reply.code(404).send({ error:'not_found' });
    const [permission]=await sql`SELECT summary_allowed,permission_reference,reviewed_by,reviewed_at
      FROM section_source_permissions WHERE section_id='world' AND source_id=${id}`;
    return { ...result,sectionId:'world',permission:permission ?? null };
  }));
  app.get('/api/admin/world/content',adminHandler(async(req)=>{
    const { q }=z.strictObject({ q:z.string().max(500).default('') }).parse(req.query);
    return { rows:await searchContent(q,'world') };
  }));
  app.get('/api/admin/world/content/:id',adminHandler(async(req,reply)=>{
    const { id }=Id.parse(req.params),result=await contentChain(id,'world');
    if(!result) return reply.code(404).send({ error:'not_found' });
    const [material]=await sql`SELECT excerpt,grouping_status FROM articles WHERE section_id='world' AND id=${id}`;
    const analysisDetails=await sql`SELECT id,summary_zh,output FROM analyses WHERE section_id='world' AND article_id=${id}
      ORDER BY created_at DESC,id DESC LIMIT 10`;
    return { ...result,sectionId:'world',material,analysisDetails };
  }));
  app.get('/api/admin/world/daily/:date',adminHandler(async(req)=>{
    const { date }=SectionDailyParams.parse(req.params);
    return { sectionId:'world',date,revisions:await listSectionDailyRevisions('world',date) };
  }));
  app.post('/api/admin/world/daily/:date/generate',adminHandler(async(req,_reply,admin)=>{
    const { date }=SectionDailyParams.parse(req.params);
    SectionDailyGenerate.parse(req.body ?? {});
    return generateWorldDaily(date,actorOf(admin));
  }));
  app.post('/api/admin/world/daily/:date/review',adminHandler(async(req,_reply,admin)=>{
    const { date }=SectionDailyParams.parse(req.params);
    return reviewSectionDaily('world',date,{ ...SectionDailyReview.parse(req.body),actor:actorOf(admin) });
  }));
  app.post('/api/admin/world/sources/:id/permission',adminHandler(async(req,reply,admin)=>{
    const { id }=Id.parse(req.params);
    const review=Permission.parse(req.body);
    try {
      return await reviewSectionSourcePermission('world',id,{ ...review,actor:actorOf(admin) });
    } catch(error) {
      if(/section mismatch|resource not found/.test(String(error))) return reply.code(404).send({ error:'not_found' });
      throw error;
    }
  }));
  app.post('/api/admin/world/items/:id/review',adminHandler(async(req,reply,admin)=>{
    const { id }=Id.parse(req.params);
    const review=Review.parse(req.body);
    try {
      return await reviewSectionPublication('world',id,{ ...review,actor:actorOf(admin) },
        (tx,storyId)=>enqueueOn(worldDigestQueue,{ sectionId:'world',storyId },{ singletonKey:`world:digest:${storyId}` },tx));
    } catch(error) {
      if(/section mismatch|resource not found/.test(String(error))) return reply.code(404).send({ error:'not_found' });
      throw error;
    }
  }));
}
