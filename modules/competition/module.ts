import { defineModule } from "@aihot/contracts/modules";

export default defineModule({
  name: "competition",
  pages: [
    { path: "competitions", file: "web/overview.tsx" },
    { path: "competitions/library", file: "web/library.tsx" },
    { path: "competitions/saved", file: "web/saved.tsx" },
    { path: "competitions/:competitionId/editions/:editionId", file: "web/detail.tsx" },
  ],
  apiPaths: [/^\/api\/v1\/competitions(?:\/|$)/, /^\/api\/admin\/competitions(?:\/|$)/],
});
