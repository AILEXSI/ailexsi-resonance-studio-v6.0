/**
 * Loopback HTTP for the generic OpenAI-compatible adapter.
 * Packaged Tauri uses a native command so WebView CORS / Origin is not applied.
 * Tests and plain web keep injectable / global fetch.
 */
import type { LocalHttpTransport } from "./types";

export const LOCAL_AI_HTTP_COMMAND = "local_ai_http";

export interface TauriLocalHttpInvoke {
  (cmd: string, args: Record<string, unknown>): Promise<unknown>;
}

let invokeImpl: TauriLocalHttpInvoke | null = null;

/** Test hook. Production resolves @tauri-apps/api/core when the Tauri runtime is present. */
export function setTauriLocalHttpInvokeForTests(fn: TauriLocalHttpInvoke | null): void {
  invokeImpl = fn;
}

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function sanitizeEndpoint(raw: string): string {
  try {
    const url = new URL(raw.trim());
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return "(invalid-url)";
  }
}

export function sanitizeDiagnosticMessage(raw: string): string {
  return raw
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/api[_-]?key["\s:=]+\S+/gi, "apiKey [redacted]")
    .replace(/sk-[a-zA-Z0-9]+/g, "[redacted]")
    .slice(0, 240);
}

async function resolveInvoke(): Promise<TauriLocalHttpInvoke | null> {
  if (invokeImpl) return invokeImpl;
  if (!isTauriRuntime()) return null;
  try {
    const mod = await import("@tauri-apps/api/core");
    return (cmd, args) => mod.invoke(cmd, args);
  } catch {
    return null;
  }
}

function headerValue(headers: HeadersInit | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  const h = headers instanceof Headers ? headers : new Headers(headers as HeadersInit);
  return h.get(name) ?? undefined;
}

/**
 * Native loopback fetch. No WebView Origin header, so local servers that
 * allow 127.0.0.1 but not http://tauri.localhost still answer.
 */
export async function tauriLoopbackFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const invoke = await resolveInvoke();
  if (!invoke) {
    throw new TypeError("Tauri loopback HTTP is not available");
  }
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const method = (init?.method ?? "GET").toUpperCase();
  const body = typeof init?.body === "string" ? init.body : undefined;
  const authorization = headerValue(init?.headers, "Authorization");
  const signal = init?.signal;
  if (signal?.aborted) {
    throw new DOMException("The operation was aborted.", "AbortError");
  }
  const work = invoke(LOCAL_AI_HTTP_COMMAND, {
    method,
    url,
    body: body ?? null,
    timeoutMs: 180_000,
    authorization: authorization ?? null,
  });
  const payload = await new Promise<unknown>((resolve, reject) => {
    const onAbort = () => reject(new DOMException("The operation was aborted.", "AbortError"));
    signal?.addEventListener("abort", onAbort);
    work.then(resolve, reject).finally(() => signal?.removeEventListener("abort", onAbort));
  });
  if (!payload || typeof payload !== "object") {
    throw new TypeError("INVALID_RESPONSE: empty native HTTP result");
  }
  const rec = payload as { status?: unknown; body?: unknown };
  const status = typeof rec.status === "number" ? rec.status : 0;
  const text = typeof rec.body === "string" ? rec.body : "";
  return new Response(text, {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function resolveLocalProviderFetch(fetchImpl?: typeof fetch): Promise<{
  fetch: typeof fetch;
  transport: LocalHttpTransport;
}> {
  if (fetchImpl) return { fetch: fetchImpl, transport: "webview-fetch" };
  if (isTauriRuntime() && (invokeImpl || (await resolveInvoke()))) {
    return { fetch: tauriLoopbackFetch as typeof fetch, transport: "tauri-loopback" };
  }
  return { fetch: globalThis.fetch.bind(globalThis), transport: "webview-fetch" };
}
