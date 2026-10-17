import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { ZodError } from "zod";
import { adminHandler } from "@aihot/api/routes/admin-auth";
import { applyPublicHeaders, strictQuery, QueryError, sendProblem } from "@aihot/api/http/respond";
import { readModulePublication } from "@aihot/backend/publication/modules";
import { actorOf } from "@aihot/backend/admin/auth";
import { config } from "@aihot/backend/config";
import { querySchema } from "../backend/domain.ts";
import { adminNotices, saveNotice, changePublication } from "../backend/store.ts";
import { submitImport, commandImport } from "../backend/imports.ts";
import { readImports } from "../backend/publication.ts";

export function admissionRoutes(app: FastifyInstance) {
  const publicRoute = (resource: string, input: (req: FastifyRequest) => unknown) => async (req: FastifyRequest, reply: FastifyReply) => {
    applyPublicHeaders(reply); reply.header("Cache-Control", "no-store");
    try {
      const result = await readModulePublication("admission", resource, input(req));
      return result === null ? sendProblem(req, reply, { status: 404, code: "not_found", detail: "公告不存在或已撤回。" }) : result;
    } catch (error) {
      if (error instanceof ZodError || error instanceof QueryError) return sendProblem(req, reply, { status: 400, code: "invalid_request", detail: "升学筛选或公告编号无效。" });
      throw error;
    }
  };
  app.get("/api/v1/admissions", publicRoute("list", req => strictQuery(req, Object.keys(querySchema.shape))));
  app.get("/api/v1/admissions/schools", publicRoute("schools", req => { strictQuery(req, []); return undefined; }));
  app.get("/api/v1/admissions/monitor", publicRoute("monitor", req => { strictQuery(req, []); return undefined; }));
  app.get("/api/v1/admissions/daily", publicRoute("daily", req => strictQuery(req, ["date"])));
  app.get("/api/v1/admissions/imports", publicRoute("imports", req => strictQuery(req, ["ids"])));
  app.post("/api/v1/admissions/imports", { bodyLimit: 4096 }, async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    // This public endpoint accepts explicit JSON submissions; visiting a page never creates work.
    if (!req.headers["content-type"]?.startsWith("application/json") || req.headers["sec-fetch-site"] === "cross-site"
      || (req.headers.origin && req.headers.origin !== new URL(config.siteUrl).origin)) return sendProblem(req, reply, { status: 403, code: "forbidden", detail: "请从本站添加来源。" });
    try { return reply.code(202).send(await submitImport(req.body)); }
    catch (error) {
      const status = error instanceof ZodError ? 400 : (error as { statusCode?: number }).statusCode;
      if (status === 400 || status === 409 || status === 429) return sendProblem(req, reply, { status, code: "import_rejected", detail: error instanceof ZodError ? "请填写有效的官网链接与来源类型。" : (error as Error).message });
      throw error;
    }
  });
  app.get("/api/admin/admissions/imports", adminHandler(async () => readImports({}, true)));
  app.post("/api/admin/admissions/imports/:importId", adminHandler(async (req, _reply, admin) => commandImport((req.params as { importId: string }).importId, req.body, actorOf(admin))));
  app.get("/api/v1/admissions/:noticeId", publicRoute("detail", req => { strictQuery(req, []); return (req.params as { noticeId: string }).noticeId; }));
  app.get("/api/admin/admissions", adminHandler(async () => adminNotices()));
  app.post("/api/admin/admissions", adminHandler(async (req, _reply, admin) => saveNotice(req.body, actorOf(admin))));
  for (const action of ["publish", "withdraw"] as const) app.post(`/api/admin/admissions/:noticeId/${action}`, adminHandler(async (req, _reply, admin) => changePublication((req.params as { noticeId: string }).noticeId, action, req.body, actorOf(admin))));
}
