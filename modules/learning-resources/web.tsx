import { defineWebModule } from "@aihot/web/modules";
export default defineWebModule({ name: "learning-resources", admin: { content: [{ to: "/admin/resources", label: "经验帖与教学视频" }] } });
