import { useCallback, useRef, useState } from "react";
import { IntentLink } from "../components/ui/IntentLink";
import { Link, useLoaderData } from "react-router";
import type { SiteContact, SiteStats } from "@aihot/contracts/site";
import { ABOUT, POLICY, SITE } from "@aihot/site";
import { apiGet, cachedPage } from "../lib/api.server";
import { pageReuse } from "../lib/page-reuse";
import { organizationLd, pageMeta } from "../lib/seo";
import { Kicker } from "../components/ui/Kicker";
import { buttonClass } from "../components/ui/Controls";
import { IconArrowRight } from "../components/icons";
import { SignalRiver, type RiverSource } from "../features/about/SignalRiver";
import { PhoneBar } from "../components/shell/PhoneBar";
import type { Screen } from "../components/shell/screens";

export const handle: Screen = { tab: "me", name: "关于" };
export { pageHeaders as headers } from "../lib/api.server";
export const { clientLoader, shouldRevalidate } = pageReuse<typeof loader>();

export async function loader({ request }: { request: Request }) {
  const [contact, stats, world, competition, admission] = await Promise.all([
    apiGet<SiteContact>("/api/site/contact", { signal: request.signal }).catch(() => null),
    apiGet<SiteStats>("/api/site/stats", { signal: request.signal }).catch(() => null),
    apiGet<{ pagination: { total: number } }>("/api/v1/world/items?limit=1", { signal: request.signal }).catch(() => null),
    apiGet<{ total: number }>("/api/v1/competitions?pageSize=1", { signal: request.signal }).catch(() => null),
    apiGet<{ total: number }>("/api/v1/admissions", { signal: request.signal }).catch(() => null),
  ]);
  return cachedPage(300, { contact, counts: { industry: stats?.selected ?? null, world: world?.pagination.total ?? null,
    competition: competition?.total ?? null, admission: admission?.total ?? null } });
}

export function meta() {
  return pageMeta({ title: "关于", description: ABOUT.description, path: "/about", image: "/og/pages/about.png", jsonLd: organizationLd() });
}

const NO_SOURCES: RiverSource[] = [];

/** 3.6 万 from ten thousand up, digits with separators below. */
function figure(n: number): { value: string; unit: string } {
  return n >= 10_000 ? { value: (n / 10_000).toFixed(1).replace(/\.0$/, ""), unit: "万" } : { value: n.toLocaleString("en-US"), unit: "" };
}

function Figure({ n, unit }: { n: number; unit: string }) {
  const f = figure(n);
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="num text-[30px] font-black leading-none tracking-[-0.03em] text-ink xl:text-[36px]">{f.value}</span>
      <span className="text-[13px] text-ink-3">
        {f.unit}
        {unit}
      </span>
    </div>
  );
}

/**
 * The stage columns' rules: one column on phones, two by two from sm, and from lg four in a row whose
 * edges fall on the river's stage boundaries.
 */
const STAGE_CELL = [
  "sm:pr-6 lg:pr-6",
  "border-t sm:border-l sm:border-t-0 sm:pl-6 lg:px-6",
  "border-t sm:pr-6 lg:border-l lg:border-t-0 lg:px-6",
  "border-t sm:border-l sm:pl-6 lg:border-t-0 lg:px-6",
];

const PROCESS_STAGES = [
  { no: "01", title: "汇集", text: ABOUT.steps.collect },
  { no: "02", title: "整理", text: ABOUT.steps.store },
  { no: "03", title: "关联", text: ABOUT.steps.select },
  { no: "04", title: "应用", text: ABOUT.steps.publish },
];

/** The maker's round avatar before the greeting; it steps aside if the image fails. */
function MakerFace({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return <img src={src} alt={`${ABOUT.maker?.name ?? ""}的头像`} width={48} height={48} onError={() => setFailed(true)} className="size-11 shrink-0 rounded-full bg-bg-sunk object-cover ring-1 ring-line xl:size-12" />;
}

function QrCard({ src, kind, title, note }: { src: string; kind: string; title: string; note: string }) {
  return (
    <figure className="card flex items-center gap-5 p-5">
      <img src={src} alt={`${kind}二维码`} width={112} height={112} loading="lazy" className="size-[104px] shrink-0 rounded-tile border border-line bg-white object-contain p-1.5 sm:size-[112px]" />
      <figcaption className="min-w-0">
        <div className="text-[12px] text-ink-4">{kind}</div>
        <div className="mt-1 text-[16px] font-semibold leading-snug text-ink">{title}</div>
        <p className="mt-2 text-[13px] leading-[1.7] text-ink-3">{note}</p>
      </figcaption>
    </figure>
  );
}

/**
 * The optional maker block (ABOUT.maker): a greeting on the left, the contact codes that are set on the
 * right. Without the contact settings (the api did not answer) the codes stay out, as the figures do.
 */
function Maker({ maker, contact }: { maker: NonNullable<typeof ABOUT.maker>; contact: SiteContact | null }) {
  const codes = [
    contact?.wechatQr && maker.wechat ? <QrCard key="wechat" src={contact.wechatQr} kind={maker.wechat.kind} title={maker.wechat.title} note={maker.wechat.note} /> : null,
    contact?.feishuQr && maker.feishu ? <QrCard key="feishu" src={contact.feishuQr} kind={maker.feishu.kind} title={maker.feishu.title} note={maker.feishu.note} /> : null,
  ].filter(Boolean);
  return (
    <section aria-labelledby="maker" className="mt-20 grid gap-10 xl:mt-28 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-16">
      <div>
        <Kicker>做这个站的人</Kicker>
        <h2 id="maker" className="mt-4 flex items-center gap-3.5 text-[26px] font-black leading-[1.3] tracking-[-0.02em] text-ink xl:gap-4 xl:text-[34px]">
          {contact?.makerAvatar && <MakerFace src={contact.makerAvatar} />}
          <span>
            嗨，我是 <span className="whitespace-nowrap text-accent">{maker.name}</span>
          </span>
        </h2>
        <div className="mt-5 space-y-4 text-[15.5px] leading-[1.9] text-ink-2 xl:text-[16.5px]">
          {maker.greeting.map((line) => (
            <p key={line}>{line}</p>
          ))}
          <p className="text-ink-3">
            它一直在改，改了什么都写在
            <Link viewTransition to="/changelog" className="text-accent hover:underline">
              更新日志
            </Link>
            里；有想法、遇到问题，去
            <Link viewTransition to="/feedback" className="text-accent hover:underline">
              反馈页
            </Link>
            告诉我。
          </p>
        </div>
      </div>
      {codes.length > 0 && (
        <div className="grid content-start gap-3">
          <h3 className="text-[15px] font-semibold text-ink">如果觉得有点用，欢迎加入</h3>
          {codes}
        </div>
      )}
    </section>
  );
}

/** The river connects the platform's different reading and planning scenarios. */
function AreaPreview({ area, className = "" }: { area: (typeof ABOUT.areas)[number]; className?: string }) {
  return (
    <IntentLink viewTransition to={area.to} className={`group block ${className}`}>
      <span className="text-[11px] font-semibold tracking-[0.2em] text-accent">连接认知与行动</span>
      <span key={area.key} className="animate-fade-up mt-1.5 block">
        <span className="block text-[15px] font-semibold text-ink transition-colors group-hover:text-accent">{area.name}</span>
        <span className="mt-1 block text-[12px] leading-[1.7] text-ink-4">{area.text}</span>
      </span>
    </IntentLink>
  );
}

export default function AboutPage() {
  const { contact, counts } = useLoaderData<typeof loader>();
  const [focus, setFocus] = useState<number | null>(null);
  const [at, setAt] = useState(0);
  const shown = useRef(0);
  // A pulse reaches the paper every second or so; the headline under it changes at most every 2.8s.
  const onArrive = useCallback(() => {
    const now = Date.now();
    if (now - shown.current < 2800) return;
    shown.current = now;
    setAt((i) => (i + 1) % ABOUT.areas.length);
  }, []);

  return (
    <div className="mx-auto max-w-[var(--page-max-reading)] pb-14 lg:pt-3">
      <PhoneBar back={{ to: "/more", label: "我的" }} title={`关于 ${SITE.name}`} />
      <header className="grid items-end gap-8 pt-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:pt-0">
        <div>
          <Kicker>{ABOUT.kicker}</Kicker>
          <h1 data-page-title="" className="mt-5 text-[34px] font-black leading-[1.18] tracking-[-0.03em] text-ink [text-wrap:balance] sm:text-[46px] xl:text-[56px] 2xl:text-[64px]">
            {ABOUT.headline[0]}
            <br />
            <span className="text-accent">{ABOUT.headline[1]}</span>
          </h1>
          <p className="mt-5 max-w-[36em] text-[15.5px] leading-[1.85] text-ink-3 xl:text-[17px]">
            {ABOUT.lead}
          </p>
        </div>
        <div className="flex flex-wrap gap-3 lg:pb-2">
          <a href="#platform-sections" className={buttonClass("primary", "lg")}>
            探索四个板块 <IconArrowRight size={15} />
          </a>
          <IntentLink to="/agent" className={buttonClass("secondary", "lg")}>
            接入我的 Agent
          </IntentLink>
        </div>
      </header>

      <section aria-labelledby="how" className="mt-10 xl:mt-14">
        <h2 id="how" className="sr-only">
          {`${SITE.name} 怎么工作`}
        </h2>
        <SignalRiver sources={NO_SOURCES} focus={focus} onArrive={onArrive} className="h-[230px] sm:h-[300px] lg:h-[360px] 2xl:h-[420px]">
          <AreaPreview area={ABOUT.areas[at]} className="absolute left-[75%] top-[calc(42%+42px)] hidden w-[25%] px-4 lg:block" />
        </SignalRiver>
        <p className="sr-only">示意图：不同来源的信息经过整理与关联，形成可追溯的阅读资料、主题脉络和行动线索；动效不代表实时采集进度。</p>
        <AreaPreview area={ABOUT.areas[at]} className="mt-2 border-t border-line pt-4 lg:hidden" />
        <ol className="mt-4 grid grid-cols-1 border-t border-line-strong sm:grid-cols-2 lg:mt-0 lg:grid-cols-4">
          {PROCESS_STAGES.map((s, i) => (
            <li
              key={s.no}
              tabIndex={0}
              onPointerEnter={() => setFocus(i)}
              onPointerLeave={() => setFocus(null)}
              onFocus={() => setFocus(i)}
              onBlur={() => setFocus(null)}
              className={`border-line py-6 outline-none transition-colors ${STAGE_CELL[i]} ${focus === i ? "bg-accent-softer" : ""}`}
            >
              <div className="flex items-baseline gap-2.5">
                <span className="num text-[12px] font-bold tracking-[0.12em] text-accent">{s.no}</span>
                <h3 className="text-[17px] font-bold text-ink">{s.title}</h3>
              </div>
              <p className="mt-3 text-[14px] leading-[1.8] text-ink-3">{s.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section id="platform-sections" aria-labelledby="platform-title" className="mt-16 scroll-mt-6 xl:mt-24">
        <Kicker>MYHOT · 认知地图</Kicker>
        <h2 id="platform-title" className="mt-4 text-[26px] font-black tracking-[-0.02em] text-ink sm:text-[34px]">四个板块，拓展你的信息视野</h2>
        <div className="mt-7 grid gap-4 sm:grid-cols-2">
          {ABOUT.areas.map(area => <IntentLink key={area.key} to={area.to} className="group card min-w-0 p-5 transition-colors hover:border-accent/40 sm:p-6">
            <div className="flex items-center justify-between gap-3"><h3 className="text-[19px] font-semibold text-ink">{area.name}</h3><IconArrowRight size={18} className="text-accent transition-transform group-hover:translate-x-1" /></div>
            <div className="mt-5">{counts[area.key] === null ? <span className="text-[13px] text-ink-4">数量暂未取得</span> : <Figure n={counts[area.key]!} unit={area.unit} />}</div>
            <p className="mt-4 text-[14px] leading-[1.85] text-ink-3">{area.text}</p>
          </IntentLink>)}
        </div>
        <p className="mt-3 text-[12px] leading-[1.8] text-ink-4">数量对应各板块当前公开内容；比赛与公告的适用年份、截止状态和具体要求，以详情及原文为准。</p>
      </section>

      <section aria-labelledby="your-industry" className="mt-16 grid gap-8 border-t border-line pt-8 lg:grid-cols-2 lg:gap-12 xl:mt-24">
        <div>
          <Kicker>由关注点出发</Kicker>
          <h2 id="your-industry" className="mt-4 text-[26px] font-black tracking-[-0.02em] text-ink sm:text-[32px]">你的行业，由你定义</h2>
          <p className="mt-4 text-[15px] leading-[1.9] text-ink-3">MyHOT 的行业信源、分类与提示词可按关注领域配置。当前行业板块以 AI 为示例，也可以围绕其他行业构建自己的信息视野，让关注点决定你看到什么。</p>
        </div>
        <div className="space-y-6 lg:pt-1">
          <div><h3 className="text-[17px] font-semibold text-ink">带着出处理解信息</h3><p className="mt-2 text-[14px] leading-[1.85] text-ink-3">新闻关注事件与多来源脉络，竞赛关注规则与备赛资源，升学关注院校条件和材料证据。保留原文与核验状态，帮助你判断信息是否适合当前目标。</p></div>
          <div><h3 className="text-[17px] font-semibold text-ink">让信息进入自己的工作流</h3><p className="mt-2 text-[14px] leading-[1.85] text-ink-3">在网页浏览四个板块，也能通过 MCP、API 和 Agent Markdown 查询公开结果，接入自己的助手与工具；行业资讯另支持 RSS 订阅。</p><IntentLink to="/agent" className="mt-3 inline-flex items-center gap-2 text-[14px] font-medium text-accent hover:underline">查看 Agent 接入 <IconArrowRight size={15} /></IntentLink></div>
        </div>
      </section>

      {ABOUT.maker && <Maker maker={ABOUT.maker} contact={contact} />}

      <p className="mt-16 well rounded-card px-5 py-4 text-[13px] leading-[1.85] text-ink-3">
        {ABOUT.copyright[0]}
        <Link viewTransition to="/feedback" className="text-accent hover:underline">
          反馈页
        </Link>
        {ABOUT.copyright[1]}
      </p>

      <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5 text-[12.5px] text-ink-4">
        <span>{SITE.footerNote}</span>
        <nav className="flex gap-5" aria-label="规则与隐私">
          <Link
            viewTransition
            id={ABOUT.termsAnchor ?? undefined}
            to="/terms"
            className="transition-colors hover:text-accent"
          >
            {POLICY.terms.name}
          </Link>
          <Link viewTransition to="/privacy" className="transition-colors hover:text-accent">
            隐私说明
          </Link>
        </nav>
      </footer>
    </div>
  );
}
