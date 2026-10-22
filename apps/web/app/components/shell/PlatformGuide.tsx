import { Link } from "react-router";
import { IconArrowRight } from "../icons";

const entries = [
  { to: "/#industry-feed", number: "01", title: "行业信息", description: "关注技术进展，读懂行业变化。" },
  { to: "/world", number: "02", title: "世界新闻", description: "从新闻摘要，走进事件背景。" },
  { to: "/competitions", number: "03", title: "大学生竞赛", description: "寻找竞赛机会，连接备赛资源。" },
  { to: "/admissions/agent", number: "04", title: "保研 · 考研", description: "给出目标学校，整理专属升学简报。" },
];

export function PlatformGuide() {
  return <section aria-label="平台导读" className="mb-8 border-t-2 border-accent pt-5 lg:mb-10 lg:pt-7">
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:items-end lg:gap-10">
      <div>
        <p className="mono text-[10px] tracking-[0.2em] text-accent">MYHOT / THE READING DESK</p>
        <h2 className="mt-3 font-[ui-serif,Georgia,'Songti_SC','SimSun',serif] text-[32px] leading-[1.3] tracking-tight text-ink lg:text-[46px]">看见变化，<br />找到你的下一步。</h2>
      </div>
      <div className="max-w-sm text-[14px] leading-7 text-ink-3">
        <p>从行业与世界的动态，到竞赛与升学的选择。让有出处的信息，成为理解与行动的起点。</p>
        <Link to="/admissions/agent" className="mt-4 inline-flex min-h-11 items-center gap-3 border-b border-accent text-[13px] font-medium text-accent">制作我的升学简报<IconArrowRight size={16} /></Link>
      </div>
    </div>
    <nav aria-label="四个内容板块" className="mt-7 grid grid-cols-2 border-t border-line lg:mt-9 lg:grid-cols-4">
      {entries.map(entry => <Link key={entry.number} to={entry.to} className="group min-w-0 border-b border-line px-2 py-4 transition-colors hover:bg-accent-softer focus-visible:bg-accent-softer lg:px-4 lg:py-5">
        <div className="mb-3 flex items-center justify-between text-accent"><span className="mono text-[11px]">{entry.number}</span><span className="transition-transform group-hover:translate-x-1 motion-reduce:transition-none"><IconArrowRight size={15} /></span></div>
        <h3 className="text-[15px] font-semibold text-ink">{entry.title}</h3>
        <p className="mt-1.5 max-w-[15em] text-[12px] leading-6 text-ink-3">{entry.description}</p>
      </Link>)}
    </nav>
  </section>;
}
