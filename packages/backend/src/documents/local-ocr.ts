import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtemp, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

export async function localOcr(worker: "image" | "pdf", input: Buffer, pages: number[] = []): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "document-ocr-"));
  try {
    for (const language of ["eng", "chi_sim"]) {
      const root = path.dirname(require.resolve(`@tesseract.js-data/${language}`));
      await copyFile(path.join(root, "4.0.0_best_int", `${language}.traineddata.gz`), path.join(directory, `${language}.traineddata.gz`));
    }
    return await new Promise<string>((resolve, reject) => {
      const child = execFile(process.execPath, [fileURLToPath(new URL(`./${worker}-ocr-worker.ts`, import.meta.url)), directory, pages.join(",")],
        { timeout: worker === "pdf" ? 180000 : 45000, maxBuffer: 512 * 1024, env: {} }, (error, stdout) => {
          if (error) reject(new Error(`Document ${worker} OCR failed: ${error.message.slice(0, 200)}`));
          else resolve(stdout);
        });
      child.stdin!.on("error", reject);
      child.stdin!.end(input);
    });
  } finally { await rm(directory, { recursive: true, force: true }); }
}
