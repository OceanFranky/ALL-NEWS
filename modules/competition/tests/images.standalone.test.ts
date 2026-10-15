import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { parseImage } from "../backend/images.ts";

test("offline OCR reads actual pixels with local language data and preserves image provenance", async () => {
  const body = await sharp(Buffer.from('<svg width="1500" height="220" xmlns="http://www.w3.org/2000/svg"><rect width="1500" height="220" fill="white"/><text x="40" y="130" font-family="sans-serif" font-size="72" fill="black">OFFICIAL CONTEST 2026</text></svg>')).png().toBuffer();
  const material = await parseImage("https://contest.example/poster.png", body);
  assert.equal(material.blocks[0]!.id, "ocr-block-1");
  assert.match(material.blocks[0]!.text, /2026/);
  assert.match(material.blocks[0]!.text, /CONTEST/);
  assert.deepEqual(material.images, [material.url]);
  assert.match(material.contentType, /extracted=ocr/);
});

test("empty, unsupported and oversized images cannot become readable official material", async () => {
  await assert.rejects(parseImage("https://contest.example/huge.png", Buffer.alloc(4 * 1024 * 1024 + 1)), /byte limit/);
  const blank = await sharp({ create: { width: 200, height: 100, channels: 3, background: "white" } }).png().toBuffer();
  await assert.rejects(parseImage("https://contest.example/blank.png", blank), /insufficient readable/);
  const svg = Buffer.from('<svg width="200" height="100" xmlns="http://www.w3.org/2000/svg"><rect width="200" height="100" fill="white"/></svg>');
  await assert.rejects(parseImage("https://contest.example/icon.svg", svg), /Unsupported competition image/);
});

test("image upload year does not replace the season actually visible in the pixels", async () => {
  const body = await sharp(Buffer.from('<svg width="1500" height="220" xmlns="http://www.w3.org/2000/svg"><rect width="1500" height="220" fill="white"/><text x="40" y="130" font-family="sans-serif" font-size="72" fill="black">OFFICIAL CONTEST 2025</text></svg>')).png().toBuffer();
  const material = await parseImage("https://contest.example/uploads/2026/poster.png", body);
  assert.match(material.blocks[0]!.text, /2025/);
  assert.doesNotMatch(material.blocks[0]!.text, /2026/);
});
