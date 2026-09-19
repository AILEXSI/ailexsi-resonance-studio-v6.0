import { createMockProvider } from "./mock";
import { createOpenAICompatibleProvider } from "./openai-compatible";
import { registerProvider } from "./registry";

/** Built-in adapters. Cloud providers stay unregistered until a secret store exists. */
export function registerBuiltInProviders(): void {
  registerProvider("mock", () => createMockProvider());
  registerProvider("openai-compatible", () =>
    createOpenAICompatibleProvider({ baseUrl: "", model: "" }),
  );
}

export { createMockProvider, MockProvider } from "./mock";
export {
  createOpenAICompatibleProvider,
  OpenAICompatibleProvider,
  connectionStatusOf,
  isAllowedLocalProviderUrl,
  isConfigured,
  statusLabel,
  type LocalConnectionStatus,
  type OpenAICompatibleConfig,
} from "./openai-compatible";
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
