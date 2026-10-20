// The modules this site runs (modules/<name>/, see docs/architecture.md). A module has a line in each list
// it has an entry for: here for its addresses (module.ts), in server.ts for its backend, in web.ts for its
// pages' parts. Each list keeps the order its entries appear in on the site.
import type { ModuleDeclaration } from "@aihot/contracts/modules";
import { worldNewsDeclaration } from "@aihot/world-news/module";
import competition from "@aihot/competition/module";
import learningResources from "@aihot/learning-resources/module";

export const MODULES: readonly ModuleDeclaration[] = [worldNewsDeclaration, competition, learningResources];
