import { defineModule } from "@aihot/contracts/modules";
export const worldNewsDeclaration=defineModule({ name:"world-news",apiPaths:[/^\/api\/v1\/world(?:\/|$)/,/^\/api\/admin\/world(?:\/|$)/],
  adminPages:[{ path:'admin/world/runs',file:'web/runs.tsx',id:'world-admin-runs' },
    { path:'admin/world/models',file:'web/models.tsx',id:'world-admin-models' },
    { path:'admin/world/daily',file:'web/daily.tsx',id:'world-admin-daily' },
    { path:'admin/world/hot',file:'web/hot.tsx',id:'world-admin-hot' }] });
