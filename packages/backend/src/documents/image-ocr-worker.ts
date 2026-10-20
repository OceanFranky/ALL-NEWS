import path from "node:path";
import { createWorker, PSM } from "tesseract.js";

const languageDirectory = process.argv[2];
if (!languageDirectory || !path.isAbsolute(languageDirectory)) throw new Error("OCR requires a local language directory");
let worker: Awaited<ReturnType<typeof createWorker>> | undefined;
try {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > 16 * 1024 * 1024) throw new Error("OCR input exceeds byte limit");
    chunks.push(Buffer.from(chunk));
  }
  worker = await createWorker(["chi_sim", "eng"], 1, { langPath: languageDirectory, cacheMethod: "none", gzip: true });
  await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
  const { data } = await worker.recognize(Buffer.concat(chunks));
  process.stdout.write(JSON.stringify({ text: data.text, confidence: data.confidence }));
} finally {
  await worker?.terminate();
}
