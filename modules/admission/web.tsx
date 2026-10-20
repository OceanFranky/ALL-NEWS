import { defineWebModule } from "@aihot/web/modules";
import { IconDoc, IconBookmark } from "@aihot/web/components/icons";
export default defineWebModule({
  name: "admission",
  sidebar: { section: "内容", items: [{ to: "/admissions", label: "保研 · 考研", icon: IconDoc }] },
  tabs: [{ key: "admission", to: "/admissions", label: "升学", icon: IconDoc }],
  tools: [{ to: "/admissions/saved", label: "升学收藏", icon: <IconBookmark size={20} /> }],
  admin: { content: [{ to: "/admin/admissions", label: "升学公告" }, { to: "/admin/admissions/imports", label: "升学来源" }, { to: "/admin/admissions/agents", label: "升学简报" }] },
});
