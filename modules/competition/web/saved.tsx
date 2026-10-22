import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { CompetitionRecord, CompetitionDetail } from "@aihot/contracts/competitions";
import { PhoneBar } from "@aihot/web/components/shell/PhoneBar";
import { buttonClass } from "@aihot/web/components/ui/Controls";
import { EmptyState } from "@aihot/web/components/ui/Page";
import { pageMeta } from "@aihot/web/lib/seo";
import { CompetitionCard, CompetitionNav, SaveButton } from "./components.tsx";
import { competitionPath } from "./format.ts";
import { useCompetitionStars } from "./stars.ts";

export const handle = { tab: "competition", name: "竞赛收藏" };
export { CompetitionError as ErrorBoundary } from "./components.tsx";
export function meta() { return pageMeta({ title: "竞赛收藏", path: "/competitions/saved", noindex: true }); }
export default function SavedCompetitions() {
  const stars = useCompetitionStars();
  const [result, setResult] = useState<{ items: CompetitionRecord[]; missing: typeof stars; failed: boolean }>({ items: [], missing: [], failed: false });
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    Promise.all(stars.map(async star => {
      try {
        const response = await fetch(`/api/v1${competitionPath(star)}`, { signal: controller.signal, headers: { accept: "application/json" } });
        if (response.status === 404) return { star, item: null, failed: false };
        if (!response.ok) return { star, item: null, failed: true };
        return { star, item: (await response.json() as CompetitionDetail).item, failed: false };
      } catch { return { star, item: null, failed: true }; }
    })).then(rows => {
      if (controller.signal.aborted) return;
      setResult({ items: rows.flatMap(row => row.item ? [row.item] : []), missing: rows.filter(row => !row.item && !row.failed).map(row => row.star), failed: rows.some(row => row.failed) });
      setLoading(false);
    });
    return () => controller.abort();
  }, [stars, retry]);
  return <><PhoneBar title="竞赛收藏" back={{ to: "/competitions", label: "竞赛总览" }} /><div className="pb-10 pt-4 lg:pt-0"><CompetitionNav /><header className="border-t-2 border-accent pt-5 lg:pt-7"><p className="mono mb-2 text-[10px] tracking-[0.2em] text-accent">COMPETITIONS / SAVED</p><h1 data-page-title className="font-serif text-[32px] font-semibold text-ink">竞赛收藏</h1></header><p className="mb-6 mt-2 text-[13px] leading-relaxed text-ink-3">保存在当前浏览器，按具体届次收藏，与新闻收藏分开。</p>
    {loading ? <p role="status" className="py-10 text-center text-[13px] text-ink-3">正在读取收藏…</p> : <>
      {result.failed && <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-card border border-line p-4 text-[13px] text-ink-3">部分收藏暂时无法加载，记录仍保留。<button type="button" className={buttonClass()} onClick={() => setRetry(value => value + 1)}>重新加载</button></div>}
      <div className="space-y-3">{result.items.map(item => <CompetitionCard key={item.editionId} item={item} from="/competitions/saved" />)}{result.missing.map(star => <div key={star.editionId} className="card flex items-center justify-between gap-4 p-5"><div><p className="text-[14px] font-semibold text-ink-2">此届竞赛暂不可查看</p><p className="mt-1 text-[12px] text-ink-3">可能已撤回或尚未展示，可取消收藏。</p></div><SaveButton item={star} /></div>)}</div>
      {!stars.length && <div className="card"><EmptyState title="还没有收藏竞赛" action={<Link to="/competitions/library" className={buttonClass("primary")}>浏览竞赛库</Link>}>在竞赛卡片或详情页点击收藏，稍后可在这里继续查看。</EmptyState></div>}
    </>}
  </div></>;
}
