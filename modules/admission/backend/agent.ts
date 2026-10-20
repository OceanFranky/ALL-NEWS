import { createHash } from "node:crypto";
import { z } from "zod";
import { load } from "cheerio";
import { sql } from "@aihot/backend/db";
import { audit } from "@aihot/backend/audit";
import { guardedFetch } from "@aihot/backend/lib/http-fetch";
import type { Material } from "@aihot/backend/documents/types";
import { agentSubmissionSchema, type AgentGoal, type AgentStatus } from "@aihot/contracts/admission-agent";
import type { AdmissionNotice } from "@aihot/contracts/admission";
import { schools, schoolById } from "../schools.ts";
import { schoolFromInput } from "../goal-input.ts";
import { automationEnabled, processDocument } from "./automation.ts";
import { sourceConfigs, documentId, htmlMaterial, readMaterials, officialUrl } from "./sources.ts";
import { AGENT_LIMITS, canonicalAgentUrl, emptyAgentState, planOfficialLinks, noticeCandidate, noticeGaps,
  type AgentState, type AgentLink, type AgentPage } from "./agent-planner.ts";
import { agentSearchQueries, agentSearchUrl, searchAgentQuery } from "./agent-search.ts";

interface AgentRow { id: string; goal: AgentGoal; state: AgentState; enabled: boolean; status: AgentStatus }
export const agentIdsSchema = z.strictObject({ ids: z.string().max(800).default("").transform(s => s ? s.split(",") : []).pipe(z.array(z.uuid()).max(20)) });
export function resolveAgentGoal(input: unknown): AgentGoal {
  const { source, ...parsed } = agentSubmissionSchema.parse(input);
  let resolved;
  try { resolved = source ? schoolFromInput(source, schools) : undefined; }
  catch (error) { throw Object.assign(error as Error, { statusCode: 400 }); }
  if (resolved && parsed.schoolId && resolved.id !== parsed.schoolId) throw Object.assign(new Error("学校名称与所选院校不一致，请重新选择。"), { statusCode: 400 });
  const school = schoolById.get(resolved?.id ?? parsed.schoolId ?? "");
  if (!school?.website) throw Object.assign(new Error("请选择院校目录内的学校。"), { statusCode: 400 });
  const goal = { ...parsed, schoolId: school.id };
  if (source && /^https?:\/\//i.test(source) && !goal.urls.length) goal.urls = [source];
  const allowed = goal.track === "kaoyan" ? ["exam", "prospectus", "retest", "adjustment"] : ["summer", "pre", "recommendation", "prospectus"];
  if (goal.stages.some(stage => !allowed.includes(stage))) throw Object.assign(new Error("关注阶段与保研／考研方向不一致。"), { statusCode: 400 });
  const urls = goal.urls.length ? goal.urls : sourceConfigs.find(s => s.schoolId === goal.schoolId)?.urls.slice(0, 2) ?? [school.website];
  if (urls.some(url => !canonicalAgentUrl(goal.schoolId, url) || new URL(url).port)) throw Object.assign(new Error("请提供该校不带口令或特殊端口的公开官网链接。"), { statusCode: 400 });
  return { ...goal, searchWeb: goal.searchWeb ?? true, urls: [...new Set(urls.map(url => canonicalAgentUrl(goal.schoolId, url)!))].sort(),
    keywords: [...new Set(goal.keywords)].sort(), stages: [...new Set(goal.stages)].sort() };
}
export async function submitAgent(input: unknown) {
  const goal = resolveAgentGoal(input), identity = createHash("sha256").update(JSON.stringify(goal)).digest("hex");
  return sql.begin(async tx => {
    await tx`SELECT pg_advisory_xact_lock(hashtextextended('admission-agent-submit',0))`;
    const [existing] = await tx<{ id: string }[]>`SELECT id FROM admission_agent_tasks WHERE identity=${identity}`;
    if (existing) return { id: existing.id, reused: true };
    const [count] = await tx<{ recent: number; total: number }[]>`SELECT count(*) FILTER(WHERE created_at>now()-interval '1 hour')::int AS recent,count(*)::int AS total FROM admission_agent_tasks`;
    if (count.recent >= 20 || count.total >= 200) throw Object.assign(new Error("当前目标任务较多，请稍后再试或联系管理员。"), { statusCode: 429 });
    await tx`INSERT INTO admission_sources(school_id,config) VALUES(${goal.schoolId},${tx.json({ schoolId: goal.schoolId, urls: goal.urls })}) ON CONFLICT DO NOTHING`;
    const [row] = await tx<{ id: string }[]>`INSERT INTO admission_agent_tasks(identity,goal,state) VALUES(${identity},${tx.json(goal)},${tx.json(emptyAgentState(1, goal.urls))}) RETURNING id`;
    return { id: row.id, reused: false };
  });
}
async function taskEvent(id: string, state: AgentState, stage: string, status: string, title: string, detail: string, url: string | null = null) {
  await sql`INSERT INTO admission_agent_steps(task_id,cycle,stage,status,title,detail,url) VALUES(${id},${state.cycle},${stage},${status},${title.slice(0, 200)},${detail.slice(0, 1000)},${url})`;
}
async function checkpoint(row: AgentRow, status: AgentStatus, delay: number) {
  await sql`UPDATE admission_agent_tasks SET state=${sql.json(row.state)},status=${status},checked_at=now(),next_check_at=now()+make_interval(secs=>${delay}) WHERE id=${row.id}`;
}
export async function commandAgent(id: string, input: unknown, actor: string) {
  z.uuid().parse(id); const { action } = z.strictObject({ action: z.enum(["pause", "resume", "retry"]) }).parse(input);
  return sql.begin(async tx => {
    const [lock] = await tx<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtextextended(${`admission-agent:${id}`},0)) AS locked`;
    if (!lock.locked) throw Object.assign(new Error("目标正在执行，请本轮步骤结束后再操作。"), { code: "conflict" });
    const [row] = await tx<AgentRow[]>`SELECT * FROM admission_agent_tasks WHERE id=${id} FOR UPDATE`;
    if (!row) throw Object.assign(new Error("目标任务不存在"), { statusCode: 404 });
    if (action !== "pause") for (const page of row.state.pages) if (["budget-paused", "awaiting-model"].includes(page.status)) page.status = "collected";
    // Failed pages are retried from their observed URL, not by erasing evidence or model reservations.
    if (action === "retry") for (const page of row.state.pages.filter(p => p.status === "read-failed")) {
      if (!row.state.frontier.some(l => l.url === page.url)) row.state.frontier.push({ ...page, reason: "管理员要求重读失败的官方页面" });
    }
    if (action === "retry") row.state.pages = row.state.pages.filter(p => p.status !== "read-failed");
    await tx`UPDATE admission_agent_tasks SET enabled=${action !== "pause"},status=${action === "pause" ? "paused" : "queued"},state=${tx.json(row.state)},next_check_at=now() WHERE id=${id}`;
    await audit(actor, `admission.agent.${action}`, `admission-agent:${id}`, null, null, { previous: row.status }, { db: tx });
    return { id, action };
  });
}
function addFrontier(state: AgentState, links: AgentLink[]) {
  const known = new Set([...state.frontier, ...state.pages].map(p => p.url));
  for (const link of links) {
    if (known.has(link.url)) {
      const queued = state.frontier.find(item => item.url === link.url);
      if (queued && link.priority < queued.priority) Object.assign(queued, link);
      continue;
    }
    if (link.depth > AGENT_LIMITS.depth + link.supplement || state.frontier.length >= AGENT_LIMITS.frontier) { state.truncated = true; continue; }
    state.frontier.push(link); known.add(link.url);
  }
  state.frontier.sort((a, b) => a.priority - b.priority || a.depth - b.depth);
}
async function discoverBySearch(row: AgentRow) {
  const state = row.state;
  if (!row.goal.searchWeb) return;
  if (!state.search) {
    state.search = { provider: "360搜索", checkedAt: new Date().toISOString(), links: [],
      queries: agentSearchQueries(row.goal).map(query => ({ query, url: agentSearchUrl(query), status: "pending", returned: 0, accepted: 0 })) };
    await checkpoint(row, "discovering", 60);
  }
  for (const query of state.search.queries) {
    if (query.status === "running") {
      query.status = "failed";
      await taskEvent(row.id, state, "search", "failed", "上次搜索中断", "保留已有官方入口；本轮不自动重复已发出的搜索。", query.url);
      await checkpoint(row, "discovering", 60);
    }
    if (query.status !== "pending") continue;
    query.status = "running";
    await taskEvent(row.id, state, "search", "running", "搜索新的官网线索", query.query, query.url);
    await checkpoint(row, "discovering", 60);
    try {
      const result = await searchAgentQuery(query.query, row.goal);
      query.returned = result.returned; query.accepted = result.links.length;
      query.status = result.links.length ? "ready" : "empty";
      addFrontier(state, result.links);
      for (const link of result.links) if (!state.search.links.some(item => item.url === link.url)) state.search.links.push({ url: link.url, title: link.title });
      await taskEvent(row.id, state, "search", query.status, "搜索结果已筛选", `搜索词：${query.query}；读取${result.returned}条结果，接纳${result.links.length}条本校官网线索。搜索摘要不作为招生条件依据。`, query.url);
    } catch {
      query.status = "failed";
      await taskEvent(row.id, state, "search", "failed", "搜索暂不可用", `搜索词：${query.query}；服务受限、超时或页面结构无法识别。继续检查已有官方入口，不绕过验证码。`, query.url);
    }
    state.search.checkedAt = new Date().toISOString();
    await checkpoint(row, "discovering", 60);
  }
  if (state.search.queries.some(query => query.status === "failed")) state.gaps.push("本轮部分联网搜索未完成，搜索覆盖不完整；已保留官网入口继续查找。");
  else if (!state.search.links.length) state.gaps.push("本轮联网搜索未发现符合学校域名和年份范围的官网线索；不代表该校未发布公告。");
}
async function currentNotices(state: AgentState) {
  const ids = state.pages.filter(p => p.candidate && ["published", "unchanged"].includes(p.status)).map(p => p.documentId);
  return ids.length ? await sql<{ draft: AdmissionNotice }[]>`SELECT DISTINCT n.id,n.published AS draft FROM admission_documents d CROSS JOIN LATERAL jsonb_array_elements_text(d.notice_ids) i JOIN admission_notices n ON n.id=i.value::uuid WHERE d.id IN ${sql(ids)} AND n.published IS NOT NULL` : [];
}
async function extractPage(row: AgentRow, page: AgentPage, materials: Material[]) {
  await taskEvent(row.id, row.state, "extract", "running", "提取并核对字段证据", "沿用已有模型回执、累计预算、原文引用检查和发布保护。", page.url);
  await checkpoint(row, "extracting", 60);
  const result = await processDocument(page.documentId, false, materials, true);
  page.status = result.status;
  const gaps = noticeGaps((await currentNotices(row.state)).map(n => n.draft), row.goal);
  row.state.gaps = [...new Set([...row.state.gaps.filter(g => !/尚未找到|部分目标公告/.test(g)), ...gaps])];
  await taskEvent(row.id, row.state, "validate", result.status, "提取／校验结果", result.status === "published" || result.status === "unchanged" ? "材料已通过原有提取与发布链路；只将年份、阶段和方向匹配的结果列入目标。" : result.status === "budget-paused" ? "材料已保存，累计模型额度不足；未生成新的要求。" : result.status === "awaiting-model" ? "材料已保存，模型未启用；不推测申请条件。" : "当前未产生新的可发布结果，可能无关、证据不足或存在人工保护。", page.url);
}
export async function runAgent(id: string) {
  if (!automationEnabled()) return { status: "disabled" };
  const connection = await sql.reserve(), key = `admission-agent:${id}`;
  const [lock] = await connection<{ locked: boolean }[]>`SELECT pg_try_advisory_lock(hashtextextended(${key},0)) AS locked`;
  if (!lock.locked) { connection.release(); return { status: "running" }; }
  let row: AgentRow | undefined;
  try {
    [row] = await sql<AgentRow[]>`SELECT * FROM admission_agent_tasks WHERE id=${id}`;
    if (!row?.enabled) return { status: "paused" };
    if (["completed", "partial"].includes(row.status) || row.status === "failed" && !row.state.frontier.length && !row.state.pages.some(p => p.candidate && p.status === "collected")) {
      const remaining = row.state.frontier;
      row.state = emptyAgentState(row.state.cycle + 1, row.goal.urls);
      // Read carry-over URLs first so a large, unchanged entry page cannot starve later faculty links.
      addFrontier(row.state, remaining.map(link => ({ ...link, depth: 0, priority: -1 })));
    }
    const state = row.state, started = Date.now();
    if (!state.pages.length) await taskEvent(id, state, "plan", "ready", "确定本轮范围", `${row.goal.year}级；方向：${row.goal.keywords.join("、")}；只跟进该校已观察到的公开官方链接。`);
    await checkpoint(row, "discovering", 60);
    await discoverBySearch(row);
    let work = 0;
    // Persisted collected pages are resumed without another network read after a crash or budget pause.
    for (const page of state.pages.filter(p => p.candidate && p.status === "collected").slice(0, 2)) {
      const [snapshot] = await sql<{ material: Material[] }[]>`SELECT material FROM admission_snapshots WHERE document_id=${page.documentId} AND hash=${page.hash}`;
      if (snapshot) await extractPage(row, page, snapshot.material);
      else {
        page.status = "read-failed";
        state.gaps.push("已保存材料缺失，请管理员重新读取对应官方页面。");
        await taskEvent(id, state, "read", "failed", page.title, "检查点引用的材料快照缺失，未生成要求。", page.url);
      }
      work++; await checkpoint(row, "discovering", 60);
      if (["budget-paused", "awaiting-model"].includes(page.status)) break;
    }
    const blocked = () => state.pages.some(p => ["budget-paused", "awaiting-model"].includes(p.status));
    while (!blocked() && state.frontier.length && state.pages.length < AGENT_LIMITS.pages && work < 2 && Date.now() - started < AGENT_LIMITS.stepMs) {
      const link = state.frontier[0]; work++;
      await taskEvent(id, state, link.supplement ? "supplement" : "discover", "running", link.title, link.reason, link.url);
      await checkpoint(row, link.supplement ? "supplementing" : "discovering", 60);
      try {
        if (!canonicalAgentUrl(row.goal.schoolId, link.url)) throw new Error("invalid-official-link");
        const response = await guardedFetch(link.url, { timeoutMs: 20000, maxBytes: 16 * 1024 * 1024 });
        if (response.status !== 200 || !officialUrl(row.goal.schoolId, response.url)) throw new Error("official-page-unavailable");
        const type = response.headers.get("content-type") ?? "";
        const isFile = /\.(pdf|docx?)(?:[?#]|$)/i.test(response.url) || /pdf|officedocument|msword/.test(type);
        const html = isFile ? "" : response.text();
        const first = html ? htmlMaterial(html, response.url) : undefined;
        const title = html ? (load(html)("h1,h2,h3,title").first().text().trim() || first?.blocks.find(b => b.id === "title")?.text || link.title).replace(/\s+/g, " ").trim().slice(0, 200) : link.title;
        const candidate = isFile || noticeCandidate(title, first?.blocks.map(b => b.text).join(" ") ?? "", response.url, row.goal);
        if (!isFile && (!/html/.test(type) || !first?.blocks.some(b => b.id !== "title" && b.text.length >= 80))) throw new Error("empty-or-dynamic-page");
        // Reuse the fetched body: attachment parsing is bounded by the same existing reader.
        let materials: Material[];
        if (isFile) {
          const { parseFile } = await import("@aihot/backend/documents/files");
          materials = [await parseFile(response.url, response.body, type, true, 16 * 1024 * 1024)];
        } else materials = candidate ? await readMaterials(row.goal.schoolId, { ...link, publishedOn: null }, { first, maxAttachments: AGENT_LIMITS.attachments }) : [first!];
        const characters = materials.reduce((total, m) => total + m.blocks.reduce((n, b) => n + b.text.length, 0), 0);
        if (characters < 80 || characters > 80000) throw new Error("material-text-limit");
        const hash = createHash("sha256").update(JSON.stringify(materials.map(m => [m.url, m.hash]))).digest("hex");
        const docId = documentId(row.goal.schoolId, link.url);
        await sql`INSERT INTO admission_documents(id,school_id,url,title) VALUES(${docId},${row.goal.schoolId},${link.url},${title}) ON CONFLICT(school_id,url) DO NOTHING`;
        await sql`INSERT INTO admission_snapshots(document_id,hash,material) VALUES(${docId},${hash},${sql.json(materials as never)}) ON CONFLICT DO NOTHING`;
        const page: AgentPage = { ...link, title, documentId: docId, candidate, status: candidate ? "collected" : "discovered", hash };
        state.pages.push(page); state.frontier.shift();
        if (html) addFrontier(state, planOfficialLinks(html, response.url, row.goal, link, candidate));
        await taskEvent(id, state, "read", "ready", title, `已读取${materials.length}份正文／附件材料；保存版本${hash.slice(0, 12)}。`, link.url);
        if (materials[0].links.some(l => /\.(pdf|docx?)(?:[?#]|$)/i.test(l.url) && !materials.some(m => m.url === l.url))) state.gaps.push("部分附件未解析或超出每篇三附件范围，请核对原文件。");
        // Checkpoint before extraction; a restart will reuse this exact material snapshot.
        await checkpoint(row, "discovering", 60);
        if (candidate) await extractPage(row, page, materials);
        await checkpoint(row, "discovering", 60);
      } catch {
        if (state.frontier[0]?.url === link.url) state.frontier.shift();
        if (!state.pages.some(p => p.url === link.url)) state.pages.push({ ...link, documentId: documentId(row.goal.schoolId, link.url), candidate: false, status: "read-failed", hash: "" });
        state.gaps.push("有官方页面或附件未能读取；可提供可访问的具体公告链接，由管理员重新执行。");
        await taskEvent(id, state, "read", "failed", link.title, "官方页面／附件不可读、正文不足或处理未完成；未据此生成要求，保留已有公开版本。", link.url);
        await checkpoint(row, "discovering", 60);
      }
    }
    state.gaps = [...new Set([...state.gaps.filter(g => !/尚未找到|尚未整理出|部分目标公告/.test(g)), ...noticeGaps((await currentNotices(state)).map(n => n.draft), row.goal)])];
    if (!blocked() && (state.pages.some(p => p.candidate && p.status === "collected") || state.frontier.length && state.pages.length < AGENT_LIMITS.pages)) { await checkpoint(row, "queued", 60); return { status: "queued" }; }
    if (state.pages.length >= AGENT_LIMITS.pages && state.frontier.length || state.truncated) state.gaps.push("本轮已达页面、深度或候选上限；未穷尽该校全部院系，剩余入口已保留。");
    state.gaps = [...new Set(state.gaps)];
    const statuses = state.pages.map(p => p.status);
    state.gaps = state.gaps.filter(g => !g.startsWith("模型额度不足") && !g.startsWith("模型未启用"));
    if (statuses.includes("budget-paused")) state.gaps.push("模型额度不足，已保存材料；管理员恢复后继续，未追加费用。");
    if (statuses.includes("awaiting-model")) state.gaps.push("模型未启用，已保存材料但尚未完成条件提取。");
    const status: AgentStatus = statuses.includes("budget-paused") ? "budget-paused" : statuses.includes("awaiting-model") ? "awaiting-model"
      : statuses.includes("needs-review") ? "needs-review" : state.pages.every(p => p.status === "read-failed") ? "failed" : state.gaps.length ? "partial" : "completed";
    await taskEvent(id, state, "finish", status, "本轮检查结束", `已检查${state.pages.length}页；保留${state.frontier.length}个未读入口。检查结束不代表该校全部专业要求已覆盖。`);
    await checkpoint(row, status, 3600);
    return { status };
  } catch {
    if (row) { row.state.gaps.push("工作流执行中断，已保存检查点，请管理员核对后恢复。"); await checkpoint(row, "failed", 3600); }
    return { status: "failed" };
  } finally { try { await connection`SELECT pg_advisory_unlock(hashtextextended(${key},0))`; } finally { connection.release(); } }
}
