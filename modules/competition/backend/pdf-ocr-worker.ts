import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createWorker, PSM } from "tesseract.js";

const directory = process.argv[2];
const pages = (process.argv[3] ?? "").split(",").map(Number);
if (!directory || !path.isAbsolute(directory) || !pages.length || pages.length > 16 || pages.some(p => !Number.isInteger(p) || p < 1)) throw new Error("Invalid local PDF OCR request");
const chunks: Buffer[] = [];
let bytes = 0;
for await (const chunk of process.stdin) {
  bytes += chunk.length;
  if (bytes > 8 * 1024 * 1024) throw new Error("PDF OCR input exceeds byte limit");
  chunks.push(Buffer.from(chunk));
}
const task = getDocument({ data: new Uint8Array(Buffer.concat(chunks)), useSystemFonts: false, maxImageSize: 16_000_000, verbosity: 0 });
let worker: Awaited<ReturnType<typeof createWorker>> | undefined;
try {
  const doc = await task.promise;
  if (doc.numPages > 150 || pages.some(p => p > doc.numPages)) throw new Error("PDF OCR page limit exceeded");
  worker = await createWorker(["chi_sim", "eng"], 1, { langPath: directory, cacheMethod: "none", gzip: true });
  await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO });
  const results = [];
  for (const number of pages) {
    const page = await doc.getPage(number);
    const size = page.getViewport({ scale: 1 });
    if (!Number.isFinite(size.width) || !Number.isFinite(size.height) || size.width <= 0 || size.height <= 0) throw new Error("Invalid PDF page dimensions");
    const viewport = page.getViewport({ scale: Math.min(3, 2400 / Math.max(size.width, size.height)) });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    try {
      await page.render({ canvas: null, canvasContext: canvas.getContext("2d") as unknown as Parameters<typeof page.render>[0]["canvasContext"], viewport }).promise;
      const { data } = await worker.recognize(canvas.toBuffer("image/png"));
      const text = data.text.replace(/\s+/g, " ").trim();
      if (text.length < 8 || !Number.isFinite(data.confidence) || data.confidence < 40) throw new Error(`PDF OCR page ${number} has insufficient readable text or confidence`);
      results.push({ page: number, text, confidence: data.confidence });
    } finally {
      canvas.width = canvas.height = 1;
      page.cleanup();
    }
  }
  process.stdout.write(JSON.stringify(results));
} finally {
  await worker?.terminate();
  await task.destroy();
}
