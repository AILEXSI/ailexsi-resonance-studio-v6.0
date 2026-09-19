/**
 * Local-only provider/model health. Cached discovery — no probe every prompt.
 * No cloud fallback. No vendor model hardcode.
 */
import { isConfigured, normalizeBaseUrl } from "../providers/openai-compatible";
import type { OpenAICompatibleConfig } from "../providers/openai-compatible";
import type { ProviderId, ProviderModel } from "../providers/types";

export const DISCOVERY_CACHE_TTL_MS = 10 * 60 * 1000;

export interface DiscoveryCacheEntry {
  baseUrl: string;
  available: boolean;
  models: ProviderModel[];
  model: string;
  at: number;
}

let cache: DiscoveryCacheEntry | null = null;

export function clearDiscoveryCache(): void {
  cache = null;
}

export function writeDiscoveryCache(
  entry: Omit<DiscoveryCacheEntry, "at">,
  at = Date.now(),
): DiscoveryCacheEntry {
  cache = {
    baseUrl: normalizeBaseUrl(entry.baseUrl),
    available: entry.available,
    models: [...entry.models],
    model: entry.model,
    at,
  };
  return cache;
}

export function readDiscoveryCache(): DiscoveryCacheEntry | null {
  return cache;
}

export function isDiscoveryCacheFresh(baseUrl: string, now = Date.now()): boolean {
  if (!cache) return false;
  return cache.baseUrl === normalizeBaseUrl(baseUrl) && now - cache.at <= DISCOVERY_CACHE_TTL_MS;
}

/**
 * Prefer the user's configured id when it is in the discovered list.
 * Otherwise the first discovered id. Never invent a vendor default.
 */
export function pickAutoModel(
  preferred: string,
  discovered: readonly ProviderModel[],
): string | null {
  const pref = preferred.trim();
  if (pref && discovered.some((m) => m.id === pref)) return pref;
  const first = discovered[0]?.id?.trim();
  if (first) return first;
  return pref || null;
}

export interface AutoRuntimeResolution {
  providerId: "mock" | "openai-compatible";
  model: string;
  unavailable: boolean;
  reason?: "down" | "missing";
}

export function resolveAutoRuntime(opts: {
  surface: "normal" | "advanced";
  providerId: ProviderId;
  localConfig: OpenAICompatibleConfig;
  discoveredModels: readonly ProviderModel[];
  probePhase: "idle" | "testing" | "connected" | "failed";
  now?: number;
}): AutoRuntimeResolution {
  const { surface, providerId, localConfig, discoveredModels, probePhase } = opts;
  if (surface === "advanced" && providerId !== "openai-compatible") {
    return { providerId: "mock", model: localConfig.model, unavailable: false };
  }

  const hasUrl = normalizeBaseUrl(localConfig.baseUrl).length > 0;
  if (!hasUrl) {
    return { providerId: "mock", model: localConfig.model, unavailable: false };
  }

  const now = opts.now ?? Date.now();
  const cached = isDiscoveryCacheFresh(localConfig.baseUrl, now) ? cache : null;
  if (cached && !cached.available) {
    return { providerId: "openai-compatible", model: localConfig.model, unavailable: true, reason: "down" };
  }
  if (probePhase === "failed") {
    return { providerId: "openai-compatible", model: localConfig.model, unavailable: true, reason: "down" };
  }

  const models = cached?.models ?? discoveredModels;
  const model = pickAutoModel(localConfig.model, models);
  if (!model && !isConfigured(localConfig)) {
    return { providerId: "openai-compatible", model: "", unavailable: true, reason: "missing" };
  }
  return {
    providerId: "openai-compatible",
    model: model ?? localConfig.model,
    unavailable: false,
  };
}
