import { defineModule } from "@aihot/contracts/modules";
export const worldNewsDeclaration=defineModule({ name:"world-news",apiPaths:[/^\/api\/v1\/world(?:\/|$)/,/^\/api\/admin\/world(?:\/|$)/] });
