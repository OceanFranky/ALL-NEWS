import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { closeDb } from "@aihot/backend/db";
import { resourceManifestSchema } from "../backend/import.ts";

try {
  const { values } = parseArgs({ options: { output: { type: "string" } } });
  const manifest = resourceManifestSchema.parse(JSON.parse(readFileSync(new URL("../seeds/competition-resources.json", import.meta.url), "utf8")));
  const catalogue = JSON.parse(readFileSync(new URL("../../competition/catalogue.json", import.meta.url), "utf8")).entries as { id: string; name: string }[];
  const published = manifest.resources.filter(item => item.decision === "publish");
  const count = (id: string, kind: string) => published.filter(item => item.data.kind === kind && item.links.some(link => link.competitionId === id)).length;
  const lines = ["# 31项竞赛精选资源核验清单", "", `清单更新日期：${manifest.checkedAt}；各条核验日期见对应依据。这是导入清单的内容审核结果，不代替实际数据库发布状态。`, "",
    `共${manifest.resources.length}条：${published.filter(item => item.data.kind === "experience").length}条经验分享、${published.filter(item => item.data.kind === "video").length}条视频资源拟发布；${manifest.resources.length - published.length}条候选留草稿。经验分享包含完整文章、学习笔记、方案合集及明确标注的高校摘要，不能全部称为完整经验帖。`, "",
    "视频仅核实页面简介或官网列出的回放；未逐一播放。正文受限、活动新闻、赛道身份未明的条目不计入已核验数量。旧届经验不作为当届规则。", "",
    "小红书：2026-10-19公开搜索返回安全限制300012；官方开放平台核验到电商接口，未确认通用笔记搜索权限。本清单没有虚构小红书笔记，也没有把搜索入口计作帖子。已有导入格式可保存真实笔记链接，核验后由管理员发布。", "",
    "| 编号 | 竞赛 | 经验分享 | 视频 | 待补/限制 |", "| --- | --- | ---: | ---: | --- |"];
  for (const entry of catalogue) lines.push(`| ${entry.id.slice(-3)} | ${entry.name} | ${count(entry.id, "experience")} | ${count(entry.id, "video")} | ${manifest.gaps.find(item => item.competitionId === entry.id)?.note ?? "待核对"} |`);
  for (const entry of catalogue) {
    lines.push("", `## ${entry.id.slice(-3)} ${entry.name}`, "");
    for (const item of manifest.resources.filter(item => item.links.some(link => link.competitionId === entry.id))) {
      lines.push(`- **${item.decision === "publish" ? "已核验/拟发布" : "候选/草稿"} · ${item.data.kind === "video" ? "视频" : "经验分享"}** [${item.data.title}](${item.data.url})`,
        `  来源：${item.data.author ?? "作者未知"}；${item.data.platform}；${item.data.publishedDate ?? "发布日期未确认"}；${item.data.official ? "官方来源" : "非主办方官方资源"}。`,
        `  ${item.data.summary}`, `  适用：${item.links.filter(link => link.competitionId === entry.id).map(link => link.scope).join("；")}。`, `  核验依据：${item.data.summaryBasis}`);
    }
  }
  const output = lines.join("\n") + "\n";
  if (values.output) writeFileSync(values.output, output);
  else console.log(output);
} finally { await closeDb(); }
