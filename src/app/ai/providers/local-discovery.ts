/**
 * User-triggered loopback port probe. Not a startup scan. Not LAN / internet.
 * Ports only — no vendor names in the UI.
 */
import { isAllowedLocalProviderUrl, normalizeBaseUrl } from "./openai-compatible";
import { resolveLocalProviderFetch, sanitizeEndpoint } from "./local-http";
import type { ProviderModel } from "./types";

/** Small allowlist of common local OpenAI-compatible listen ports. */
export const LOOPBACK_DISCOVERY_PORTS = [11434, 1234, 8080, 4891, 5000, 8000] as const;

export const LOOPBACK_DISCOVERY_TIMEOUT_MS = 800;

export interface LocalAiEndpointHit {
  baseUrl: string;
  endpoint: string;
  models: ProviderModel[];
  latencyMs: number;
}

function modelsFromPayload(data: unknown): ProviderModel[] {
  const rec = data && typeof data === "object" ? (data as Record<string, unknown>) : null;
  const list = rec && Array.isArray(rec.data) ? rec.data : [];
  const models: ProviderModel[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const id = (item as Record<string, unknown>).id;
    if (typeof id === "string" && id) models.push({ id, name: id });
  }
  return models;
}

export async function probeLoopbackOpenAiCompatible(opts?: {
  ports?: readonly number[];
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<LocalAiEndpointHit[]> {
  const ports = opts?.ports ?? LOOPBACK_DISCOVERY_PORTS;
  const timeoutMs = opts?.timeoutMs ?? LOOPBACK_DISCOVERY_TIMEOUT_MS;
  const resolved = await resolveLocalProviderFetch(opts?.fetchImpl);
  const hits: LocalAiEndpointHit[] = [];
  for (const port of ports) {
    const baseUrl = `http://127.0.0.1:${port}/v1`;
    if (!isAllowedLocalProviderUrl(baseUrl)) continue;
    const started = Date.now();
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await resolved.fetch(`${normalizeBaseUrl(baseUrl)}/models`, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: ctl.signal,
      });
      if (!res.ok) continue;
      const raw = await res.text();
      if (!raw) continue;
      const models = modelsFromPayload(JSON.parse(raw) as unknown);
      if (models.length === 0) continue;
      hits.push({
        baseUrl,
        endpoint: sanitizeEndpoint(baseUrl),
        models,
        latencyMs: Date.now() - started,
      });
    } catch {
      /* port closed / timeout / non-OpenAI — skip */
    } finally {
      clearTimeout(timer);
    }
  }
  return hits;
}
