import { Outlet, useLocation } from "react-router";
import { INDUSTRY_NAV, industryTab } from "../components/shell/nav";
import { PillTabs } from "../components/ui/Tabs";
import type { Screen } from "../components/shell/screens";

export const handle: Screen = { tab: "featured", name: "行业信息" };

export default function IndustryPage() {
  const { pathname, search } = useLocation();
  const active = industryTab(pathname)?.to ?? "/";
  const filters = new URLSearchParams(search);
  for (const key of [...filters.keys()]) if (!["category", "channel", "tag"].includes(key)) filters.delete(key);
  const query = filters.toString();
  return (
    <>
      <section aria-label="行业信息" className="mb-5 border-b border-line pb-4 pt-3 lg:pt-0">
        <h1 className="mb-4 text-[24px] font-semibold leading-[1.3] text-ink">行业信息</h1>
        <PillTabs
          label="行业信息切换"
          size="xs"
          layoutId="industry-sections"
          active={active}
          items={INDUSTRY_NAV.map(item => ({
            key: item.to,
            label: item.label,
            to: query && ["/", "/all"].includes(active) && ["/", "/all"].includes(item.to) ? `${item.to}?${query}` : item.to,
            prefetch: "intent",
            resetScroll: true,
          }))}
        />
      </section>
      <Outlet />
    </>
  );
}
