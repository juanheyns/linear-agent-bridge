import type { OpenClawPluginApi } from "./src/types.js";
import { normalizeCfg } from "./src/config.js";
import { createLinearWebhook } from "./src/webhook/handler.js";
import { createApiRouter } from "./src/api/router.js";

// Side-effect imports: register all API endpoint handlers
import "./src/api/issue-ops.js";
import "./src/api/activity-ops.js";
import "./src/api/session-ops.js";
import "./src/api/delegation-ops.js";
import "./src/api/query-ops.js";

export default function register(api: OpenClawPluginApi): void {
  const cfg = normalizeCfg(api.pluginConfig);

  if (cfg.linearAgents) {
    // Multi-agent: register per-agent webhook + API routes
    for (const agentName of Object.keys(cfg.linearAgents)) {
      api.registerHttpRoute({
        path: `/plugins/linear/${agentName}/webhook`,
        handler: createLinearWebhook(api, agentName),
      });
      api.registerHttpRoute({
        path: `/plugins/linear/${agentName}/api`,
        handler: createApiRouter(api),
      });
      api.logger.info?.(`linear: registered routes for agent "${agentName}"`);
    }
  } else {
    // Single-agent fallback (backwards compatibility)
    api.registerHttpRoute({
      path: "/plugins/linear/linear",
      handler: createLinearWebhook(api),
    });
    api.registerHttpRoute({
      path: "/plugins/linear/api",
      handler: createApiRouter(api),
    });
  }
}
