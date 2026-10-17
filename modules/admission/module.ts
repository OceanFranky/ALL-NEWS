import { defineModule } from "@aihot/contracts/modules";
export default defineModule({
  name: "admission",
  pages: [
    { path: "admissions", file: "web/library.tsx" },
    { path: "admissions/schools", file: "web/schools.tsx" },
    { path: "admissions/saved", file: "web/saved.tsx" },
    { path: "admissions/updates", file: "web/updates.tsx" },
    { path: "admissions/sources", file: "web/imports.tsx" },
    { path: "admissions/:noticeId", file: "web/detail.tsx" },
  ],
  adminPages: [{ path: "admin/admissions", file: "web/admin.tsx" }, { path: "admin/admissions/imports", file: "web/admin-imports.tsx" }],
  apiPaths: [/^\/api\/v1\/admissions(?:\/|$)/, /^\/api\/admin\/admissions(?:\/|$)/],
});
