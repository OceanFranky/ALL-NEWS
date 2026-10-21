import { Form, Link, data, useLoaderData, useSearchParams, type LoaderFunctionArgs } from "react-router";
import { stages, tracks, statusLabels, type NoticeList, type AdmissionSchool } from "@aihot/contracts/admission";
import { loadOr404 } from "@aihot/web/lib/api.server";
import { pageMeta } from "@aihot/web/lib/seo";
import { PhoneBar } from "@aihot/web/components/shell/PhoneBar";
import { buttonClass } from "@aihot/web/components/ui/Controls";
import { AdmissionNav, NoticeCard, inputClass } from "./components.tsx";
export { AdmissionError as ErrorBoundary } from "./components.tsx";
export const handle = { tab: "admission", name: "保研 · 考研" };
export const headers = () => ({ "Cache-Control": "no-store" });
export async function loader({ request }: LoaderFunctionArgs) {
  const query = new URL(request.url).searchParams;
  const [list, schools] = await Promise.all([loadOr404<NoticeList>(`/api/v1/admissions?${query}`, { signal: request.signal }), loadOr404<AdmissionSchool[]>("/api/v1/admissions/schools", { signal: request.signal })]);
  return data({ list, schools }, { headers: headers() });
}
export function meta() { return pageMeta({ title: "保研 · 考研", description: "按院校、年份、专业与阶段整理升学信息，核对官方来源，准备申请材料。", path: "/admissions" }); }
export default function AdmissionLibrary() {
  const { list, schools } = useLoaderData<typeof loader>(); const [params] = useSearchParams();
  const pageLink = (page: number) => { const next = new URLSearchParams(params); next.set("page", String(page)); return `?${next}`; };
  const directionLink = (word: string) => { const next = new URLSearchParams(params); next.set("q", word); next.delete("department"); next.delete("programme"); next.delete("page"); return `?${next}`; };
  const select = (name: string, label: string, options: Array<[string, string]>) => <label className="min-w-0 text-xs text-ink-3"><span className="mb-2 block">{label}</span><select key={`${name}:${params.get(name) ?? ""}`} name={name} defaultValue={params.get(name) ?? ""} disabled={(name === "department" || name === "programme") && !params.get("school")} className={inputClass} onChange={event => {
    if (name !== "school" && name !== "department") return;
    const form = event.currentTarget.form!;
    for (const field of name === "school" ? ["department", "programme"] : ["programme"]) { const input = form.elements.namedItem(field) as HTMLSelectElement | null; if (input) input.value = ""; }
    form.requestSubmit();
  }}><option value="">全部</option>{options.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>;
  return <><PhoneBar title="保研 · 考研" /><div className="pb-10 pt-3 lg:pt-0"><AdmissionNav />
    <header className="mb-7 grid gap-6 border-b border-line pb-7 md:grid-cols-[minmax(0,1fr)_auto]"><div><p className="mb-3 text-xs font-semibold tracking-[0.22em] text-accent">下一站 · 研究生</p><h1 data-page-title className="font-serif text-3xl font-bold leading-tight tracking-tight text-ink lg:text-4xl">把升学信息，变成行动。</h1><p className="mt-4 max-w-xl text-sm leading-7 text-ink-3">从选校、核对条件，到准备材料。让保研和考研的每一步，都有可追溯的依据。</p></div><div className="flex items-end gap-6"><div><p className="num text-3xl font-semibold text-accent">{list.coverage.schools}</p><p className="mt-1 text-xs text-ink-3">985／211院校目录</p></div><div className="border-l border-line pl-6"><p className="num text-3xl font-semibold text-ink">{list.coverage.notices}</p><p className="mt-1 text-xs text-ink-3">来源可追溯公告</p></div></div></header>
    <div className="mb-5 flex justify-end"><Link to="/admissions/sources" className={buttonClass("primary")}>＋ 添加官网链接</Link></div>
    <nav aria-label="热门专业方向" className="mb-4 flex flex-wrap items-center gap-2 text-xs"><span className="mr-1 text-ink-3">优先关注</span>{["计算机", "软件", "电子信息", "人工智能"].map(word => <Link key={word} to={directionLink(word)} className="rounded-full border border-line px-3 py-2 text-accent hover:bg-accent-soft">{word}</Link>)}</nav>
    <Form key={params.toString()} className="card mb-7 p-4 lg:p-5" role="search"><div className="flex gap-3"><label className="min-w-0 flex-1"><span className="sr-only">搜索院校、专业或公告</span><input name="q" defaultValue={params.get("q") ?? ""} maxLength={200} placeholder="搜索院校、院系、专业或公告" className={inputClass} /></label><button type="submit" className={buttonClass("primary", "lg")}>筛选</button></div>
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">{select("track", "升学路径", Object.entries(tracks))}{select("stage", "招生阶段", Object.entries(stages))}{select("tier", "院校层次", [["985", "985"], ["211", "211（含985）"], ["other", "其他本科"]])}{select("province", "所在地区", [...new Set(schools.map(s => s.province))].map(s => [s, s]))}
      {select("school", "目标院校", schools.map(s => [s.id, s.name]))}{select("department", "已收录院系", list.departments.map(value => [value, value]))}{select("programme", "已收录专业／项目", list.programmes.map(value => [value, value]))}<label className="text-xs text-ink-3"><span className="mb-2 block">入学年份（不是公告年份）</span><input name="year" type="number" min="2020" max="2100" placeholder="如 2027" defaultValue={params.get("year") ?? ""} className={inputClass} /></label>{select("status", "时间状态", Object.entries(statusLabels))}<div className="flex items-end"><Link to="/admissions" className="flex min-h-11 items-center text-sm text-accent">清除筛选</Link></div></div>
      <p className="mt-3 text-xs leading-6 text-ink-3">先选学校，再选已收录的院系／专业。选项只代表站内已有公告，不是该校完整院系或专业名单；没有细则时请从下方官方入口查找。</p>
    </Form>
    {params.get("school") && <section className="card mb-7 min-w-0 p-5"><h2 className="text-lg font-semibold text-ink">院系细则与专业目录入口</h2><p className="mt-2 text-xs leading-6 text-ink-3">以下链接来自学校官网。入口已发现不代表目标网页已读取或各专业要求已整理；招生目录、考试科目与学院细则请结合当年原文核对。</p>
      {!list.directory.length && <p className="mt-3 text-sm text-ink-3">这所学校的院系／专业入口还在补充；当前校级公告不能替代学院要求。</p>}
      {([ ["rules-index", "院系招生细则／汇总"], ["catalogue", "招生专业目录"], ["department", "学院官方网站"] ] as const).map(([kind, label]) => { const popular = (title: string) => Number(/计算机|软件|人工智能|电子信息|信息工程|网络空间/.test(title)); const links = list.directory.filter(link => link.kind === kind).sort((a, b) => popular(b.title) - popular(a.title)); return links.length > 0 && <details key={kind} className="mt-3 border-t border-line pt-3"><summary className="cursor-pointer text-sm font-medium text-accent">{label}（{links.length}）</summary><ul className="mt-3 grid gap-3 md:grid-cols-2">{links.map(link => <li key={link.url} className="min-w-0 text-sm leading-6"><a href={link.url} target="_blank" rel="noopener noreferrer" className="break-words text-accent underline">{link.title} ↗</a><a href={link.parentUrl} target="_blank" rel="noopener noreferrer" className="ml-2 text-xs text-ink-3 underline">链接出处</a></li>)}</ul></details>; })}
    </section>}
    {list.schoolRules.length > 0 && <section className="mb-7"><h2 className="mb-2 text-lg font-semibold text-ink">同年度、同路径的校级参考</h2><p className="mb-4 text-xs leading-6 text-ink-3">与下方院系／项目公告分开展示。适用范围和招生阶段请分别核对，校级条件不代表学院的全部要求。</p><div className="grid gap-4 xl:grid-cols-2">{list.schoolRules.map(item => <NoticeCard key={item.id} item={item} />)}</div></section>}
    <div className="mb-4 flex flex-wrap items-end justify-between gap-2"><h2 className="text-lg font-semibold text-ink">招生公告 <span className="ml-2 text-sm font-normal text-ink-3">{list.total} 条</span></h2><p className="text-xs text-ink-3">按站内最近收录／更新时间排列 · 时间均为北京时间</p></div>
    <div className="grid gap-4 xl:grid-cols-2">{list.items.map(item => <NoticeCard key={item.id} item={item} />)}</div>
    {!list.total && <section className="card p-8 text-center"><h3 className="text-lg font-semibold text-ink">{list.coverage.notices ? "没有符合条件的公告" : "院校目录已就位，正式公告正在整理"}</h3><p className="mx-auto mt-3 max-w-lg text-sm leading-7 text-ink-3">{list.coverage.notices ? "调整路径、年份或院校条件后再试。" : "当前还没有通过来源与证据检查并发布的招生公告。可以先查找目标院校的官方入口，或添加官网链接，等待后台整理。"}</p><div className="mt-5 flex flex-wrap justify-center gap-3"><Link className={buttonClass()} to="/admissions/schools">查看院校目录</Link><Link className={buttonClass("primary")} to="/admissions/sources">添加官网链接</Link></div></section>}
    {list.pages > 1 && <nav aria-label="公告分页" className="mt-6 flex items-center justify-center gap-4">{list.page > 1 && <Link className={buttonClass()} to={pageLink(list.page - 1)}>上一页</Link>}<span className="text-sm text-ink-3">{list.page} / {list.pages}</span>{list.page < list.pages && <Link className={buttonClass()} to={pageLink(list.page + 1)}>下一页</Link>}</nav>}
    <aside className="mt-7 border-l-2 border-accent/40 pl-4 text-xs leading-6 text-ink-3">目录按历史985／211名单人工整理，{list.coverage.entries}个办学条目；不等于已覆盖所有院系或公告。“一本”因省份与年份而异，其他本科院校将按明确名单逐步补充。夏令营、优秀营员与最终录取资格请分别核对。</aside>
  </div></>;
}
