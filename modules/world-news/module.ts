import { defineModule } from "@aihot/contracts/modules";
export const worldNewsDeclaration=defineModule({ name:"world-news",apiPaths:[/^\/api\/v1\/world(?:\/|$)/,/^\/api\/admin\/world(?:\/|$)/],
  adminPages:[{ path:'admin/world/runs',file:'web/runs.tsx',id:'world-admin-runs' }] });
