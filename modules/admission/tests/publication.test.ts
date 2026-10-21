import assert from "node:assert/strict";
import test from "node:test";
import { sql, closeDb } from "@aihot/backend/db";
import { config } from "@aihot/backend/config";
import { installModules } from "@aihot/backend/modules";
import { buildApp } from "@aihot/api/app";
import admission from "../server.ts";
import { testNotices } from "./fixtures.ts";
import { saveNotice, changePublication } from "../backend/store.ts";
import { readNotice, readNotices } from "../backend/publication.ts";
import type { AdmissionNotice } from "@aihot/contracts/admission";

installModules([admission]);
const app = await buildApp();
test.after(async () => { await app.close(); installModules([]); await closeDb(); });
const { id: _demoId, ...example } = testNotices[0];
const notice: AdmissionNotice = { ...example, title: "测试公告，不是真实招生信息", source: { title: "集成测试官方来源", url: "https://yz.tsinghua.edu.cn/info/1001/99999.htm", publishedOn: "2026-09-01", checkedOn: "2026-10-17", verified: true, evidence: "用于自动化隔离测试的核验文字：院系、专业、阶段、批次和时间均为测试数据，不对外发布。" } };
let id = "";
test("drafts stay private; publication pins a version; edit conflicts and withdrawal are audited", async () => {
  const before = await sql`SELECT (SELECT count(*)::int FROM articles) AS news, (SELECT count(*)::int FROM receipts) AS receipts`;
  const saved = await saveNotice({ notice, reason: "集成测试草稿" }, "test"); id = saved.id;
  assert.equal((await readNotices({})).total, 0); assert.equal(await readNotice(id), null);
  await assert.rejects(saveNotice({ notice, reason: "重复身份测试" }, "test"), /已存在/);
  const publicRecord = await changePublication(id, "publish", { expectedVersion: 1, reason: "集成测试发布" }, "test");
  assert.equal(publicRecord.version, 2); assert.equal((await readNotice(id))?.title, notice.title);
  for (const dataset of ["live", "demo"]) {
    const list = await readNotices({ dataset });
    assert.equal(list.dataset, "live");
    assert.deepEqual(list.items.map(item => item.id), [id]);
  }
  const revised = { ...notice, title: "已修改的测试草稿标题" };
  const results = await Promise.allSettled([1, 2].map(() => saveNotice({ id, expectedVersion: 2, notice: revised, reason: "并发测试" }, "test")));
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal((await readNotice(id))?.title, notice.title);
  await assert.rejects(saveNotice({ id, expectedVersion: 3, notice: { ...revised, year: 2028 }, reason: "错误改年" }, "test"), /先撤回/);
  await assert.rejects(changePublication(id, "publish", { expectedVersion: 2, reason: "过期版本" }, "test"), /变化/);
  await changePublication(id, "publish", { expectedVersion: 3, reason: "再次发布" }, "test");
  assert.equal((await readNotice(id))?.title, revised.title);
  assert.equal((await readNotices({ track: "kaoyan" })).total, 0);
  assert.equal((await readNotices({ q: "清华 计算机", tier: "211", year: "2027" })).total, 1);
  const response = await app.inject(`/api/v1/admissions/${id}`);
  assert.equal(response.statusCode, 200); assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(response.json().draft, undefined); assert.equal(response.json().identity_key, undefined);
  await changePublication(id, "withdraw", { expectedVersion: 4, reason: "测试撤回" }, "test");
  assert.equal((await app.inject(`/api/v1/admissions/${id}`)).statusCode, 404); assert.equal((await readNotices({})).total, 0);
  assert.equal((await sql`SELECT action FROM audit_log WHERE subject = ${`admission:${id}`}`).length, 5);
  assert.deepEqual(await sql`SELECT (SELECT count(*)::int FROM articles) AS news, (SELECT count(*)::int FROM receipts) AS receipts`, before);
});
test("only published records are exposed, retired example URLs cannot return fixtures, admin uses auth and CSRF", async () => {
  assert.equal((await readNotices({ dataset: "demo" })).total, 0); assert.equal((await readNotices({})).total, 0);
  assert.equal((await app.inject("/api/v1/admissions/demo-1")).statusCode, 400);
  for (const query of ["?x=1", "?page=0", "?page=1&page=2", "?year=bad", "?dataset=all"]) assert.equal((await app.inject(`/api/v1/admissions${query}`)).statusCode, 400, query);
  assert.equal((await app.inject("/api/v1/admissions?school=&year=&track=&stage=&province=&tier=&status=&q=")).statusCode, 200);
  assert.equal((await app.inject("/api/v1/admissions/bad")).statusCode, 400);
  assert.equal((await app.inject("/api/admin/admissions")).statusCode, 401);
  const old = config.devAdmin; config.devAdmin = { displayName: "admission-test" };
  try {
    const me = (await app.inject("/api/admin/me")).json();
    const payload = { id, notice, expectedVersion: 5, reason: "管理员验证" };
    assert.equal((await app.inject({ method: "POST", url: "/api/admin/admissions", payload })).statusCode, 403);
    assert.equal((await app.inject({ method: "POST", url: "/api/admin/admissions", headers: { "x-csrf-token": me.csrf }, payload })).statusCode, 200);
    assert.equal((await app.inject({ method: "POST", url: `/api/admin/admissions/${id}/publish`, headers: { "x-csrf-token": me.csrf }, payload: { expectedVersion: 5, reason: "旧版本" } })).statusCode, 409);
  } finally { config.devAdmin = old; }
});

test("faculty filters are exact and school references cannot mix years, tracks or withdrawn drafts", async () => {
  const publish = async (fields: Partial<AdmissionNotice>) => {
    const record = await saveNotice({ notice: { ...notice, ...fields }, reason: "院系隔离测试" }, "test");
    return changePublication(record.id, "publish", { expectedVersion: 1, reason: "院系测试发布" }, "test");
  };
  const department = "计算机科学与技术系", programme = "081200 计算机科学与技术";
  const faculty = await publish({ department, programme, batch: "faculty-filter" });
  const common = { department: "全校（具体范围见原文）", programme: "适用专业见官方目录" };
  const reference = await publish({ ...common, batch: "school-reference" });
  const wrongYear = await publish({ ...common, year: 2028, batch: "next-year" });
  const wrongTrack = await publish({ ...common, track: "kaoyan", stage: "prospectus", batch: "other-track" });
  const wrongSchool = await publish({ ...common, schoolId: "s001", batch: "other-school", source: { ...notice.source, url: "https://admission.pku.edu.cn/test.htm" } });
  await sql`INSERT INTO admission_sources(school_id,config) VALUES(${notice.schoolId},'{}')`;
  await sql`INSERT INTO admission_directory(school_id,url,title,kind,parent_url) VALUES(${notice.schoolId},'https://yz.tsinghua.edu.cn/catalogue.pdf','2027年目录','catalogue','https://yz.tsinghua.edu.cn/')`;
  const list = await readNotices({ school: notice.schoolId, department, programme });
  assert.deepEqual(list.items.map(n => n.id), [faculty.id]);
  assert.deepEqual(list.schoolRules.map(n => n.id), [reference.id]);
  assert.deepEqual(list.departments, [department]);
  assert.deepEqual(list.programmes, [programme]);
  assert.equal(list.directory.length, 1);
  assert.equal((await readNotices({ school: notice.schoolId, department: "计算机" })).total, 0);
  assert.equal((await readNotices({ school: "s001", department })).directory.length, 0);
  await changePublication(reference.id, "withdraw", { expectedVersion: reference.version, reason: "撤回参考" }, "test");
  assert.equal((await readNotices({ school: notice.schoolId, department })).schoolRules.length, 0);
  for (const record of [faculty, wrongYear, wrongTrack, wrongSchool]) await changePublication(record.id, "withdraw", { expectedVersion: record.version, reason: "测试清理" }, "test");
});
