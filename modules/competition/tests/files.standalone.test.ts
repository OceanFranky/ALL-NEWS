import assert from "node:assert/strict";
import test from "node:test";
import { zipSync, strToU8 } from "fflate";
import { parseFile } from "../backend/files.ts";

test("DOCX paragraphs preserve source positions and reject an unsupported binary", async () => {
  const body = Buffer.from(zipSync({
    "[Content_Types].xml": strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    "_rels/.rels": strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    "word/document.xml": strToU8('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>2026年竞赛报名通知，参赛队伍人数最多三名学生，每队指导教师不多于两名，报名截止日期另行通知。</w:t></w:r></w:p><w:p><w:r><w:t>总决赛于2026年十一月举行。</w:t></w:r></w:p></w:body></w:document>'),
  }));
  const material = await parseFile("https://example.org/rules.docx", body, "application/octet-stream");
  assert.equal(material.blocks[0].id, "paragraph-1");
  assert.ok(material.blocks[0].text.includes("最多三名学生"));
  assert.ok(material.blocks[1].text.includes("十一月"));
  await assert.rejects(parseFile("https://example.org/binary", Buffer.from("bad"), "application/octet-stream"), /Unsupported/);
  await assert.rejects(parseFile("https://example.org/fake.doc", Buffer.from("not a Word document"), "application/msword"), /Unsupported/);
});

test("PDF parser reads individual pages, while image-only PDF is not silently treated as parsed", async () => {
  function pdf(text: string) {
    const content = `BT /F1 12 Tf 20 200 Td (${text}) Tj ET`;
    return Buffer.from(`%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj\n4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n5 0 obj << /Length ${content.length} >> stream\n${content}\nendstream endobj\ntrailer << /Root 1 0 R >>\n%%EOF`);
  }
  const m = await parseFile("https://example.org/notice.pdf", pdf("Official contest registration closes in October 2026."), "application/pdf");
  assert.equal(m.blocks[0].id, "page-1-block-1");
  assert.match(m.blocks[0].text, /October 2026/);
  await assert.rejects(parseFile("https://example.org/scanned.pdf", pdf(""), "application/pdf"), /OCR/);
});

test("ZIP rules preserve document positions while rejecting expansion and unsafe paths", async () => {
  const docx = zipSync({
    "[Content_Types].xml": strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    "_rels/.rels": strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    "word/document.xml": strToU8('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>2025年竞赛规则，每队三名学生，指导教师最多一名。参赛报名与初赛时间以该届官方通知为准。</w:t></w:r></w:p></w:body></w:document>'),
  });
  const material = await parseFile("https://example.org/rules.zip", Buffer.from(zipSync({ "rules.docx": docx, "form.xls": strToU8("unsupported") })), "application/zip");
  assert.match(material.blocks[0]!.id, /^entry-1-paragraph-1$/);
  assert.match(material.blocks[0]!.text, /每队三名学生/);
  assert.match(material.blocks.at(-1)!.text, /其他格式未解析/);
  await assert.rejects(parseFile("https://example.org/rules.zip", Buffer.from(zipSync({ "../rules.docx": docx })), "application/zip"), /Unsafe ZIP/);
  await assert.rejects(parseFile("https://example.org/rules.zip", Buffer.from(zipSync({ "huge.docx": new Uint8Array(9 * 1024 * 1024) })), "application/zip"), /expansion limit/);
  await assert.rejects(parseFile("https://example.org/rules.zip", Buffer.from(zipSync({ "form.xls": strToU8("unsupported") })), "application/zip"), /no supported readable/);
});
