import { ProviderError, KNOWN_PROVIDER_IDS, type AIProvider, type ProviderId } from "./types";

export type ProviderFactory = () => AIProvider;

const factories = new Map<ProviderId, ProviderFactory>();

export function knownProviderIds(): readonly ProviderId[] {
  return KNOWN_PROVIDER_IDS;
}

export function registeredProviderIds(): ProviderId[] {
  return [...factories.keys()];
}

export function registerProvider(id: ProviderId, factory: ProviderFactory): void {
  factories.set(id, factory);
}

export function unregisterProvider(id: ProviderId): void {
  factories.delete(id);
}

export function clearProviderRegistry(): void {
  factories.clear();
}

export function isKnownProviderId(id: string): id is ProviderId {
  return (KNOWN_PROVIDER_IDS as readonly string[]).includes(id);
}

/**
 * Fail closed: unknown id or unimplemented registry slot.
 * Does not invent a fallback provider.
 */
export function createProvider(id: string): AIProvider {
  if (!isKnownProviderId(id)) {
    throw new ProviderError("PROVIDER_UNAVAILABLE", `Unknown provider: ${id}`);
  }
  const factory = factories.get(id);
  if (!factory) {
    throw new ProviderError(
      "PROVIDER_UNAVAILABLE",
      `Provider ${id} is not implemented in this build`,
    );
  }
  return factory();
}
