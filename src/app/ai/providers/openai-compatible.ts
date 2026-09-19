import {
  resolveLocalProviderFetch,
  sanitizeDiagnosticMessage,
  sanitizeEndpoint,
} from "./local-http";
import {
  ProviderError,
  type AIProvider,
  type ChatRequest,
  type ChatResponse,
  type ConnectionFailureCategory,
  type ConnectionTestResult,
  type LocalHttpTransport,
  type ProviderCapabilities,
  type ProviderErrorCode,
  type ProviderModel,
} from "./types";

export type LocalConnectionStatus =
  | "not-configured"
  | "connecting"
  | "connected"
  | "unavailable"
  | "error";

export interface OpenAICompatibleConfig {
  baseUrl: string;
  model: string;
  /** Optional. Memory-only. Never written to Project / conversation / logs. */
  apiKey?: string;
  /** Chat / completions timeout. Connection test uses DEFAULT_CONNECTION_TIMEOUT_MS. */
  timeoutMs?: number;
  /** Test hook. Production uses Tauri loopback HTTP when packaged, else global fetch. */
  fetchImpl?: typeof fetch;
}

/** GET /models and Test Connection. Human listing is fast; keep this short. */
export const DEFAULT_CONNECTION_TIMEOUT_MS = 8_000;

/**
 * POST /chat/completions. Human cold Ollama qwen2.5:7b was ~32380 ms; 8s abort
 * mapped that to PROVIDER_UNAVAILABLE. Still fail-closed.
 */
export const DEFAULT_CHAT_TIMEOUT_MS = 90_000;
export const MIN_CHAT_TIMEOUT_MS = 8_000;
export const MAX_CHAT_TIMEOUT_MS = 180_000;

/** @deprecated Use DEFAULT_CHAT_TIMEOUT_MS. Kept so older tests that import the name still typecheck if they did. */
export const DEFAULT_TIMEOUT_MS = DEFAULT_CHAT_TIMEOUT_MS;

export function clampChatTimeoutMs(raw: number | undefined): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return DEFAULT_CHAT_TIMEOUT_MS;
  return Math.min(MAX_CHAT_TIMEOUT_MS, Math.max(MIN_CHAT_TIMEOUT_MS, Math.round(raw)));
}

export function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

export function isConfigured(config: OpenAICompatibleConfig): boolean {
  return normalizeBaseUrl(config.baseUrl).length > 0 && config.model.trim().length > 0;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

/** Fail-closed loopback only. Cloud / LAN / DNS-rebinding hosts are rejected. */
export function isAllowedLocalProviderUrl(raw: string): boolean {
  try {
    const url = new URL(normalizeBaseUrl(raw));
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    return LOCAL_HOSTS.has(host);
  } catch {
    return false;
  }
}

export function statusLabel(status: LocalConnectionStatus): string {
  switch (status) {
    case "not-configured":
      return "Not configured";
    case "connecting":
      return "Connecting";
    case "connected":
      return "Connected";
    case "unavailable":
      return "Unavailable";
    case "error":
      return "Error";
  }
}

function joinUrl(base: string, path: string): string {
  const root = normalizeBaseUrl(base);
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${root}${suffix}`;
}

function headers(apiKey: string | undefined): Headers {
  const h = new Headers({ "Content-Type": "application/json", Accept: "application/json" });
  const key = apiKey?.trim();
  if (key) h.set("Authorization", `Bearer ${key}`);
  return h;
}

export function classifyTransportFailure(
  err: unknown,
  timedOut: boolean,
): { category: ConnectionFailureCategory; code: ProviderErrorCode; message: string } {
  if (timedOut) {
    return { category: "TIMEOUT", code: "PROVIDER_UNAVAILABLE", message: "Connection timed out" };
  }
  const raw = err instanceof Error ? `${err.name} ${err.message}` : String(err);
  const lower = raw.toLowerCase();
  if (/mixed content|insecure|content security policy|\bcsp\b|security_policy/i.test(raw)) {
    return {
      category: "SECURITY_POLICY",
      code: "PROVIDER_UNAVAILABLE",
      message: sanitizeDiagnosticMessage(raw),
    };
  }
  if (/cors|access-control-allow-origin|cross-origin/i.test(raw)) {
    return { category: "CORS", code: "PROVIDER_UNAVAILABLE", message: sanitizeDiagnosticMessage(raw) };
  }
  if (/refused|econnrefused|err_connection_refused|failed to connect/i.test(lower)) {
    return { category: "REFUSED", code: "PROVIDER_UNAVAILABLE", message: sanitizeDiagnosticMessage(raw) };
  }
  if (/failed to fetch|networkerror|load failed/i.test(lower)) {
    return {
      category: "UNKNOWN",
      code: "PROVIDER_UNAVAILABLE",
      message:
        "Browser fetch failed (CORS, refused, or mixed-content cannot be distinguished from the WebView error).",
    };
  }
  return {
    category: "UNKNOWN",
    code: "PROVIDER_UNAVAILABLE",
    message: sanitizeDiagnosticMessage(raw || "Provider unreachable"),
  };
}

function mapHttpStatus(
  status: number,
  bodyText: string,
  requestId?: string,
): { error: ProviderError; category: ConnectionFailureCategory } {
  const lower = bodyText.toLowerCase();
  if (status === 401 || status === 403) {
    return { error: new ProviderError("AUTH_FAILED", `HTTP ${status}`, requestId), category: "HTTP" };
  }
  if (status === 429) {
    return { error: new ProviderError("RATE_LIMIT", `HTTP ${status}`, requestId), category: "HTTP" };
  }
  if (status === 404 || /model[_ ]?not[_ ]?found|unknown model/i.test(bodyText)) {
    return {
      error: new ProviderError("MODEL_UNAVAILABLE", `HTTP ${status}`, requestId),
      category: "MODEL_NOT_FOUND",
    };
  }
  if (/context length|maximum context|too many tokens/i.test(lower)) {
    return { error: new ProviderError("CONTEXT_LIMIT", `HTTP ${status}`, requestId), category: "HTTP" };
  }
  if (status >= 500 || status === 0) {
    return {
      error: new ProviderError("PROVIDER_UNAVAILABLE", `HTTP ${status}`, requestId),
      category: "HTTP",
    };
  }
  return {
    error: new ProviderError("INVALID_RESPONSE", `HTTP ${status}`, requestId),
    category: "INVALID_RESPONSE",
  };
}

function mergeSignals(external: AbortSignal | undefined, timeoutMs: number): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  const onAbort = () => ctl.abort();
  external?.addEventListener("abort", onAbort);
  return {
    signal: ctl.signal,
    cleanup: () => {
      clearTimeout(timer);
      external?.removeEventListener("abort", onAbort);
    },
  };
}

function assistantTextOf(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const rec = payload as Record<string, unknown>;
  const choices = rec.choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0];
  if (!first || typeof first !== "object") return null;
  const message = (first as Record<string, unknown>).message;
  if (!message || typeof message !== "object") return null;
  const content = (message as Record<string, unknown>).content;
  return typeof content === "string" ? content : null;
}

function modelsFromPayload(data: unknown, fallbackModel: string): ProviderModel[] {
  const rec = data && typeof data === "object" ? (data as Record<string, unknown>) : null;
  const list = rec && Array.isArray(rec.data) ? rec.data : [];
  const models: ProviderModel[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const id = (item as Record<string, unknown>).id;
    if (typeof id === "string" && id) models.push({ id, name: id });
  }
  if (models.length === 0 && fallbackModel.trim()) {
    return [{ id: fallbackModel.trim(), name: fallbackModel.trim() }];
  }
  return models;
}

export class OpenAICompatibleProvider implements AIProvider {
  readonly id = "openai-compatible" as const;
  private readonly config: OpenAICompatibleConfig;
  private readonly controllers = new Map<string, AbortController>();
  private transport: LocalHttpTransport = "webview-fetch";

  constructor(config: OpenAICompatibleConfig) {
    this.config = {
      baseUrl: config.baseUrl,
      model: config.model,
      apiKey: config.apiKey,
      timeoutMs: typeof config.timeoutMs === "number" && Number.isFinite(config.timeoutMs)
        ? Math.max(1, Math.round(config.timeoutMs))
        : DEFAULT_CHAT_TIMEOUT_MS,
      fetchImpl: config.fetchImpl,
    };
  }

  capabilities(): ProviderCapabilities {
    return { chat: true, stream: false, tools: false, local: true };
  }

  abort(requestId: string): void {
    this.controllers.get(requestId)?.abort();
  }

  lastTransport(): LocalHttpTransport {
    return this.transport;
  }

  async getModels(): Promise<ProviderModel[]> {
    if (!isConfigured(this.config)) {
      throw new ProviderError("PROVIDER_UNAVAILABLE", "Provider is not configured");
    }
    const data = await this.requestJson("GET", "/models", undefined, undefined, undefined, {
      timeoutMs: DEFAULT_CONNECTION_TIMEOUT_MS,
    });
    return modelsFromPayload(data, this.config.model);
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const endpoint = sanitizeEndpoint(joinUrl(this.config.baseUrl, "/models"));
    const model = this.config.model.trim();
    if (!isConfigured(this.config)) {
      return {
        ok: false,
        endpoint,
        model,
        category: "UNKNOWN",
        reason: "Provider is not configured",
        error: new ProviderError("PROVIDER_UNAVAILABLE", "Provider is not configured"),
      };
    }
    const started = Date.now();
    try {
      const models = await this.getModels();
      const configured = models.some((m) => m.id === model);
      if (!configured) {
        return {
          ok: false,
          endpoint,
          model,
          latencyMs: Date.now() - started,
          category: "MODEL_NOT_FOUND",
          reason: `Model '${model}' was not in GET /models`,
          transport: this.transport,
          models,
          error: new ProviderError("MODEL_UNAVAILABLE", `Model '${model}' was not in GET /models`),
        };
      }
      return {
        ok: true,
        endpoint,
        model,
        latencyMs: Date.now() - started,
        transport: this.transport,
        models,
      };
    } catch (err) {
      const error =
        err instanceof ProviderError ? err : new ProviderError("PROVIDER_UNAVAILABLE", "Connection failed");
      const category = categoryOfProviderError(err);
      return {
        ok: false,
        endpoint,
        model,
        latencyMs: Date.now() - started,
        category,
        reason: sanitizeDiagnosticMessage(error.message),
        transport: this.transport,
        error,
      };
    }
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    if (!isConfigured(this.config)) {
      throw new ProviderError("PROVIDER_UNAVAILABLE", "Provider is not configured", request.requestId);
    }
    const local = new AbortController();
    this.controllers.set(request.requestId, local);
    const onAbort = () => local.abort();
    request.signal?.addEventListener("abort", onAbort);
    try {
      if (request.signal?.aborted || local.signal.aborted) {
        throw new ProviderError("CANCELLED", "Request cancelled", request.requestId);
      }
      const payload = await this.requestJson(
        "POST",
        "/chat/completions",
        {
          model: request.model ?? this.config.model.trim(),
          messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
          stream: false,
        },
        request.requestId,
        local.signal,
        { timeoutMs: this.config.timeoutMs ?? DEFAULT_CHAT_TIMEOUT_MS },
      );
      const text = assistantTextOf(payload);
      if (text == null) {
        throw new ProviderError("INVALID_RESPONSE", "Chat response missing message.content", request.requestId);
      }
      return {
        requestId: request.requestId,
        text,
        model: request.model ?? this.config.model.trim(),
      };
    } finally {
      request.signal?.removeEventListener("abort", onAbort);
      this.controllers.delete(request.requestId);
    }
  }

  private async requestJson(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    requestId?: string,
    extraSignal?: AbortSignal,
    opts?: { timeoutMs?: number },
  ): Promise<unknown> {
    if (!isAllowedLocalProviderUrl(this.config.baseUrl)) {
      const err = new ProviderError(
        "PROVIDER_UNAVAILABLE",
        "Local provider allows localhost / 127.0.0.1 / ::1 only",
        requestId,
      );
      (err as ProviderError & { category?: ConnectionFailureCategory }).category = "SECURITY_POLICY";
      throw err;
    }
    const timeoutMs = opts?.timeoutMs ?? this.config.timeoutMs ?? DEFAULT_CHAT_TIMEOUT_MS;
    const combined = extraSignal ?? new AbortController().signal;
    const gate = mergeSignals(combined, timeoutMs);
    try {
      let res: Response;
      try {
        const resolved = await resolveLocalProviderFetch(this.config.fetchImpl);
        this.transport = resolved.transport;
        res = await resolved.fetch(joinUrl(this.config.baseUrl, path), {
          method,
          headers: headers(this.config.apiKey),
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: gate.signal,
        });
      } catch (err) {
        if (combined.aborted || extraSignal?.aborted) {
          throw new ProviderError("CANCELLED", "Request cancelled", requestId);
        }
        const timedOut = gate.signal.aborted && !extraSignal?.aborted;
        const mapped = classifyTransportFailure(err, timedOut);
        const error = new ProviderError(mapped.code, mapped.message, requestId);
        (error as ProviderError & { category?: ConnectionFailureCategory }).category = mapped.category;
        throw error;
      }
      const raw = await res.text();
      if (!res.ok) {
        const mapped = mapHttpStatus(res.status, raw, requestId);
        (mapped.error as ProviderError & { category?: ConnectionFailureCategory }).category = mapped.category;
        throw mapped.error;
      }
      if (!raw) return null;
      try {
        return JSON.parse(raw) as unknown;
      } catch {
        throw new ProviderError("INVALID_RESPONSE", "Malformed JSON from provider", requestId);
      }
    } finally {
      gate.cleanup();
    }
  }
}

function categoryOfProviderError(err: unknown): ConnectionFailureCategory {
  if (err instanceof ProviderError) {
    const extra = (err as ProviderError & { category?: ConnectionFailureCategory }).category;
    if (extra) return extra;
    if (err.code === "MODEL_UNAVAILABLE") return "MODEL_NOT_FOUND";
    if (err.code === "INVALID_RESPONSE") return "INVALID_RESPONSE";
    if (/timed out/i.test(err.message)) return "TIMEOUT";
    if (/localhost|127\.0\.0\.1|loopback/i.test(err.message)) return "SECURITY_POLICY";
  }
  return "UNKNOWN";
}

export function createOpenAICompatibleProvider(config: OpenAICompatibleConfig): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider(config);
}

export { assistantTextOf as assistantTextFromChatPayload, mapHttpStatus as mapOpenAICompatibleHttpStatus };

export function connectionStatusOf(
  config: OpenAICompatibleConfig,
  last: { ok?: boolean; code?: ProviderErrorCode; pending?: boolean } | null,
): LocalConnectionStatus {
  if (!isConfigured(config)) return "not-configured";
  if (last?.pending) return "connecting";
  if (last?.ok) return "connected";
  if (last?.code === "PROVIDER_UNAVAILABLE") return "unavailable";
  if (last && last.ok === false) return "error";
  return "not-configured";
}
