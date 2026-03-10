import type { AgentCredentials, PluginConfig } from "./types.js";

export function normalizeCfg(
  input: Record<string, unknown> | undefined,
): PluginConfig {
  const cfg = input ?? {};
  return {
    devAgentId: readCfgString(cfg, "devAgentId"),
    linearWebhookSecret: readCfgString(cfg, "linearWebhookSecret"),
    linearApiKey: readCfgString(cfg, "linearApiKey"),
    notifyChannel: readCfgString(cfg, "notifyChannel"),
    notifyTo: readCfgString(cfg, "notifyTo"),
    notifyAccountId: readCfgString(cfg, "notifyAccountId"),
    repoByTeam: readCfgMap(cfg, "repoByTeam"),
    repoByProject: readCfgMap(cfg, "repoByProject"),
    defaultDir: readCfgString(cfg, "defaultDir"),
    delegateOnCreate: readCfgBool(cfg, "delegateOnCreate"),
    startOnCreate: readCfgBool(cfg, "startOnCreate"),
    externalUrlBase: readCfgString(cfg, "externalUrlBase"),
    externalUrlLabel: readCfgString(cfg, "externalUrlLabel"),
    enableAgentApi: readCfgBool(cfg, "enableAgentApi"),
    apiBaseUrl: readCfgString(cfg, "apiBaseUrl"),
    linearAgents: readCfgAgents(cfg, "linearAgents"),
  };
}

function readCfgString(
  cfg: Record<string, unknown>,
  key: string,
): string | undefined {
  const raw = cfg[key];
  if (typeof raw !== "string") return undefined;
  const value = raw.trim();
  return value || undefined;
}

function readCfgBool(
  cfg: Record<string, unknown>,
  key: string,
): boolean | undefined {
  const raw = cfg[key];
  if (typeof raw !== "boolean") return undefined;
  return raw;
}

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
    if (!apiKey || !webhookSecret) continue;
    const entry: AgentCredentials = { apiKey, webhookSecret };
    const devAgentId = typeof obj.devAgentId === "string" ? obj.devAgentId.trim() : "";
    if (devAgentId) entry.devAgentId = devAgentId;
    out[k] = entry;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function readCfgMap(
  cfg: Record<string, unknown>,
  key: string,
): Record<string, string> | undefined {
  const raw = cfg[key];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const map = raw as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(map)) {
    if (typeof v === "string" && v.trim()) {
      out[k] = v.trim();
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
