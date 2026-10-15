import { defineWebModule } from "@aihot/web/modules";
import { IconChart, IconBookmark } from "@aihot/web/components/icons";

export default defineWebModule({
  name: "competition",
  sidebar: { section: "内容", items: [{ to: "/competitions", label: "大学生竞赛", icon: IconChart }] },
  tabs: [{ key: "competition", to: "/competitions", label: "竞赛", icon: IconChart }],
  tools: [{ to: "/competitions/saved", label: "竞赛收藏", icon: <IconBookmark size={20} /> }],
});
