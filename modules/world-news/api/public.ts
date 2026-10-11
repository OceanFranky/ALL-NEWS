import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sectionItems,sectionItem,sectionStories,sectionStory,sectionHot } from "@aihot/backend/publication/sections";

const Query=z.strictObject({ limit:z.coerce.number().int().min(1).max(100).optional(),category:z.enum(["politics","economy","security"]).optional(),q:z.string().max(200).optional() });
export function registerWorldPublic(app:FastifyInstance) {
  app.get("/api/v1/world/items",async(req,reply)=>{
    const parsed=Query.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error:"invalid_world_query" });
    reply.header("Cache-Control","no-store");
    return sectionItems("world",parsed.data);
  });
  app.get<{ Params:{ id:string } }>("/api/v1/world/items/:id",async(req,reply)=>{
    reply.header("Cache-Control","no-store");
    const item=await sectionItem("world",req.params.id);
    return item ?? reply.code(404).send({ error:"not_found" });
  });
  app.get("/api/v1/world/stories",async(req,reply)=>{
    const parsed=z.strictObject({ limit:z.coerce.number().int().min(1).max(100).optional() }).safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error:"invalid_world_query" });
    reply.header("Cache-Control","no-store");
    return sectionStories("world",parsed.data.limit);
  });
  app.get<{ Params:{ publicId:string } }>("/api/v1/world/stories/:publicId",async(req,reply)=>{
    reply.header("Cache-Control","no-store");
    const story=await sectionStory("world",req.params.publicId);
    return story ?? reply.code(404).send({ error:"not_found" });
  });
  app.get("/api/v1/world/hot",async(_req,reply)=>{
    reply.header("Cache-Control","no-store");
    return sectionHot("world");
  });
}
