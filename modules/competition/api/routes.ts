import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z, ZodError } from "zod";
import { adminHandler } from "@aihot/api/routes/admin-auth";
import { applyPublicHeaders, QueryError, sendProblem, strictQuery } from "@aihot/api/http/respond";
import { actorOf } from "@aihot/backend/admin/auth";
import { readModulePublication } from "@aihot/backend/publication/modules";
import { candidateDetail, candidateList } from "../backend/candidates.ts";
import { addEdition, selectDisplay } from "../backend/display.ts";
import { competitionIdSchema, editionIdSchema, competitionQuerySchema, displayInputSchema } from "../backend/query.ts";

const queryKeys = Object.keys(competitionQuerySchema.shape);
function param(req: FastifyRequest, name: string) { return (req.params as Record<string, string>)[name]; }
function ids(req: FastifyRequest) {
  return { competitionId: competitionIdSchema.parse(param(req, "competitionId")), editionId: editionIdSchema.parse(param(req, "editionId")) };
}
function missing(req: FastifyRequest, reply: FastifyReply) {
  return sendProblem(req, reply, { status: 404, code: "not_found", detail: "Competition not found." });
}
function query(req: FastifyRequest, allowed: string[]) {
  try { return strictQuery(req, allowed); }
  catch (error) { if (error instanceof QueryError) throw Object.assign(error, { statusCode: 400 }); throw error; }
}

export function competitionRoutes(app: FastifyInstance) {
  const publicRoute = (resource: string, input: (req: FastifyRequest) => unknown) => async (req: FastifyRequest, reply: FastifyReply) => {
    applyPublicHeaders(reply);
    reply.header("Cache-Control", "no-store");
    try {
      const value = await readModulePublication("competition", resource, input(req));
      return value === null ? missing(req, reply) : value;
    } catch (error) {
      if (error instanceof ZodError || (error as { statusCode?: number }).statusCode === 400) return sendProblem(req, reply, { status: 400, code: "invalid_request", detail: "Invalid competition query or identifier." });
      throw error;
    }
  };
  app.get("/api/v1/competitions", publicRoute("list", req => query(req, queryKeys)));
  app.get("/api/v1/competitions/filters", publicRoute("filters", req => { query(req, []); return undefined; }));
  app.get("/api/v1/competitions/overview", publicRoute("overview", req => { query(req, []); return undefined; }));
  app.get("/api/v1/competitions/:competitionId/editions/:editionId", publicRoute("detail", req => { query(req, []); return ids(req); }));
  app.get("/api/admin/competitions/candidates", adminHandler(async req => {
    const input = z.object({ q: z.string().optional(), page: z.string().optional(), pageSize: z.string().optional() }).strict().parse(query(req, ["q", "page", "pageSize"]));
    return candidateList(competitionQuerySchema.parse(input));
  }));
  app.get("/api/admin/competitions/:competitionId/candidate", adminHandler(async (req, reply) => {
    const input = z.object({ revisionId: z.string().min(1).optional() }).strict().parse(query(req, ["revisionId"]));
    return await candidateDetail(competitionIdSchema.parse(param(req, "competitionId")), input.revisionId) ?? missing(req, reply);
  }));
  app.post("/api/admin/competitions/:competitionId/editions", adminHandler(async (req, _reply, admin) => {
    query(req, []);
    const input = z.object({ revisionId: z.string().min(1), reason: z.string().trim().min(1).max(1000) }).strict().parse(req.body);
    return addEdition(competitionIdSchema.parse(param(req, "competitionId")), input.revisionId, actorOf(admin), input.reason);
  }));
  app.post("/api/admin/competitions/:competitionId/editions/:editionId/display", adminHandler(async (req, reply, admin) => {
    query(req, []);
    const input = displayInputSchema.parse(req.body);
    const { competitionId, editionId } = ids(req);
    return await selectDisplay(competitionId, editionId, input, actorOf(admin)) ?? missing(req, reply);
  }));
}
