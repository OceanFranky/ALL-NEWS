import { createHash } from "node:crypto";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import mammoth from "mammoth";
import { unzipSync } from "fflate";
import WordExtractor from "word-extractor";
import type { Material } from "./types.ts";
import { localOcr } from "./local-ocr.ts";

export async function parseFile(url: string, body: Buffer, contentType: string, allowArchive = true, maxPdfBytes = 8 * 1024 * 1024): Promise<Material> {
  const blocks: Material["blocks"] = [];
  let archive = false;
  if (body.subarray(0, 5).toString() === "%PDF-") {
    if (body.length > maxPdfBytes) throw new Error("PDF exceeds document byte limit");
    const scannedPages: number[] = [];
    const task = getDocument({ data: new Uint8Array(body), useSystemFonts: true });
    try {
      const doc = await task.promise;
      if (doc.numPages > 150) throw new Error("PDF exceeds document page limit");
      for (let page = 1; page <= doc.numPages; page++) {
        const content = await (await doc.getPage(page)).getTextContent();
        const text = content.items.map(item => "str" in item ? item.str : "").join(" ").replace(/\s+/g, " ").trim();
        if (text.length < 40) { scannedPages.push(page); continue; }
        for (let i = 0; i < text.length; i += 2000) blocks.push({ id: `page-${page}-block-${1 + i / 2000}`, text: text.slice(i, i + 2000) });
      }
    } finally { await task.destroy(); }
    contentType = "application/pdf";
    if (scannedPages.length) {
      if (scannedPages.length > 16) throw new Error("PDF exceeds document OCR page limit");
      const pages = JSON.parse(await localOcr("pdf", body, scannedPages)) as Array<{ page: number; text: string; confidence: number }>;
      if (pages.length !== scannedPages.length || pages.some((p, index) => p.page !== scannedPages[index] || !p.text || !Number.isFinite(p.confidence) || p.confidence < 40)) throw new Error("Incomplete PDF OCR result");
      for (const page of pages) {
        for (let i = 0; i < page.text.length; i += 2000) blocks.push({ id: `page-${page.page}-ocr-block-${1 + i / 2000}`, text: page.text.slice(i, i + 2000) });
      }
      contentType = `application/pdf; extracted=ocr; confidence=${pages.map(p => `page-${p.page}:${Math.round(p.confidence)}`).join(",")}`;
    }
  } else if (allowArchive && (/\.zip(?:[?#]|$)/i.test(url) || (contentType.includes("zip") && !/\.docx(?:[?#]|$)/i.test(url)))) {
    archive = true;
    let entries = 0, expanded = 0;
    const files = unzipSync(body, { filter: file => {
      if (++entries > 100) throw new Error("ZIP exceeds document attachment entry limit");
      if (!/\.(pdf|docx|doc)$/i.test(file.name)) return false;
      if (/(^|[\\/])\.\.([\\/]|$)|^[\\/]|^[a-z]:/i.test(file.name)) throw new Error("Unsafe ZIP attachment path");
      if (file.originalSize > 8 * 1024 * 1024 || (expanded += file.originalSize) > 16 * 1024 * 1024) throw new Error("ZIP exceeds document attachment expansion limit");
      return true;
    } });
    const failures: string[] = [];
    for (const [index, [name, bytes]] of Object.entries(files).entries()) {
      try {
        const type = /\.docx$/i.test(name) ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : /\.doc$/i.test(name) ? "application/msword" : "application/pdf";
        const material = await parseFile(`${url}#entry-${index + 1}`, Buffer.from(bytes), type, false);
        for (const block of material.blocks) blocks.push({ id: `entry-${index + 1}-${block.id}`, text: block.text });
      } catch (error) { failures.push(`entry-${index + 1}: ${error instanceof Error ? error.message : String(error)}`); }
    }
    if (!blocks.length) throw new Error("ZIP has no supported readable PDF, DOCX or DOC attachment");
    blocks.push({ id: "archive-index", text: `ZIP内共${entries}个条目；仅解析PDF／DOCX／DOC；其他格式未解析。${failures.join("；")}` });
    contentType = "application/zip; parsed=pdf,docx,doc";
  } else if (/\.docx(?:[?#]|$)/i.test(url) || contentType.includes("wordprocessingml")) {
    const result = await mammoth.extractRawText({ buffer: body });
    for (const [index, paragraph] of result.value.split(/\n\s*\n/).entries()) {
      const text = paragraph.replace(/\s+/g, " ").trim();
      if (text) blocks.push({ id: `paragraph-${index + 1}`, text });
    }
    contentType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  } else if (body.subarray(0, 8).equals(Buffer.from("d0cf11e0a1b11ae1", "hex")) && (/\.doc(?:[?#]|$)/i.test(url) || contentType.includes("msword"))) {
    const doc = await new WordExtractor().extract(body);
    for (const [index, paragraph] of doc.getBody().split(/[\r\n]+/).entries()) {
      const text = paragraph.replace(/\s+/g, " ").trim();
      if (text) blocks.push({ id: `paragraph-${index + 1}`, text });
    }
    contentType = "application/msword";
  } else throw new Error("Unsupported official attachment format");
  if (blocks.filter(block => !archive || block.id !== "archive-index").reduce((sum, b) => sum + b.text.length, 0) < 40) throw new Error("File contains no usable text; OCR or visual inspection required");
  // The same download can gain new paragraphs when the parser changes. Give that parsed snapshot
  // its own identity so an older stored ZIP cannot silently replace the evidence just extracted.
  const hash = createHash("sha256").update(body).update(JSON.stringify({ contentType, blocks })).digest("hex");
  const id = createHash("sha256").update(`${url}\n${hash}`).digest("hex");
  return { id, url, hash, fetchedAt: new Date().toISOString(), contentType, blocks, images: [], links: [] };
}
