import type { CompetitionResources, PublicResource } from "@aihot/contracts/learning-resources";
import { useRevalidator } from "react-router";
import { safeLink } from "./format.ts";

const types = { participation: "参赛经历", beginner: "入门建议", tutorial: "工具教程", retrospective: "赛后复盘" };
function ResourceCard({ resource }: { resource: PublicResource }) {
  const { data, links } = resource;
  const href = safeLink(data.url);
  const cover = safeLink(data.coverUrl);
  return <article className="min-w-0 rounded-panel border border-line p-4" data-learning-resource={resource.id}>
    {cover && <img src={cover} alt="" loading="lazy" className="mb-3 max-h-48 w-full rounded-control object-contain" />}
    <div className="mb-2 flex flex-wrap gap-2 text-[11px] text-ink-3"><span>{types[data.contentType]}</span><span>{data.official ? "官方资源" : "个人经验／非官方资源"}</span><span>{data.verification === "verified" ? data.kind === "video" ? "页面已核验" : "已核验" : "待核验"}</span></div>
    <h3 className="break-words text-[15px] font-semibold leading-relaxed text-ink">{href ? <a href={href} target="_blank" rel="noopener noreferrer" className="hover:text-accent hover:underline">{data.title} ↗</a> : data.title}</h3>
    <p className="mt-2 break-words text-[12px] leading-relaxed text-ink-3">{data.author ?? "作者未知"} · {data.platform}{data.publishedDate ? ` · 发布于${data.publishedDate}` : data.publishedYear ? ` · ${data.publishedYear}年发布` : " · 发布时间未知"}{data.kind === "video" && data.durationSeconds ? ` · ${Math.floor(data.durationSeconds / 60)}分${data.durationSeconds % 60}秒` : ""}</p>
    <p className="mt-3 text-[12px] text-ink-3">主题：{data.topic}</p>
    <p className="mt-2 whitespace-pre-line break-words text-[13px] leading-6 text-ink-2">{data.summary}</p>
    <ul className="mt-3 space-y-1 rounded-control bg-bg-sunk p-3 text-[12px] leading-relaxed text-ink-2">{links.map((link, index) => <li key={index}>{link.editionId ? "对应本届" : link.year ? `${link.year}年适用` : "跨届通用"}{link.editionId && link.year ? ` · ${link.year}年` : ""} · {link.scope}</li>)}</ul>
    <p className="mt-3 break-words text-[11px] leading-relaxed text-ink-4">介绍依据：{data.summaryBasis}</p>
    {data.availabilityMessage && <p className="mt-2 text-[12px] text-amber-ink">{data.availabilityMessage}</p>}
    {href && <a href={href} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex min-h-10 items-center text-[13px] font-medium text-accent hover:underline">{data.kind === "video" ? "到原平台观看" : "阅读原文"} ↗</a>}
  </article>;
}
export function LearningResources({ resources, failed }: { resources: CompetitionResources | null; failed: boolean }) {
  const revalidator = useRevalidator();
  return <>{(["experience", "video"] as const).map(kind => <section key={kind} aria-labelledby={`resource-${kind}`} className="card min-w-0 p-5 lg:p-6">
    <h2 id={`resource-${kind}`} className="text-[16px] font-semibold text-ink">{kind === "experience" ? "经验帖" : "教学视频"}</h2>
    <p className="mb-4 mt-2 text-[12px] leading-relaxed text-ink-3">{kind === "experience" ? "参赛经验供参考，适用年份与赛段见各资源说明；当届规则以官方通知为准。" : "前往原平台观看，适用年份与教学范围见各资源说明。"}</p>
    {failed ? <div role="status" className="text-[13px] text-ink-3"><p>资源暂时无法加载，请稍后重试。</p><button type="button" disabled={revalidator.state !== "idle"} onClick={() => revalidator.revalidate()} className="mt-2 min-h-10 text-accent">{revalidator.state !== "idle" ? "正在重试…" : "重新加载资源"}</button></div> : resources?.[kind].length ? <div className="space-y-4">{resources[kind].map(resource => <ResourceCard key={resource.id} resource={resource} />)}</div> : <p className="rounded-control bg-bg-sunk p-4 text-[13px] text-ink-3">暂未收录{kind === "experience" ? "可核实的经验帖" : "可核实的教学视频"}。</p>}
  </section>)}</>;
}
