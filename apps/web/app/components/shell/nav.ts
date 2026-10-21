// Site navigation in one place: the desktop sidebar's sections and the phone tab bar's tabs, the engine's
// and the site's modules'.
import type { ReactNode } from "react";
import { subjectAfter, withSubject } from "@aihot/site";
import { webModules } from "../../site-modules";
import {
  IconBolt, IconBookmark, IconDoc, IconFlame, IconGrid, IconHeart, IconList, IconPlug, IconUser,
} from "../icons";

export interface NavItem {
  to: string;
  label: string;
  icon: (p: { size?: number }) => ReactNode;
  /** Match the path exactly (the home page). */
  end?: boolean;
  /** Shows the unread dot while the changelog has news. */
  changelog?: boolean;
}

const SECTIONS: Array<{ title: string; items: NavItem[] }> = [
  {
    title: "内容",
    items: [
      { to: "/", label: "行业信息", icon: IconList },
    ],
  },
  {
    title: "更多",
    items: [
      { to: "/agent", label: "Agent 接入", icon: IconPlug },
      { to: "/about", label: "关于", icon: IconHeart },
    ],
  },
];

/**
 * The sidebar: the engine's sections with the modules' between 内容 and 更多; a module naming a section
 * that is already there adds to it.
 */
export function sidebar(): Array<{ title: string; items: NavItem[] }> {
  const [content, ...rest] = SECTIONS;
  const more = rest.pop()!;
  const sections = [content!, ...rest].map((s) => ({ ...s, items: [...s.items] }));
  for (const m of webModules()) {
    if (!m.sidebar) continue;
    const section = sections.find((s) => s.title === m.sidebar!.section);
    if (section) section.items.push(...m.sidebar.items);
    else sections.push({ title: m.sidebar.section, items: [...m.sidebar.items] });
  }
  sections[0]!.items.push({ to: "/starred", label: "收藏", icon: IconBookmark });
  return [...sections, more];
}

/** A sidebar entry is lit on its pages; 日报 also covers weekly and monthly reports. */
export function sidebarIsActive(item: NavItem, pathname: string): boolean {
  if (item.to === "/") return industryTab(pathname) !== undefined;
  if (item.end) return pathname === item.to;
  if (item.to === "/daily") return /^\/(daily|weekly|monthly)(\/|$)/.test(pathname);
  return pathname === item.to || pathname.startsWith(`${item.to}/`);
}

/**
 * The phone tab bar: 行业信息 holds the five industry views, and "我的" at /more holds
 * 收藏, 外观, the tools and the site's own pages. Which tab a page sits under is declared by the page
 * itself (components/shell/screens.ts).
 */
export type TabKey =
  | "featured"
  | "me"
  // A module's tab.
  | (string & {});

export interface Tab {
  key: TabKey;
  to: string;
  label: string;
  icon: (p: { size?: number }) => ReactNode;
  changelog?: boolean;
}

const ENGINE_TABS: Tab[] = [
  { key: "featured", to: "/", label: "行业信息", icon: IconList },
  { key: "me", to: "/more", label: "我的", icon: IconUser },
];

export const INDUSTRY_NAV: NavItem[] = [
  { to: "/", label: "精选", icon: IconBolt, end: true },
  { to: "/all", label: subjectAfter("全部", "动态"), icon: IconList },
  { to: "/hot", label: "热点榜", icon: IconFlame },
  { to: "/daily", label: withSubject("日报"), icon: IconDoc },
  { to: "/topics", label: "主题", icon: IconGrid },
];

export function industryTab(pathname: string): NavItem | undefined {
  if (/^\/(weekly|monthly)(\/|$)/.test(pathname)) return INDUSTRY_NAV[3];
  if (/^\/story\//.test(pathname)) return INDUSTRY_NAV[2];
  if (/^\/items\//.test(pathname)) return INDUSTRY_NAV[0];
  if (pathname === "/search-busy") return INDUSTRY_NAV[1];
  return INDUSTRY_NAV.find(item => item.end ? pathname === item.to : pathname === item.to || pathname.startsWith(`${item.to}/`));
}

/** The tab bar: the engine's, the modules' before 我的. */
export function tabs(): Tab[] {
  return [...ENGINE_TABS.slice(0, -1), ...webModules().flatMap((m) => m.tabs ?? []), ENGINE_TABS.at(-1)!];
}
