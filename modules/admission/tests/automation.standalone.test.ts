import assert from "node:assert/strict";
import test from "node:test";
import { sourceConfigs, listingLinks, htmlMaterial, officialUrl, directoryLinks } from "../backend/sources.ts";
import { extractionSchema, validateEvidence, alignEvidence } from "../backend/automation-schema.ts";
import { schools } from "../schools.ts";
import { demoNotices } from "../backend/demo.ts";

test("all 39 historical 985 schools have unique official sources", () => {
  assert.deepEqual(sourceConfigs.map(s => s.schoolId).sort(), schools.filter(s => s.tier === "985").map(s => s.id).sort());
  assert.equal(new Set(sourceConfigs.map(s => s.schoolId)).size, 39);
  for (const source of sourceConfigs) for (const url of source.urls) assert.ok(officialUrl(source.schoolId, url), url);
  assert.equal(officialUrl("s001", "https://pku.edu.cn.evil.example/a"), false);
  assert.equal(officialUrl("s001", "http://127.0.0.1/a"), false);
  assert.ok(officialUrl("s105", "https://yz.nwsuaf.edu.cn/a.htm"));
});
test("observed official listing shapes retain admissions rules and exclude rosters and only catalogues", () => {
  const html = `<li><a href="info/1047/3678.htm" title="吉林大学2027年硕士研究生招生章程及招生专业目录">章程</a><span>2026-09-30</span></li>
    <li><a href="info/1047/3637.htm">吉林大学2027年接收优秀应届本科毕业生免试攻读研究生招生简章及专业目录</a></li>
    <li><a href="info/1049/3700.htm">吉林大学2027年接收推荐免试攻读研究生拟录取名单公示</a></li>
    <a href="ml.htm">2027年硕士专业目录</a><a href="sszs/zsgg.htm">硕士招生</a>`;
  const parsed = listingLinks(html, "https://yzb.jlu.edu.cn/", "s037");
  assert.equal(parsed.links.length, 2); assert.equal(parsed.links[0].publishedOn, "2026-09-30");
  assert.deepEqual(parsed.navigation, ["https://yzb.jlu.edu.cn/sszs/zsgg.htm"]);
  const ustc = listingLinks(`<div onclick="window.open('/redirect/url?redirectUrl=/static/upload/a.pdf&amp;type=1')">中国科学技术大学2027年硕士研究生招生章程</div>`, "https://yz.ustc.edu.cn/", "s066");
  assert.equal(ustc.links[0].url, "https://yz.ustc.edu.cn/static/upload/a.pdf");
  const mixed = listingLinks(`<a href="mixed.htm">湖南大学2027年接收推荐免试研究生（含直博生）预报名</a><a href="doctoral.htm">湖南大学2027年博士研究生招生简章</a>`, "https://gra.hnu.edu.cn/", "s085");
  assert.deepEqual(mixed.links.map(l => l.url), ["https://gra.hnu.edu.cn/mixed.htm"]);
});
test("faculty indexes distinguish official directories and concrete rules from homepage navigation", () => {
  const html = `<h1>吉林大学2027年各院系接收推免硕士研究生细则汇总</h1>
    <nav><a href="https://ccst.jlu.edu.cn/">计算机学院</a></nav><article>
    <a href="https://cs.jlu.edu.cn/tzgg.htm">软件学院</a>
    <a href="info/1047/rules.htm">计算机科学与技术学院</a>
    <a href="https://math.jlu.edu.cn/index.htm">数学学院</a>
    <a href="catalogue.pdf">2027年硕士招生专业目录</a>
    <a href="faculties.htm">各学院招生细则汇总</a>
    <a href="https://evil.example/rules.htm">法学院</a>
    <a href="roster.htm">计算机学院推免名单公示</a></article>`;
  const base = "https://yzb.jlu.edu.cn/faculty.htm";
  const directory = directoryLinks(html, base, "s037");
  assert.equal(directory.find(l => l.url.endsWith("catalogue.pdf"))?.kind, "catalogue");
  assert.equal(directory.find(l => l.url.endsWith("faculties.htm"))?.kind, "rules-index");
  assert.equal(directory.find(l => l.url === "https://ccst.jlu.edu.cn/")?.kind, "department");
  assert.ok(directory.every(l => l.parentUrl === base && !/evil|roster/.test(l.url)));
  const notices = listingLinks(html, base, "s037").links;
  assert.ok(notices.some(l => l.url.endsWith("rules.htm") && l.title.includes("2027")));
  assert.ok(notices.every(l => !/ccst|math\.jlu|catalogue|roster|evil|tzgg/.test(l.url)));
});
test("material hashes ignore fetch time but change with revised text or attached file link", () => {
  const text = "2027年硕士研究生招生通知，申请条件及报名方式以本公告为准。".repeat(5);
  const html = `<h1>招生通知</h1><article>${text}<a href="a.pdf">官方附件</a></article>`;
  const a = htmlMaterial(html, "https://yzb.jlu.edu.cn/info/1.htm");
  assert.equal(a.hash, htmlMaterial(html, a.url).hash);
  assert.notEqual(a.hash, htmlMaterial(html.replace("a.pdf", "b.pdf"), a.url).hash);
  assert.notEqual(a.hash, htmlMaterial(html.replace(text, text + "延期"), a.url).hash);
  const heading = htmlMaterial(`<title>研招办</title><h1>研招办</h1><p class="zkd-title">中国科学技术大学2027年推免生接收办法</p><article>${text}</article>`, "https://yz.ustc.edu.cn/a.htm");
  assert.equal(heading.blocks[0].text, "中国科学技术大学2027年推免生接收办法");
});
test("fabricated evidence and missing date support cannot pass publication preparation", () => {
  const { id: _id, schoolId: _school, source: _source, resources: _resources, ...fields } = demoNotices[0];
  const quote = "2027年推荐免试硕士招生，报名从2026年9月1日至9月20日17:00。";
  const material = htmlMaterial(`<article>${quote.repeat(5)}</article>`, "https://yz.tsinghua.edu.cn/info/1.htm");
  const notice = { ...fields, opensOn: "2026-09-01", deadline: "2026-09-20", deadlineTime: "17:00", eligibility: [], materials: [], evidence: ["year", "track", "stage", "summary", "opensOn", "deadline", "deadlineTime"].map(field => ({ field, materialId: material.id, blockId: "block-1", quote })) };
  assert.doesNotThrow(() => validateEvidence(notice, [material]));
  assert.throws(() => validateEvidence({ ...notice, deadline: "2026-09-21" }, [material]), /日期未匹配/);
  assert.throws(() => validateEvidence({ ...notice, opensOn: "2027-09-01", deadline: "2027-09-20" }, [material]), /日期年份缺少原文依据/);
  assert.throws(() => validateEvidence({ ...notice, evidence: notice.evidence.map(e => ({ ...e, quote: "编造的招生原文" })) }, [material]), /引用未匹配/);
  assert.throws(() => validateEvidence({ ...notice, materials: ["虚构的材料"] }, [material]), /缺少字段依据/);
  const spaced = htmlMaterial(`<article>${"2027年推荐免试硕士招生，报名从2026年9月1日10:00-8日10:00。".repeat(5)}</article>`, material.url);
  const spacedQuote = "2027 年推荐免试硕士招生，报名从2026 年9 月1 日10:00-8 日10:00。";
  assert.doesNotThrow(() => validateEvidence({ ...notice, deadline: "2026-09-08", deadlineTime: "10:00", evidence: notice.evidence.map(e => ({ ...e, materialId: spaced.id, quote: spacedQuote })) }, [spaced]));
  assert.throws(() => validateEvidence({ ...notice, deadline: "2026-09-09", deadlineTime: "10:00", evidence: notice.evidence.map(e => ({ ...e, materialId: spaced.id, quote: spacedQuote })) }, [spaced]), /日期未匹配/);
  assert.equal(extractionSchema.safeParse({ relevant: true, reason: "test", notices: [{ ...notice, year: 1999 }] }).success, false);
  const shifted = { ...notice, evidence: notice.evidence.map(e => ({ ...e, blockId: "wrong-block" })) };
  alignEvidence(shifted, [material]);
  assert.doesNotThrow(() => validateEvidence(shifted, [material]));
  const fabricated = { ...notice, evidence: notice.evidence.map(e => ({ ...e, quote: "原文不存在的句子", blockId: "wrong-block" })) };
  alignEvidence(fabricated, [material]);
  assert.throws(() => validateEvidence(fabricated, [material]), /引用未匹配/);
});
