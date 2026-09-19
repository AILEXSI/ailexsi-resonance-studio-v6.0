/**
 * Provider-neutral AI adapter. Capabilities describe what a backend can do.
 * They are not grants / permissions (those arrive in AI-6).
 */

export const KNOWN_PROVIDER_IDS = [
  "mock",
  "openai",
  "anthropic",
  "xai",
  "deepseek",
  "ollama",
  "lmstudio",
  "llamacpp",
  "openai-compatible",
] as const;

export type ProviderId = (typeof KNOWN_PROVIDER_IDS)[number];

export type ProviderErrorCode =
  | "PROVIDER_UNAVAILABLE"
  | "AUTH_FAILED"
  | "RATE_LIMIT"
  | "MODEL_UNAVAILABLE"
  | "CONTEXT_LIMIT"
  | "CANCELLED"
  | "INVALID_RESPONSE";

export const PROVIDER_ERROR_CODES: readonly ProviderErrorCode[] = [
  "PROVIDER_UNAVAILABLE",
  "AUTH_FAILED",
  "RATE_LIMIT",
  "MODEL_UNAVAILABLE",
  "CONTEXT_LIMIT",
  "CANCELLED",
  "INVALID_RESPONSE",
];

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly requestId?: string;

  constructor(code: ProviderErrorCode, message: string, requestId?: string) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
    this.requestId = requestId;
  }
}

export function isProviderError(value: unknown): value is ProviderError {
  return value instanceof ProviderError;
}

export function normalizeProviderError(err: unknown, requestId?: string): ProviderError {
  if (err instanceof ProviderError) {
    return requestId && !err.requestId
      ? new ProviderError(err.code, err.message, requestId)
      : err;
  }
  if (err instanceof DOMException && err.name === "AbortError") {
    return new ProviderError("CANCELLED", "Request cancelled", requestId);
  }
  if (err instanceof Error && /abort/i.test(err.name + err.message)) {
    return new ProviderError("CANCELLED", err.message || "Request cancelled", requestId);
  }
  const message = err instanceof Error ? err.message : "Invalid provider response";
  return new ProviderError("INVALID_RESPONSE", message, requestId);
}

export interface ProviderCapabilities {
  chat: boolean;
  stream: boolean;
  tools: boolean;
  local: boolean;
}

export interface ProviderModel {
  id: string;
  name: string;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ChatRequest {
  requestId: string;
  messages: ChatMessage[];
  model?: string;
  signal?: AbortSignal;
}

export interface ChatResponse {
  requestId: string;
  text: string;
  model?: string;
}

export interface ConnectionTestResult {
  ok: boolean;
  error?: ProviderError;
}

export interface AIProvider {
  readonly id: ProviderId;
  getModels(): Promise<ProviderModel[]>;
  capabilities(): ProviderCapabilities;
  chat(request: ChatRequest): Promise<ChatResponse>;
  stream?(request: ChatRequest): AsyncIterable<string>;
  abort?(requestId: string): void;
  testConnection(): Promise<ConnectionTestResult>;
}
