# Multi-Agent Implementation

## Design Decisions

### Config-driven route registration

Rather than parsing agent names from URL path segments at request time, routes are registered at startup based on the `linearAgents` config map. For each agent key, two routes are registered:

- `POST /plugins/linear/{agentId}/webhook` — Linear webhook receiver
- `POST /plugins/linear/{agentId}/api` — Agent API proxy

This means the agent name is baked into the handler closure at registration time — no runtime path parsing needed. It also means the OpenClaw framework sees each route as a distinct, explicit path.

### Per-agent credentials

Each entry in `linearAgents` carries its own `apiKey` (Linear OAuth token) and `webhookSecret` (HMAC signing secret). Both are required — entries missing either are silently skipped during config parsing.

Each agent can optionally specify a `devAgentId` to route to a different OpenClaw agent. If omitted, the top-level `devAgentId` (default: `"dev"`) is used.

All other config (`repoByTeam`, `delegateOnCreate`, `enableAgentApi`, etc.) is shared across agents.

### Credential flow

1. **Webhook handler** — `createLinearWebhook(api, agentName)` receives the agent name at registration. On each request, it calls `normalizeCfg()` to get a fresh config object, then overrides `linearApiKey`, `linearWebhookSecret`, and optionally `devAgentId` from `linearAgents[agentName]`.

2. **Session context** — When creating a `SessionContext` for the agent run, the handler stores `linearApiKey` on the context. This flows through to the API proxy via the bearer token.

3. **API proxy** — `createApiRouter` validates the bearer token, recovers the `SessionContext`, and overrides `cfg.linearApiKey` from `context.linearApiKey`. This ensures all Linear GraphQL calls during agent execution use the correct agent's OAuth token.

### Per-token viewer cache

The `resolveViewer()` function (used for self-echo filtering) previously used a global singleton. It now uses a `Map<string, string>` keyed by API token, so each agent resolves its own Linear identity independently.

### Unknown agent handling

If `linearAgents` is configured but a webhook arrives at a registered route for an agent name that is no longer in config (e.g., config was updated but the route was already registered), the handler logs a warning and responds 202 without processing. This is a safety net — in normal operation, routes are only registered for agents that exist in config.

### Base URL construction

The `captureBaseUrl()` function now stores only the origin (`https://host`), not the full path. The webhook handler constructs the complete API URL including the agent name:

```
https://{host}/plugins/linear/{agentName}/api
```

This URL is passed to the agent in the enriched prompt so it knows where to call back.

### Backwards compatibility

When `linearAgents` is absent from config, the plugin falls back to the original single-agent behavior:

- Webhook: `POST /plugins/linear/linear`
- API: `POST /plugins/linear/api`

No code changes are needed for existing single-agent deployments.

## Configuration

### Multi-agent setup

```json
{
  "linearAgents": {
    "alex": {
      "apiKey": "lin_oauth_alex_token",
      "webhookSecret": "whsec_alex_secret",
      "devAgentId": "code-agent"
    },
    "paige": {
      "apiKey": "lin_oauth_paige_token",
      "webhookSecret": "whsec_paige_secret",
      "devAgentId": "review-agent"
    },
    "mason": {
      "apiKey": "lin_oauth_mason_token",
      "webhookSecret": "whsec_mason_secret"
    }
  },
  "devAgentId": "dev",
  "defaultDir": "/home/projects/main-repo",
  "repoByTeam": {
    "ENG": "/home/projects/backend"
  },
  "enableAgentApi": true
}
```

This registers:

| Route | Agent | OAuth Token | OpenClaw Agent |
|-------|-------|-------------|----------------|
| `/plugins/linear/alex/webhook` | alex | `lin_oauth_alex_token` | `code-agent` |
| `/plugins/linear/alex/api` | alex | (from session) | — |
| `/plugins/linear/paige/webhook` | paige | `lin_oauth_paige_token` | `review-agent` |
| `/plugins/linear/paige/api` | paige | (from session) | — |
| `/plugins/linear/mason/webhook` | mason | `lin_oauth_mason_token` | `dev` (fallback) |
| `/plugins/linear/mason/api` | mason | (from session) | — |

### Single-agent setup (unchanged)

```json
{
  "linearApiKey": "lin_oauth_...",
  "linearWebhookSecret": "whsec_...",
  "devAgentId": "dev"
}
```

Registers the legacy routes:
- `POST /plugins/linear/linear`
- `POST /plugins/linear/api`

### Linear app webhook URLs

Configure each Linear application's webhook URL to point to the corresponding agent route:

| Linear App | Webhook URL |
|-----------|-------------|
| Alex | `https://your-host/plugins/linear/alex/webhook` |
| Paige | `https://your-host/plugins/linear/paige/webhook` |
| Mason | `https://your-host/plugins/linear/mason/webhook` |

Each Linear app must have its own OAuth token and webhook signing secret, configured in the `linearAgents` map.

### Agent credentials reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `apiKey` | `string` | Yes | Linear OAuth token for this agent |
| `webhookSecret` | `string` | Yes | HMAC signing secret for this agent's webhooks |
| `devAgentId` | `string` | No | OpenClaw agent ID (overrides top-level `devAgentId`) |

## Files changed

| File | Change |
|------|--------|
| `src/types.ts` | Added `AgentCredentials` interface, `linearAgents` to `PluginConfig`, `linearApiKey` to `SessionContext` |
| `openclaw.plugin.json` | Added `linearAgents` to config schema |
| `src/config.ts` | Added `readCfgAgents()` parser, wired into `normalizeCfg()` |
| `src/api/base-url.ts` | Stores origin only; `getBaseOrigin()` replaces path-specific `getBaseUrl()` |
| `src/linear-client.ts` | `viewerRef` singleton → `viewerCache` Map keyed by token |
| `src/webhook/handler.ts` | `createLinearWebhook(api, agentName?)` overrides credentials, passes `agentName` through the handler chain, stores `linearApiKey` on `SessionContext`, builds per-agent API URL |
| `src/api/router.ts` | Overrides `cfg.linearApiKey` from `context.linearApiKey` |
| `index.ts` | Config-driven loop registers per-agent routes; falls back to legacy routes |
