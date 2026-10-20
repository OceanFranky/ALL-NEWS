import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z, ZodError } from "zod";
import { resourceWriteSchema, resourceReviewSchema } from "@aihot/contracts/learning-resources";
import { adminHandler } from "@aihot/api/routes/admin-auth";
import { actorOf } from "@aihot/backend/admin/auth";
import { applyPublicHeaders, QueryError, sendProblem, strictQuery } from "@aihot/api/http/respond";
import { readModulePublication } from "@aihot/backend/publication/modules";
import { resourceDetail, listResources, saveResource, reviewResource, resourceTargets } from "../backend/repository.ts";
import { resourceCoverage } from "../backend/publication.ts";
import { maintenanceOverview, previewMaintenance, saveMaintenanceSettings, enqueueMaintenance, stopMaintenance } from "../backend/maintenance.ts";

const idOf = (req: FastifyRequest) => z.uuid().parse((req.params as { id: string }).id);
const missing = (req: FastifyRequest, reply: FastifyReply) => sendProblem(req, reply, { status: 404, code: "not_found", detail: "资源或竞赛届次不存在" });
function query(req: FastifyRequest, keys: string[]) {
  try { return strictQuery(req, keys); }
  catch (error) { if (error instanceof QueryError) throw Object.assign(error, { statusCode: 400 }); throw error; }
}
export function resourceRoutes(app: FastifyInstance) {
  app.get("/api/admin/resources/maintenance", adminHandler(async req => { query(req, []); return maintenanceOverview(); }));
  app.get("/api/admin/resources/maintenance/preview", adminHandler(async req => { query(req, []); return previewMaintenance(); }));
  app.put("/api/admin/resources/maintenance", adminHandler(async (req, _reply, admin) => {
    query(req, []); return saveMaintenanceSettings(req.body, actorOf(admin));
  }));
  app.post("/api/admin/resources/maintenance/run", adminHandler(async (req, _reply, admin) => {
    query(req, []); z.object({}).strict().parse(req.body); return enqueueMaintenance(actorOf(admin));
  }));
  app.post("/api/admin/resources/maintenance/:id/stop", adminHandler(async (req, reply, admin) => {
    query(req, []); z.object({}).strict().parse(req.body); return await stopMaintenance(idOf(req), actorOf(admin)) ?? missing(req, reply);
  }));
  app.get("/api/admin/resources", adminHandler(async req => {
    const input = z.object({ q: z.string().trim().max(200).default(""), page: z.coerce.number().int().min(1).max(10000).default(1) }).parse(query(req, ["q", "page"]));
    return listResources(input.q, input.page);
  }));
  app.get("/api/admin/resources/targets", adminHandler(async req => { query(req, []); return resourceTargets(); }));
  app.get("/api/admin/resources/coverage", adminHandler(async req => { query(req, []); return resourceCoverage(); }));
  app.get("/api/admin/resources/:id", adminHandler(async (req, reply) => { query(req, []); return await resourceDetail(idOf(req)) ?? missing(req, reply); }));
  app.post("/api/admin/resources", adminHandler(async (req, _reply, admin) => {
    query(req, []); return saveResource(null, resourceWriteSchema.parse(req.body), actorOf(admin));
  }));
  app.put("/api/admin/resources/:id", adminHandler(async (req, reply, admin) => {
    query(req, []); return await saveResource(idOf(req), resourceWriteSchema.parse(req.body), actorOf(admin)) ?? missing(req, reply);
  }));
  app.post("/api/admin/resources/:id/review", adminHandler(async (req, reply, admin) => {
    query(req, []); return await reviewResource(idOf(req), resourceReviewSchema.parse(req.body), actorOf(admin)) ?? missing(req, reply);
  }));
  app.get("/api/v1/competitions/:competitionId/editions/:editionId/resources", async (req, reply) => {
    applyPublicHeaders(reply); reply.header("Cache-Control", "no-store");
    try {
      query(req, []);
      return await readModulePublication("learning-resources", "competition", req.params) ?? missing(req, reply);
    } catch (error) {
      if (error instanceof ZodError || (error as { statusCode?: number }).statusCode === 400) return sendProblem(req, reply, { status: 400, code: "invalid_request", detail: "竞赛标识或查询参数无效" });
      throw error;
    }
  });
}
