// What the site's modules add to the web pages (site/modules/index.ts).
import type { WebModule } from "@aihot/web/modules";
import { worldNewsWeb } from '../../modules/world-news/web.tsx';
import competition from "@aihot/competition/web.tsx";
import admission from "@aihot/admission/web.tsx";
import learningResources from "@aihot/learning-resources/web.tsx";

export const WEB_MODULES: readonly WebModule[] = [worldNewsWeb, competition, admission, learningResources].map(module => ({
  ...module,
  agent: async () => {
    const { platformAgentPart } = await import("./agent-web.ts");
    return { default: platformAgentPart(module.name) };
  },
}));
