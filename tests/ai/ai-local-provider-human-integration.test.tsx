import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyLocalConfig,
  applyProviderId,
  beginDirectorConnectionTest,
  createDirectorHostState,
  discoverDirectorModels,
  findLocalAiEndpoints,
  finishDirectorConnectionTest,
  hydrateDirectorHostFromPrefs,
  persistDirectorHostPrefs,
  submitDirectorProviderTurn,
  testDirectorConnection,
  type DirectorHostState,
} from "../../src/app/ai/host";
import { createOrchestrator } from "../../src/app/ai/orchestrator";
import {
  classifyTransportFailure,
  createOpenAICompatibleProvider,
  DEFAULT_CHAT_TIMEOUT_MS,
  DEFAULT_CONNECTION_TIMEOUT_MS,
  isAllowedLocalProviderUrl,
} from "../../src/app/ai/providers/openai-compatible";
import {
  LOOPBACK_DISCOVERY_PORTS,
  probeLoopbackOpenAiCompatible,
} from "../../src/app/ai/providers/local-discovery";
import {
  sanitizeDiagnosticMessage,
  sanitizeEndpoint,
  setTauriLocalHttpInvokeForTests,
} from "../../src/app/ai/providers/local-http";
import { createMockProvider } from "../../src/app/ai/providers/mock";
import { AI_PREFS_KEY, loadAiPrefs } from "../../src/app/ai/providers/prefs";
import { GOLDEN_MOVE_PROMPT } from "../../src/app/ai/tools/move-clip";
import { applyCommand } from "../../src/app/commands";
import { createSession, type Session } from "../../src/app/session";
import { PROJECT_SCHEMA_VERSION, serializeProject } from "../../src/core/project";
import { createMemoryBlobStore } from "../../src/core/persistence";
import { DirectorPanel } from "../../src/ui/director/DirectorPanel";
import { asset, clip, projectWith } from "../helpers";

type Handler = (input: {
  url: string;
  method: string;
  body: string;
  signal?: AbortSignal;
}) => Promise<{ status: number; body: string }> | { status: number; body: string };

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

function fixture(startMs = 30_000): Session {
  const a = asset({ id: "aa", kind: "audio", durationMs: 8000 });
  const c = clip({
    id: "clip_test",
    assetId: "aa",
    trackId: "A1",
    startMs,
    durationMs: 2000,
  });
  return {
    ...createSession(createMemoryBlobStore()),
    project: { ...projectWith([c], [a]), snap: true },
    selectedClipId: "clip_test",
    selectedClipIds: ["clip_test"],
  };
}

function goldenHost(patch?: Partial<DirectorHostState>): DirectorHostState {
  return {
    ...createDirectorHostState(),
    grant: "EDIT",
    mode: "AGENT",
    modeLabel: "Mode: AGENT",
    contextLevel: "SELECTION",
    contextLabel: "Context: SELECTION",
    providerId: "openai-compatible",
    localConfig: { baseUrl: "http://127.0.0.1:11434/v1", model: "qwen2.5:7b" },
    ...patch,
  };
}

function modelsOk(ids: string[]): Handler {
  return ({ url }) => {
    if (url.endsWith("/models")) {
      return { status: 200, body: JSON.stringify({ data: ids.map((id) => ({ id })) }) };
    }
    return {
      status: 200,
      body: JSON.stringify({
        choices: [{ message: { role: "assistant", content: "hello from local" } }],
      }),
    };
  };
}

describe("local provider human-integration", () => {
  afterEach(() => {
    setTauriLocalHttpInvokeForTests(null);
    delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    localStorage.removeItem(AI_PREFS_KEY);
  });

  it("keeps ADV-5 loopback-only and a chat timeout above human cold Ollama", () => {
    expect(isAllowedLocalProviderUrl("http://127.0.0.1:11434/v1")).toBe(true);
    expect(isAllowedLocalProviderUrl("http://10.0.0.8/v1")).toBe(false);
    expect(DEFAULT_CONNECTION_TIMEOUT_MS).toBe(8_000);
    expect(DEFAULT_CHAT_TIMEOUT_MS).toBeGreaterThan(32_380);
    expect(DEFAULT_CHAT_TIMEOUT_MS).toBe(90_000);
  });

  it("connection test uses the short timeout; chat uses the configured chat timeout", async () => {
    const fetchImpl = mockHttp(async ({ url, signal }) => {
      await delay(50, signal);
      return modelsOk(["qwen2.5:7b"])({ url, method: "GET", body: "" });
    });
    const provider = createOpenAICompatibleProvider({
      baseUrl: "http://127.0.0.1:11434/v1",
      model: "qwen2.5:7b",
      timeoutMs: 20,
      fetchImpl,
    });
    const conn = await provider.testConnection();
    expect(conn.ok).toBe(true);
    expect(conn.latencyMs).toBeGreaterThanOrEqual(40);
    await expect(
      provider.chat({ requestId: "slow", messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE", message: /timed out/i });
  });

  it("classifies timeout / refused / CORS / security without leaking secrets", () => {
    expect(classifyTransportFailure(new Error("x"), true).category).toBe("TIMEOUT");
    expect(classifyTransportFailure(new TypeError("Failed to fetch"), false).category).toBe("UNKNOWN");
    expect(classifyTransportFailure(new Error("blocked by CORS policy"), false).category).toBe("CORS");
    expect(classifyTransportFailure(new Error("ECONNREFUSED 127.0.0.1:11434"), false).category).toBe(
      "REFUSED",
    );
    expect(classifyTransportFailure(new Error("Mixed Content blocked"), false).category).toBe(
      "SECURITY_POLICY",
    );
    expect(sanitizeDiagnosticMessage("Bearer sk-secret-value boom")).not.toMatch(/sk-secret/);
    expect(sanitizeEndpoint("http://user:hunter2@127.0.0.1:11434/v1?token=abc")).toBe(
      "http://127.0.0.1:11434/v1",
    );
  });

  it("beginDirectorConnectionTest is synchronous Testing... before any fetch", async () => {
    let fetched = false;
    const fetchImpl = mockHttp(async ({ url }) => {
      fetched = true;
      await delay(20);
      return modelsOk(["qwen2.5:7b"])({ url, method: "GET", body: "" });
    });
    const start = applyLocalConfig(applyProviderId(createDirectorHostState(), "openai-compatible"), {
      baseUrl: "http://127.0.0.1:11434/v1",
      model: "qwen2.5:7b",
      fetchImpl,
    });
    const testing = beginDirectorConnectionTest(start);
    expect(testing.statusLabel).toBe("Testing...");
    expect(testing.connectionProbe.phase).toBe("testing");
    expect(fetched).toBe(false);
    const done = await finishDirectorConnectionTest(testing);
    expect(done.connectionProbe.phase).toBe("connected");
    expect(done.statusLabel).toMatch(/^Connected \(/);
    expect(done.statusLabel).toMatch(/127\.0\.0\.1:11434\/v1\/models/);
    expect(done.statusLabel).toMatch(/qwen2\.5:7b/);
    expect(done.statusLabel).toMatch(/ms\)/);
    expect(done.discoveredModels.map((m) => m.id)).toEqual(["qwen2.5:7b"]);
    expect(JSON.stringify(done)).not.toMatch(/apiKey|Bearer |sk-/);
  });

  it("failed probe shows CONNECTION FAILED with a concrete category", async () => {
    const start = applyLocalConfig(applyProviderId(createDirectorHostState(), "openai-compatible"), {
      baseUrl: "http://127.0.0.1:11434/v1",
      model: "qwen2.5:7b",
      fetchImpl: async () => {
        throw new TypeError("Failed to fetch");
      },
    });
    const next = await testDirectorConnection(start);
    expect(next.connectionProbe.phase).toBe("failed");
    expect(next.statusLabel).toMatch(/^CONNECTION FAILED \(/);
    expect(next.statusLabel).toMatch(/category: UNKNOWN/);
    expect(next.connectionProbe.category).toBe("UNKNOWN");
  });

  it("Discover Models populates the selector from GET /models", async () => {
    const start = applyLocalConfig(applyProviderId(createDirectorHostState(), "openai-compatible"), {
      baseUrl: "http://127.0.0.1:11434/v1",
      model: "qwen2.5:7b",
      fetchImpl: mockHttp(modelsOk(["qwen2.5:7b", "other-local"])),
    });
    const next = await discoverDirectorModels(start);
    expect(next.discoveredModels.map((m) => m.id)).toEqual(["qwen2.5:7b", "other-local"]);
  });

  it("Find Local AI only probes the loopback port allowlist", async () => {
    const seen: string[] = [];
    const fetchImpl = mockHttp(({ url }) => {
      seen.push(url);
      if (url === "http://127.0.0.1:11434/v1/models") {
        return { status: 200, body: JSON.stringify({ data: [{ id: "found-local" }] }) };
      }
      throw new TypeError("Failed to fetch");
    });
    const hits = await probeLoopbackOpenAiCompatible({ fetchImpl, timeoutMs: 40 });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.baseUrl).toBe("http://127.0.0.1:11434/v1");
    expect(hits[0]?.models[0]?.id).toBe("found-local");
    expect(seen.every((u) => /^http:\/\/127\.0\.0\.1:(11434|1234|8080|4891|5000|8000)\/v1\/models$/.test(u))).toBe(
      true,
    );
    expect(LOOPBACK_DISCOVERY_PORTS).not.toContain(80);
    expect(seen.some((u) => u.includes("10.0.") || u.includes("ollama") || u.includes("lmstudio"))).toBe(
      false,
    );

    const next = await findLocalAiEndpoints({
      ...applyProviderId(createDirectorHostState(), "openai-compatible"),
      localConfig: { baseUrl: "", model: "", fetchImpl },
    });
    expect(next.localConfig.baseUrl).toBe("http://127.0.0.1:11434/v1");
    expect(next.localConfig.model).toBe("found-local");
    expect(next.connectionProbe.phase).toBe("connected");
  });

  it("packaged Tauri path uses native loopback HTTP (no WebView Origin)", async () => {
    (window as unknown as { __TAURI_INTERNALS__: object }).__TAURI_INTERNALS__ = {};
    const urls: string[] = [];
    setTauriLocalHttpInvokeForTests(async (cmd, args) => {
      expect(cmd).toBe("local_ai_http");
      urls.push(String(args.url));
      expect(JSON.stringify(args)).not.toMatch(/sk-secret|apiKey/);
      if (String(args.url).endsWith("/models")) {
        return { status: 200, body: JSON.stringify({ data: [{ id: "qwen2.5:7b" }] }) };
      }
      return {
        status: 200,
        body: JSON.stringify({
          choices: [{ message: { role: "assistant", content: "native-ok" } }],
        }),
      };
    });
    const provider = createOpenAICompatibleProvider({
      baseUrl: "http://127.0.0.1:11434/v1",
      model: "qwen2.5:7b",
    });
    const conn = await provider.testConnection();
    expect(conn.ok).toBe(true);
    expect(conn.transport).toBe("tauri-loopback");
    const chat = await provider.chat({
      requestId: "native",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(chat.text).toBe("native-ok");
    expect(urls.some((u) => u.endsWith("/v1/models"))).toBe(true);
    expect(urls.some((u) => u.endsWith("/v1/chat/completions"))).toBe(true);
  });

  it("unsupported delete intent does not invent move_clip or mutate", async () => {
    const session = fixture();
    const before = structuredClone(session.project.clips);
    const mock = await submitDirectorProviderTurn(
      { ...goldenHost(), providerId: "mock" },
      "Lösche den markierten Clip",
      { provider: createMockProvider(), orchestrator: createOrchestrator() },
      undefined,
      session,
    );
    expect(mock.transaction).toBeNull();
    expect(session.project.clips).toEqual(before);

    const local = await submitDirectorProviderTurn(
      goldenHost({
        localConfig: {
          baseUrl: "http://127.0.0.1:11434/v1",
          model: "qwen2.5:7b",
          fetchImpl: mockHttp(() => ({
            status: 200,
            body: JSON.stringify({
              choices: [
                {
                  message: {
                    role: "assistant",
                    content: JSON.stringify({
                      message: "Cannot delete.",
                      toolRequest: { name: "timeline.delete_clip", arguments: {} },
                    }),
                  },
                },
              ],
            }),
          })),
        },
      }),
      "Lösche den markierten Clip",
      {
        provider: createOpenAICompatibleProvider({
          baseUrl: "http://127.0.0.1:11434/v1",
          model: "qwen2.5:7b",
          fetchImpl: mockHttp(() => ({
            status: 200,
            body: JSON.stringify({
              choices: [
                {
                  message: {
                    role: "assistant",
                    content: JSON.stringify({
                      message: "Cannot delete.",
                      toolRequest: { name: "timeline.delete_clip", arguments: {} },
                    }),
                  },
                },
              ],
            }),
          })),
        }),
        orchestrator: createOrchestrator(),
      },
      undefined,
      session,
    );
    expect(local.transaction).toBeNull();
    expect(local.conversation.messages.at(-1)?.text).toMatch(/Unknown tool|No project changes/);
    expect(session.project.clips).toEqual(before);
    expect(session.history.past.length).toBe(0);
    expect(session.project.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(JSON.parse(serializeProject(session.project)).schemaVersion).toBe(5);
    const after = applyCommand(session, { type: "select", clipId: "clip_test" });
    expect(after.project.clips).toEqual(before);
  });

  it("prefs may persist timeoutMs but never apiKey", () => {
    const state = applyLocalConfig(applyProviderId(createDirectorHostState(), "openai-compatible"), {
      baseUrl: "http://127.0.0.1:11434/v1",
      model: "qwen2.5:7b",
      timeoutMs: 90_000,
      apiKey: "sk-secret",
    });
    persistDirectorHostPrefs(state, localStorage);
    const loaded = loadAiPrefs(localStorage);
    expect(loaded.timeoutMs).toBe(90_000);
    expect(JSON.stringify(loaded)).not.toMatch(/apiKey|sk-secret/);
    const hydrated = hydrateDirectorHostFromPrefs(localStorage);
    expect(hydrated.localConfig.timeoutMs).toBe(90_000);
    expect(hydrated.localConfig).not.toHaveProperty("apiKey");
  });
});

describe("Director Test connection UX", () => {
  let host: HTMLDivElement | undefined;
  let root: Root | undefined;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    host?.remove();
    host = undefined;
    root = undefined;
  });

  it("click shows Testing... immediately then Connected with endpoint/model/latency", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchImpl = mockHttp(async ({ url }) => {
      await gate;
      return modelsOk(["qwen2.5:7b"])({ url, method: "GET", body: "" });
    });
    await act(async () => {
      root = createRoot(host!);
      root.render(
        <DirectorPanel
          initialState={goldenHost({
            localConfig: {
              baseUrl: "http://127.0.0.1:11434/v1",
              model: "qwen2.5:7b",
              fetchImpl,
            },
          })}
        />,
      );
    });
    const button = host!.querySelector('[data-testid="director-test-connection"]') as HTMLButtonElement;
    await act(async () => {
      button.click();
    });
    expect(button.textContent).toBe("Testing...");
    expect(host!.querySelector('[data-testid="director-connection-probe"]')?.textContent).toBe(
      "Testing...",
    );
    expect(host!.querySelector('[data-testid="director-status"]')?.textContent).toBe("Testing...");
    await act(async () => {
      release();
      await Promise.resolve();
      await Promise.resolve();
    });
    const probe = host!.querySelector('[data-testid="director-connection-probe"]');
    expect(probe?.getAttribute("data-phase")).toBe("connected");
    expect(probe?.textContent).toMatch(/^Connected \(/);
    expect(probe?.textContent).toMatch(/qwen2\.5:7b/);
    expect(host!.querySelector('[data-testid="director-discover-models"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="director-find-local-ai"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="director-chat-timeout"]')).toBeTruthy();
  });

  it("golden NL still drafts +2000 after a successful local structured reply", async () => {
    const session = fixture();
    const provider = createOpenAICompatibleProvider({
      baseUrl: "http://127.0.0.1:11434/v1",
      model: "qwen2.5:7b",
      timeoutMs: 90_000,
      fetchImpl: mockHttp(({ method, body }) => {
        if (method === "GET") {
          return { status: 200, body: JSON.stringify({ data: [{ id: "qwen2.5:7b" }] }) };
        }
        expect(JSON.parse(body).model).toBe("qwen2.5:7b");
        return {
          status: 200,
          body: JSON.stringify({
            choices: [
              {
                message: {
                  role: "assistant",
                  content: JSON.stringify({
                    message: "Preview +2000ms",
                    toolRequest: { name: "timeline.move_clip", arguments: { deltaMs: 2000 } },
                  }),
                },
              },
            ],
          }),
        };
      }),
    });
    const next = await submitDirectorProviderTurn(
      goldenHost({
        localConfig: { baseUrl: "http://127.0.0.1:11434/v1", model: "qwen2.5:7b" },
      }),
      GOLDEN_MOVE_PROMPT,
      { provider, orchestrator: createOrchestrator() },
      undefined,
      session,
    );
    expect(next.transaction?.status).toBe("draft");
    expect(next.transaction?.command).toEqual({
      type: "moveClips",
      clipIds: ["clip_test"],
      deltaMs: 2000,
    });
    expect(session.project.clips[0]?.startMs).toBe(30_000);
  });
});
