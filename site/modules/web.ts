// What the site's modules add to the web pages (site/modules/index.ts).
import type { WebModule } from "@aihot/web/modules";
import competition from "@aihot/competition/web.tsx";

export const WEB_MODULES: readonly WebModule[] = [competition];
