import { mockDirectorReply } from "../conversation";
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

export interface MockProviderOptions {
  /** When set, chat/testConnection fail with this code. */
  failWith?: ProviderErrorCode;
  /** Artificial delay so tests can cancel / race stale replies. */
  delayMs?: number;
  modelId?: string;
}

export class MockProvider implements AIProvider {
  readonly id = "mock" as const;
  private readonly failWith?: ProviderErrorCode;
  private readonly delayMs: number;
  private readonly modelId: string;
  private readonly controllers = new Map<string, AbortController>();

  constructor(opts: MockProviderOptions = {}) {
    this.failWith = opts.failWith;
    this.delayMs = opts.delayMs ?? 0;
    this.modelId = opts.modelId ?? "mock-director";
  }

  capabilities(): ProviderCapabilities {
    return { chat: true, stream: false, tools: false, local: true };
  }

  async getModels(): Promise<ProviderModel[]> {
    return [{ id: this.modelId, name: "Mock Director" }];
  }

  async testConnection(): Promise<ConnectionTestResult> {
    if (this.failWith) {
      return {
        ok: false,
        error: new ProviderError(this.failWith, `Mock provider failed: ${this.failWith}`),
      };
    }
    return { ok: true };
  }

  abort(requestId: string): void {
    const ctl = this.controllers.get(requestId);
    ctl?.abort();
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const local = new AbortController();
    this.controllers.set(request.requestId, local);
    const onAbort = () => local.abort();
    request.signal?.addEventListener("abort", onAbort);
    try {
      if (request.signal?.aborted || local.signal.aborted) {
        throw new ProviderError("CANCELLED", "Request cancelled", request.requestId);
      }
      if (this.failWith) {
        throw new ProviderError(this.failWith, `Mock provider failed: ${this.failWith}`, request.requestId);
      }
      if (this.delayMs > 0) {
        await wait(this.delayMs, local.signal);
      }
      if (request.signal?.aborted || local.signal.aborted) {
        throw new ProviderError("CANCELLED", "Request cancelled", request.requestId);
      }
      const lastUser = [...request.messages].reverse().find((m) => m.role === "user");
      return {
        requestId: request.requestId,
        text: mockDirectorReply(lastUser?.content ?? ""),
        model: request.model ?? this.modelId,
      };
    } finally {
      request.signal?.removeEventListener("abort", onAbort);
      this.controllers.delete(request.requestId);
    }
  }
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new ProviderError("CANCELLED", "Request cancelled"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new ProviderError("CANCELLED", "Request cancelled"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function createMockProvider(opts?: MockProviderOptions): MockProvider {
  return new MockProvider(opts);
}
