import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtemp, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import sharp from "sharp";
import type { Material } from "./schema.ts";
const require = createRequire(import.meta.url);

export async function parseImage(url: string, body: Buffer): Promise<Material> {
  if (body.length > 4 * 1024 * 1024) throw new Error("Competition image exceeds byte limit");
  const image = sharp(body, { limitInputPixels: 16_000_000 });
  const metadata = await image.metadata();
  if (!["png", "jpeg", "webp"].includes(metadata.format ?? "") || (metadata.pages ?? 1) > 1) throw new Error("Unsupported competition image format");
  const raster = await image.resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true }).flatten({ background: "white" }).greyscale().png().toBuffer();
  const directory = await mkdtemp(path.join(tmpdir(), "competition-ocr-"));
  let output: string;
  try {
    for (const language of ["eng", "chi_sim"]) {
      const root = path.dirname(require.resolve(`@tesseract.js-data/${language}`));
      await copyFile(path.join(root, "4.0.0_best_int", `${language}.traineddata.gz`), path.join(directory, `${language}.traineddata.gz`));
    }
    output = await new Promise<string>((resolve, reject) => {
      const child = execFile(process.execPath, [fileURLToPath(new URL("./image-ocr-worker.ts", import.meta.url)), directory], { timeout: 45000, maxBuffer: 256 * 1024, env: {} }, (error, stdout) => {
        if (error) reject(new Error(`Competition image OCR failed: ${error.message.slice(0, 200)}`));
        else resolve(stdout);
      });
      child.stdin!.on("error", reject);
      child.stdin!.end(raster);
    });
  } finally { await rm(directory, { recursive: true, force: true }); }
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
