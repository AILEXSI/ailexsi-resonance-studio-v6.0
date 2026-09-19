import { createMockProvider } from "./mock";
import { registerProvider } from "./registry";

/** Built-in adapters. Cloud / local HTTP providers register in later phases. */
export function registerBuiltInProviders(): void {
  registerProvider("mock", () => createMockProvider());
}

export { createMockProvider, MockProvider } from "./mock";
export {
  clearProviderRegistry,
  createProvider,
  knownProviderIds,
  registerProvider,
  registeredProviderIds,
} from "./registry";
export {
  KNOWN_PROVIDER_IDS,
  PROVIDER_ERROR_CODES,
  ProviderError,
  isProviderError,
  normalizeProviderError,
  type AIProvider,
  type ChatRequest,
  type ChatResponse,
  type ConnectionTestResult,
  type ProviderCapabilities,
  type ProviderErrorCode,
  type ProviderId,
  type ProviderModel,
} from "./types";
