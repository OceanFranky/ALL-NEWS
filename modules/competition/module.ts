import { defineModule } from "@aihot/contracts/modules";

export default defineModule({ name: "competition", apiPaths: [/^\/api\/v1\/competitions(?:\/|$)/, /^\/api\/admin\/competitions(?:\/|$)/] });
