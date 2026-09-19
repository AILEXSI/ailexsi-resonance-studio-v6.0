import {
  ProviderError,
  type AIProvider,
  type ChatRequest,
  type ChatResponse,
  type ConnectionTestResult,
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
  timeoutMs?: number;
  /** Test hook. Production uses global fetch. */
  fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 8_000;

export function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

export function isConfigured(config: OpenAICompatibleConfig): boolean {
  return normalizeBaseUrl(config.baseUrl).length > 0 && config.model.trim().length > 0;
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

function mapHttpStatus(status: number, bodyText: string, requestId?: string): ProviderError {
  const lower = bodyText.toLowerCase();
  if (status === 401 || status === 403) {
    return new ProviderError("AUTH_FAILED", `HTTP ${status}`, requestId);
  }
  if (status === 429) {
    return new ProviderError("RATE_LIMIT", `HTTP ${status}`, requestId);
  }
  if (status === 404 || /model[_ ]?not[_ ]?found|unknown model/i.test(bodyText)) {
    return new ProviderError("MODEL_UNAVAILABLE", `HTTP ${status}`, requestId);
  }
  if (/context length|maximum context|too many tokens/i.test(lower)) {
    return new ProviderError("CONTEXT_LIMIT", `HTTP ${status}`, requestId);
  }
  if (status >= 500 || status === 0) {
    return new ProviderError("PROVIDER_UNAVAILABLE", `HTTP ${status}`, requestId);
  }
  return new ProviderError("INVALID_RESPONSE", `HTTP ${status}`, requestId);
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

export class OpenAICompatibleProvider implements AIProvider {
  readonly id = "openai-compatible" as const;
  private readonly config: OpenAICompatibleConfig;
  private readonly controllers = new Map<string, AbortController>();

  constructor(config: OpenAICompatibleConfig) {
    this.config = {
      baseUrl: config.baseUrl,
      model: config.model,
      apiKey: config.apiKey,
      timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      fetchImpl: config.fetchImpl,
    };
  }

  capabilities(): ProviderCapabilities {
    return { chat: true, stream: false, tools: false, local: true };
  }

  abort(requestId: string): void {
    this.controllers.get(requestId)?.abort();
  }

  async getModels(): Promise<ProviderModel[]> {
    if (!isConfigured(this.config)) {
      throw new ProviderError("PROVIDER_UNAVAILABLE", "Provider is not configured");
    }
    const data = await this.requestJson("GET", "/models");
    const rec = data && typeof data === "object" ? (data as Record<string, unknown>) : null;
    const list = rec && Array.isArray(rec.data) ? rec.data : [];
    const models: ProviderModel[] = [];
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const id = (item as Record<string, unknown>).id;
      if (typeof id === "string" && id) models.push({ id, name: id });
    }
    if (models.length === 0 && this.config.model.trim()) {
      return [{ id: this.config.model.trim(), name: this.config.model.trim() }];
    }
    return models;
  }

  async testConnection(): Promise<ConnectionTestResult> {
    if (!isConfigured(this.config)) {
      return {
        ok: false,
        error: new ProviderError("PROVIDER_UNAVAILABLE", "Provider is not configured"),
      };
    }
    try {
      await this.getModels();
      return { ok: true };
    } catch (err) {
      const error =
        err instanceof ProviderError ? err : new ProviderError("PROVIDER_UNAVAILABLE", "Connection failed");
      return { ok: false, error };
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
  ): Promise<unknown> {
    const combined = extraSignal ?? new AbortController().signal;
    const gate = mergeSignals(combined, this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    try {
      let res: Response;
      try {
        const doFetch = this.config.fetchImpl ?? fetch;
        res = await doFetch(joinUrl(this.config.baseUrl, path), {
          method,
          headers: headers(this.config.apiKey),
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: gate.signal,
        });
      } catch (err) {
        if (combined.aborted || extraSignal?.aborted) {
          throw new ProviderError("CANCELLED", "Request cancelled", requestId);
        }
        if (gate.signal.aborted) {
          throw new ProviderError("PROVIDER_UNAVAILABLE", "Connection timed out", requestId);
        }
        throw new ProviderError(
          "PROVIDER_UNAVAILABLE",
          err instanceof Error ? err.message : "Provider unreachable",
          requestId,
        );
      }
      const raw = await res.text();
      if (!res.ok) {
        throw mapHttpStatus(res.status, raw, requestId);
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
