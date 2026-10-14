import { createHash } from "node:crypto";
import sharp from "sharp";
import type { Material } from "./schema.ts";
import { localOcr } from "./local-ocr.ts";

export async function parseImage(url: string, body: Buffer): Promise<Material> {
  if (body.length > 4 * 1024 * 1024) throw new Error("Competition image exceeds byte limit");
  const image = sharp(body, { limitInputPixels: 16_000_000 });
  const metadata = await image.metadata();
  if (!["png", "jpeg", "webp"].includes(metadata.format ?? "") || (metadata.pages ?? 1) > 1) throw new Error("Unsupported competition image format");
  const raster = await image.resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true }).flatten({ background: "white" }).greyscale().png().toBuffer();
  const output = await localOcr("image", raster);
  const result = JSON.parse(output) as { text: string; confidence: number };
  const text = result.text.replace(/\s+/g, " ").trim();
  if (text.length < 8 || !Number.isFinite(result.confidence) || result.confidence < 40) throw new Error("Image OCR has insufficient readable text or confidence");
  const blocks: Material["blocks"] = [];
  for (let offset = 0; offset < text.length; offset += 2000) blocks.push({ id: `ocr-block-${1 + offset / 2000}`, text: text.slice(offset, offset + 2000) });
  const contentType = `image/${metadata.format}; extracted=ocr; confidence=${Math.round(result.confidence)}`;
  const hash = createHash("sha256").update(body).update(JSON.stringify({ contentType, blocks })).digest("hex");
  const id = createHash("sha256").update(`${url}\n${hash}`).digest("hex");
  return { id, url, hash, fetchedAt: new Date().toISOString(), contentType, blocks, links: [], images: [url] };
}
