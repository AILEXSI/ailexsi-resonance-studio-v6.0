import { describe, expect, it } from "vitest";
import { createOrchestrator } from "../../src/app/ai/orchestrator";
import { createDirectorHostState, submitDirectorProviderTurn } from "../../src/app/ai/host";
import {
  createOpenAICompatibleProvider,
  isConfigured,
  statusLabel,
} from "../../src/app/ai/providers/openai-compatible";
import { loadAiPrefs, prefsContainSecret, saveAiPrefs } from "../../src/app/ai/providers/prefs";
import { applyCommand } from "../../src/app/commands";
import { createSession, type Session } from "../../src/app/session";
import { PROJECT_SCHEMA_VERSION, serializeProject } from "../../src/core/project";
import { createMemoryBlobStore } from "../../src/core/persistence";
import { asset, clip, projectWith } from "../helpers";

type Handler = (input: {
  url: string;
  method: string;
  body: string;
  signal?: AbortSignal;
}) => Promise<{ status: number; body: string }> | { status: number; body: string };

/** In-process mock HTTP server. No Ollama, no public network. */
function mockHttp(handler: Handler): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    const body = typeof init?.body === "string" ? init.body : "";
    const signal = init?.signal ?? undefined;
    if (signal?.aborted) {
      throw new DOMException("The operation was aborted.", "AbortError");
    }
    const work = Promise.resolve(handler({ url, method, body, signal }));
    const result = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const onAbort = () => reject(new DOMException("The operation was aborted.", "AbortError"));
      signal?.addEventListener("abort", onAbort);
      work.then(resolve, reject).finally(() => signal?.removeEventListener("abort", onAbort));
    });
    return new Response(result.body, {
      status: result.status,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("The operation was aborted.", "AbortError"));
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function sessionWithClip(): Session {
  const a = asset({ id: "aa", kind: "audio", durationMs: 4000 });
  const c = clip({
    id: "clip_test",
    assetId: "aa",
    trackId: "A1",
    startMs: 30_000,
    durationMs: 2000,
  });
  return {
    ...createSession(createMemoryBlobStore()),
    project: projectWith([c], [a]),
    selectedClipId: "clip_test",
    selectedClipIds: ["clip_test"],
  };
}

describe("AI-3 local OpenAI-compatible provider", () => {
  it("is not configured without base URL + model", () => {
    expect(isConfigured({ baseUrl: "", model: "" })).toBe(false);
    expect(statusLabel("not-configured")).toBe("Not configured");
    expect(statusLabel("connecting")).toBe("Connecting");
    expect(statusLabel("connected")).toBe("Connected");
    expect(statusLabel("unavailable")).toBe("Unavailable");
    expect(statusLabel("error")).toBe("Error");
  });

  it("testConnection + chat succeed against a mock HTTP server", async () => {
    const fetchImpl = mockHttp(({ url, body }) => {
      if (url.endsWith("/models")) {
        return { status: 200, body: JSON.stringify({ data: [{ id: "local-model" }] }) };
      }
      const parsed = JSON.parse(body) as { model?: string; tools?: unknown };
      expect(parsed.tools).toBeUndefined();
      expect(parsed.model).toBe("local-model");
      return {
        status: 200,
        body: JSON.stringify({
          choices: [{ message: { role: "assistant", content: "hello from local" } }],
        }),
      };
    });
    const provider = createOpenAICompatibleProvider({
      baseUrl: "http://127.0.0.1:11434/v1",
      model: "local-model",
      fetchImpl,
    });
    const conn = await provider.testConnection();
    expect(conn.ok).toBe(true);
    const models = await provider.getModels();
    expect(models.some((m) => m.id === "local-model")).toBe(true);
    const chat = await provider.chat({
      requestId: "req_ok",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(chat.text).toBe("hello from local");
    expect(chat.requestId).toBe("req_ok");
  });

  it("maps HTTP failures to normalized codes", async () => {
    const fail = (status: number) =>
      createOpenAICompatibleProvider({
        baseUrl: "http://127.0.0.1:9/v1",
        model: "m",
        fetchImpl: mockHttp(() => ({ status, body: JSON.stringify({ error: "x" }) })),
      }).chat({ requestId: "r", messages: [{ role: "user", content: "x" }] });

    await expect(fail(503)).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    await expect(fail(401)).rejects.toMatchObject({ code: "AUTH_FAILED" });
    await expect(fail(429)).rejects.toMatchObject({ code: "RATE_LIMIT" });
    await expect(fail(404)).rejects.toMatchObject({ code: "MODEL_UNAVAILABLE" });
  });

  it("rejects malformed chat JSON", async () => {
    const provider = createOpenAICompatibleProvider({
      baseUrl: "http://127.0.0.1:9/v1",
      model: "m",
      fetchImpl: mockHttp(() => ({ status: 200, body: "{not-json" })),
    });
    await expect(
      provider.chat({ requestId: "r", messages: [{ role: "user", content: "x" }] }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("rejects a 200 payload without message.content", async () => {
    const provider = createOpenAICompatibleProvider({
      baseUrl: "http://127.0.0.1:9/v1",
      model: "m",
      fetchImpl: mockHttp(() => ({ status: 200, body: JSON.stringify({ choices: [{}] }) })),
    });
    await expect(
      provider.chat({ requestId: "r", messages: [{ role: "user", content: "x" }] }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("times out a hanging server", async () => {
    const provider = createOpenAICompatibleProvider({
      baseUrl: "http://127.0.0.1:9/v1",
      model: "m",
      timeoutMs: 30,
      fetchImpl: mockHttp(async ({ signal }) => {
        await delay(500, signal);
        return { status: 200, body: "{}" };
      }),
    });
    await expect(
      provider.chat({ requestId: "r", messages: [{ role: "user", content: "x" }] }),
    ).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
  });

  it("cancels an in-flight chat", async () => {
    const provider = createOpenAICompatibleProvider({
      baseUrl: "http://127.0.0.1:9/v1",
      model: "m",
      timeoutMs: 5_000,
      fetchImpl: mockHttp(async ({ signal }) => {
        await delay(5_000, signal);
        return { status: 200, body: "{}" };
      }),
    });
    const ctl = new AbortController();
    const pending = provider.chat({
      requestId: "req_c",
      messages: [{ role: "user", content: "x" }],
      signal: ctl.signal,
    });
    ctl.abort();
    await expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
  });

  it("treats a refused / failed fetch as unavailable", async () => {
    const provider = createOpenAICompatibleProvider({
      baseUrl: "http://127.0.0.1:1/v1",
      model: "m",
      timeoutMs: 200,
      fetchImpl: async () => {
        throw new TypeError("fetch failed");
      },
    });
    const conn = await provider.testConnection();
    expect(conn.ok).toBe(false);
    expect(conn.error?.code).toBe("PROVIDER_UNAVAILABLE");
  });

  it("provider failure does not mutate Project", async () => {
    const start = sessionWithClip();
    const before = start.project;
    const beforeClips = structuredClone(start.project.clips);
    const provider = createOpenAICompatibleProvider({
      baseUrl: "http://127.0.0.1:1/v1",
      model: "m",
      fetchImpl: async () => {
        throw new TypeError("fetch failed");
      },
    });
    const next = await submitDirectorProviderTurn(
      { ...createDirectorHostState(), providerId: "openai-compatible" },
      "move nothing",
      { provider, orchestrator: createOrchestrator() },
    );
    expect(next.status).toBe("error");
    expect(start.project).toBe(before);
    expect(start.project.clips).toEqual(beforeClips);
    expect(start.history.past.length).toBe(0);
    expect(start.project.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(JSON.parse(serializeProject(start.project)).schemaVersion).toBe(5);
    expect(serializeProject(start.project)).not.toMatch(/127\.0\.0\.1|apiKey|Bearer/i);
    const after = applyCommand(start, { type: "select", clipId: "clip_test" });
    expect(after.project).toBe(start.project);
  });

  it("prefs persist URL/model but never an API key", () => {
    const storage = new Map<string, string>();
    const mem = {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => {
        expect(prefsContainSecret(v)).toBe(false);
        storage.set(k, v);
      },
    };
    saveAiPrefs(mem, {
      providerId: "openai-compatible",
      baseUrl: "http://127.0.0.1:11434/v1",
      model: "m",
    });
    const loaded = loadAiPrefs(mem);
    expect(loaded.baseUrl).toContain("127.0.0.1");
    expect(loaded).not.toHaveProperty("apiKey");
    expect(JSON.stringify(loaded)).not.toMatch(/apiKey|sk-/);
  });
});
