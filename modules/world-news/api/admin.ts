import type { FastifyInstance } from "fastify";
import { SectionResourceParams as Id,SectionPermissionReview as Permission,SectionPublicationReview as Review } from "@aihot/contracts/section-publication";
import { adminHandler } from "../../../apps/api/src/routes/admin-auth.ts";
import { actorOf } from "@aihot/backend/admin/auth";
import { reviewSectionPublication,reviewSectionSourcePermission } from "@aihot/backend/publication/section-publish";
import { SectionDailyParams,SectionDailyReview,SectionDailyGenerate } from "@aihot/contracts/section-daily";
import { listSectionDailyRevisions,reviewSectionDaily } from "@aihot/backend/reports/section-daily";
import { generateWorldDaily } from "../daily.ts";

export function registerWorldAdmin(app:FastifyInstance) {
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
      return await reviewSectionPublication('world',id,{ ...review,actor:actorOf(admin) });
    } catch(error) {
      if(/section mismatch|resource not found/.test(String(error))) return reply.code(404).send({ error:'not_found' });
      throw error;
    }
  }));
}
