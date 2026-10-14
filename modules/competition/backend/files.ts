import { createHash } from "node:crypto";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import mammoth from "mammoth";
import type { Material } from "./schema.ts";

export async function parseFile(url: string, body: Buffer, contentType: string): Promise<Material> {
  const blocks: Material["blocks"] = [];
  if (body.subarray(0, 5).toString() === "%PDF-") {
    const task = getDocument({ data: new Uint8Array(body), useSystemFonts: true });
    try {
      const doc = await task.promise;
      if (doc.numPages > 150) throw new Error("PDF exceeds competition material page limit");
      for (let page = 1; page <= doc.numPages; page++) {
        const content = await (await doc.getPage(page)).getTextContent();
        const text = content.items.map(item => "str" in item ? item.str : "").join(" ").replace(/\s+/g, " ").trim();
        for (let i = 0; i < text.length; i += 2000) blocks.push({ id: `page-${page}-block-${1 + i / 2000}`, text: text.slice(i, i + 2000) });
      }
    } finally { await task.destroy(); }
    contentType = "application/pdf";
  } else if (/\.docx(?:[?#]|$)/i.test(url) || contentType.includes("wordprocessingml")) {
    const result = await mammoth.extractRawText({ buffer: body });
    for (const [index, paragraph] of result.value.split(/\n\s*\n/).entries()) {
      const text = paragraph.replace(/\s+/g, " ").trim();
      if (text) blocks.push({ id: `paragraph-${index + 1}`, text });
    }
    contentType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  } else throw new Error("Unsupported official attachment format");
  if (blocks.reduce((sum, b) => sum + b.text.length, 0) < 40) throw new Error("File contains no usable text; OCR or visual inspection required");
  const hash = createHash("sha256").update(body).digest("hex");
  const id = createHash("sha256").update(`${url}\n${hash}`).digest("hex");
  return { id, url, hash, fetchedAt: new Date().toISOString(), contentType, blocks, images: [], links: [] };
}
