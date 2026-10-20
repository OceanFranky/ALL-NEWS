import { defineModule } from "@aihot/contracts/modules";
export default defineModule({
  name: "learning-resources",
  apiPaths: [/^\/api\/admin\/resources(?:\/|$)/, /^\/api\/v1\/competitions\/[^/]+\/editions\/[^/]+\/resources$/],
  adminPages: [{ path: "admin/resources", file: "web/list.tsx" }, { path: "admin/resources/maintenance", file: "web/maintenance.tsx" }, { path: "admin/resources/new", file: "web/edit.tsx", id: "resource-new" }, { path: "admin/resources/:id", file: "web/edit.tsx", id: "resource-edit" }],
});
