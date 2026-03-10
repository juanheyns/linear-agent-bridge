# Multi-agent support — bridge changes (linear-agent-bridge)

## Problem

The `linear-agent-bridge` OpenClaw plugin is single-tenant. It reads one `linearApiKey` (OAuth token) and one `linearWebhookSecret` from plugin config and uses them for all requests. When multiple agents route webhooks through a single gateway, the bridge treats every webhook as coming from the same agent.

## Approach: path-based agent routing

Use the same pattern as the upstream Lambda: the agent name is the last segment of the URL path. The caller POSTs to `/plugins/linear/linear/alex`, the bridge extracts `"alex"` from the path, and looks up that agent's credentials from a `linearAgents` config map.

**Routing:**

```
POST /plugins/linear/linear/alex  → bridge extracts "alex" from path
POST /plugins/linear/linear/paige → bridge extracts "paige" from path
POST /plugins/linear/linear       → single-tenant fallback (backwards compat)
```

**Config format:**

```json
{
  "linearAgents": {
    "alex": { "apiKey": "lin_oauth_...", "webhookSecret": "whsec_..." },
    "paige": { "apiKey": "lin_oauth_...", "webhookSecret": "whsec_..." },
    "mason": { "apiKey": "lin_oauth_...", "webhookSecret": "whsec_..." },
    "soren": { "apiKey": "lin_oauth_...", "webhookSecret": "whsec_..." }
  },
  "linearApiKey": "optional-fallback-for-single-tenant",
  "linearWebhookSecret": "optional-fallback-for-single-tenant"
}
```

## Affected code paths

All of these use `cfg.linearApiKey` (the single OAuth token) and need per-agent overrides:

| File | Function | What it does with the token |
|---|---|---|
| `src/linear-client.ts:19` | `callLinear()` | `Authorization: Bearer` on every GraphQL call |
| `src/linear-client.ts:71` | `resolveViewer()` | Fetches app identity, **caches globally** in `viewerRef` |
| `src/webhook/handler.ts:82` | `createLinearWebhook()` | HMAC verification using `cfg.linearWebhookSecret` |
| `src/webhook/skip-filter.ts:27` | `isSelfAuthoredComment()` | Calls `resolveViewer()` to detect self-echoes |
| `src/api/router.ts:62` | `createApiRouter()` | Calls `normalizeCfg()` — all agent API callbacks use the same config |

## Implementation checklist

### 1. `src/types.ts` (~5 lines)

Add agent credentials type and wire it into existing interfaces:

```typescript
export interface AgentCredentials {
  apiKey: string;
  webhookSecret: string;
}
```

Add to `PluginConfig`:
```typescript
linearAgents?: Record<string, AgentCredentials>;
```

Add to `SessionContext`:
```typescript
linearApiKey?: string;
```

### 2. `openclaw.plugin.json` (~10 lines)

Add `linearAgents` to the config schema:

```json
"linearAgents": {
  "type": "object",
  "additionalProperties": {
    "type": "object",
    "properties": {
      "apiKey": { "type": "string" },
      "webhookSecret": { "type": "string" }
    },
    "required": ["apiKey", "webhookSecret"]
  },
  "description": "Per-agent credentials map. Keys are agent names, values have apiKey and webhookSecret."
}
```

### 3. `src/config.ts` (~15 lines)

Parse `linearAgents` from plugin config. Add to `normalizeCfg()`:

```typescript
linearAgents: readCfgAgents(cfg, "linearAgents"),
```

New helper:

```typescript
function readCfgAgents(
  cfg: Record<string, unknown>,
  key: string,
): Record<string, AgentCredentials> | undefined {
  const raw = cfg[key];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const map = raw as Record<string, unknown>;
  const out: Record<string, AgentCredentials> = {};
  for (const [k, v] of Object.entries(map)) {
    const obj = v && typeof v === "object" && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : null;
    if (!obj) continue;
    const apiKey = typeof obj.apiKey === "string" ? obj.apiKey.trim() : "";
    const webhookSecret = typeof obj.webhookSecret === "string" ? obj.webhookSecret.trim() : "";
    if (apiKey) out[k] = { apiKey, webhookSecret };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
```

### 4. `src/webhook/handler.ts` — `createLinearWebhook()` (~15 lines)

After `normalizeCfg()`, extract agent name from the URL path and override credentials:

```typescript
const cfg = normalizeCfg(api.pluginConfig);

// Path-based multi-agent routing: extract agent name from URL
// e.g. /plugins/linear/linear/alex → "alex"
const urlPath = req.url ?? "";
const pathSegments = urlPath.split("/").filter(Boolean);
const registeredSegments = "plugins/linear/linear".split("/").length; // 3
const agentName = pathSegments.length > registeredSegments
  ? pathSegments[registeredSegments]
  : "";

if (agentName && cfg.linearAgents?.[agentName]) {
  const agentCreds = cfg.linearAgents[agentName];
  cfg.linearApiKey = agentCreds.apiKey;
  if (agentCreds.webhookSecret) cfg.linearWebhookSecret = agentCreds.webhookSecret;
}
```

Note: `normalizeCfg()` currently returns a fresh object each call, so mutating it is safe. If that changes, clone first.

### 5. `src/webhook/handler.ts` — `handleAgentEvent()` (~2 lines)

When creating the `SessionContext` (around line 264), store the current `cfg.linearApiKey` so it flows through to API callbacks:

```typescript
const sessionCtx = {
  sessionId: session,
  issueId,
  issueIdentifier: id,
  issueTitle: title,
  issueUrl: url,
  teamId,
  apiToken: "",
  linearApiKey: cfg.linearApiKey,  // ← add this
};
```

### 6. `src/linear-client.ts` (~10 lines)

Replace the global `viewerRef` singleton with a per-token cache:

```typescript
// Before:
const viewerRef: { value?: string } = {};

// After:
const viewerCache = new Map<string, string>();
```

Update `resolveViewer()`:

```typescript
export async function resolveViewer(
  api: OpenClawPluginApi,
  cfg: PluginConfig,
): Promise<string> {
  const token = cfg.linearApiKey ?? "";
  if (!token) return "";
  const cached = viewerCache.get(token);
  if (cached) return cached;
  const { VIEWER_QUERY } = await import("./graphql/queries.js");
  const result = await callLinear(api, cfg, "viewer", {
    query: VIEWER_QUERY,
    variables: {},
  });
  if (!result.ok) return "";
  const viewer = readObject(result.data!.viewer);
  const id = readString(viewer?.id) ?? "";
  if (id) viewerCache.set(token, id);
  return id;
}
```

### 7. `src/api/router.ts` — `createApiRouter()` (~3 lines)

After `normalizeCfg()` on line 62, override the API key from the session context:

```typescript
const cfg = normalizeCfg(api.pluginConfig);
if (context.linearApiKey) cfg.linearApiKey = context.linearApiKey;
```

This ensures that when the agent calls back (e.g. `activity/thought`, `issue/close`), the GraphQL calls use the correct agent's OAuth token.

## Test plan

- **Backwards compatibility:** single-tenant (no path segment, no `linearAgents` config) still works
- **Multi-agent routing:** POST to `/plugins/linear/linear/alex` and `/plugins/linear/linear/paige` — verify each agent's GraphQL calls use the correct OAuth token
- **Unknown agent name:** POST to `/plugins/linear/linear/unknown` — should fall back to default `linearApiKey` or return 401 if no default
- **Self-echo filtering:** each agent's `resolveViewer()` returns a different viewer ID (viewer cache is per-token)
- **API callbacks:** agent API requests during execution use the correct OAuth token for the session that created them
- **HMAC verification:** each agent's webhook is verified against its own secret, not the global one

## Estimated diff

~60 lines across 6 files. No new files, no new dependencies.
