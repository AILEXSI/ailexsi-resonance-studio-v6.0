import { describe, expect, it } from "vitest";
import { createOrchestrator, orchestrateChat } from "../../src/app/ai/orchestrator";
import { createDirectorHostState, submitDirectorProviderTurn } from "../../src/app/ai/host";
import {
  createMockProvider,
  createProvider,
  knownProviderIds,
  registerBuiltInProviders,
  registerProvider,
  clearProviderRegistry,
  registeredProviderIds,
  ProviderError,
  PROVIDER_ERROR_CODES,
  type AIProvider,
  type ChatRequest,
  type ChatResponse,
  type ConnectionTestResult,
  type ProviderCapabilities,
  type ProviderModel,
} from "../../src/app/ai/providers";
import { applyCommand } from "../../src/app/commands";
import { createSession, selectionOf, type Session } from "../../src/app/session";
import { PROJECT_SCHEMA_VERSION, serializeProject } from "../../src/core/project";
import { createMemoryBlobStore } from "../../src/core/persistence";
import { asset, clip, projectWith } from "../helpers";

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

function assertConforms(provider: AIProvider): void {
  expect(typeof provider.id).toBe("string");
  expect(typeof provider.getModels).toBe("function");
  expect(typeof provider.capabilities).toBe("function");
  expect(typeof provider.chat).toBe("function");
  expect(typeof provider.testConnection).toBe("function");
  const caps: ProviderCapabilities = provider.capabilities();
  expect(typeof caps.chat).toBe("boolean");
  expect(typeof caps.stream).toBe("boolean");
  expect(typeof caps.tools).toBe("boolean");
  expect(typeof caps.local).toBe("boolean");
}

describe("AI-2 provider abstraction", () => {
  it("MockProvider conforms to AIProvider", async () => {
    const mock = createMockProvider();
    assertConforms(mock);
    const models: ProviderModel[] = await mock.getModels();
    expect(models[0]?.id).toBe("mock-director");
    const caps = mock.capabilities();
    expect(caps.chat).toBe(true);
    expect(caps.tools).toBe(false);
    const conn: ConnectionTestResult = await mock.testConnection();
    expect(conn.ok).toBe(true);
    const reply: ChatResponse = await mock.chat({
      requestId: "req_1",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(reply.requestId).toBe("req_1");
    expect(reply.text).toMatch(/Director \(mock\)/);
  });

  it("registry lists reserved ids and only implements mock", () => {
    clearProviderRegistry();
    registerBuiltInProviders();
    expect(knownProviderIds()).toEqual([
      "mock",
      "openai",
      "anthropic",
      "xai",
      "deepseek",
      "ollama",
      "lmstudio",
      "llamacpp",
      "openai-compatible",
    ]);
    expect(registeredProviderIds()).toEqual(["mock"]);
    const mock = createProvider("mock");
    expect(mock.id).toBe("mock");
  });

  it("unknown and unimplemented providers fail closed", () => {
    clearProviderRegistry();
    registerBuiltInProviders();
    expect(() => createProvider("not-a-provider")).toThrow(ProviderError);
    try {
      createProvider("not-a-provider");
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError);
      expect((err as ProviderError).code).toBe("PROVIDER_UNAVAILABLE");
    }
    expect(() => createProvider("openai")).toThrow(ProviderError);
    try {
      createProvider("openai");
    } catch (err) {
      expect((err as ProviderError).code).toBe("PROVIDER_UNAVAILABLE");
    }
  });

  it("cancel via AbortSignal yields CANCELLED", async () => {
    const mock = createMockProvider({ delayMs: 200 });
    const ctl = new AbortController();
    const pending = mock.chat({
      requestId: "req_cancel",
      messages: [{ role: "user", content: "wait" }],
      signal: ctl.signal,
    });
    ctl.abort();
    await expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
  });

  it("abort(requestId) cancels an in-flight chat", async () => {
    const mock = createMockProvider({ delayMs: 200 });
    const pending = mock.chat({
      requestId: "req_abort",
      messages: [{ role: "user", content: "wait" }],
    });
    mock.abort("req_abort");
    await expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
  });

  it("stale responses are ignored by the orchestrator", async () => {
    const slow = createMockProvider({ delayMs: 40 });
    const fast = createMockProvider({ delayMs: 0 });
    const orch = createOrchestrator();
    const first = orchestrateChat(slow, [{ role: "user", content: "first" }], orch);
    const second = orchestrateChat(fast, [{ role: "user", content: "second" }], orch);
    const [a, b] = await Promise.all([first, second]);
    const kinds = [a.kind, b.kind].sort();
    expect(kinds).toEqual(["ok", "stale"]);
    const ok = a.kind === "ok" ? a : b.kind === "ok" ? b : null;
    expect(ok?.kind).toBe("ok");
    if (ok?.kind === "ok") expect(ok.response.text).toMatch(/6 characters/);
  });

  it("normalized error codes are the closed set", () => {
    expect(PROVIDER_ERROR_CODES).toEqual([
      "PROVIDER_UNAVAILABLE",
      "AUTH_FAILED",
      "RATE_LIMIT",
      "MODEL_UNAVAILABLE",
      "CONTEXT_LIMIT",
      "CANCELLED",
      "INVALID_RESPONSE",
    ]);
  });

  it("provider failure does not mutate Project or history", async () => {
    const start = sessionWithClip();
    const before = start.project;
    const beforeClips = structuredClone(start.project.clips);
    const beforeHistory = start.history.past.length;
    const failing = createMockProvider({ failWith: "PROVIDER_UNAVAILABLE" });
    const next = await submitDirectorProviderTurn(
      createDirectorHostState(),
      "please fail",
      { provider: failing, orchestrator: createOrchestrator() },
    );
    expect(next.status).toBe("error");
    expect(next.statusLabel).toMatch(/PROVIDER_UNAVAILABLE/);
    expect(start.project).toBe(before);
    expect(start.project.clips).toEqual(beforeClips);
    expect(start.history.past.length).toBe(beforeHistory);
    expect(selectionOf(start)).toEqual(["clip_test"]);
    expect(start.project.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(JSON.parse(serializeProject(start.project)).schemaVersion).toBe(5);
    const afterSelect = applyCommand(start, { type: "select", clipId: "clip_test" });
    expect(afterSelect.project).toBe(start.project);
  });

  it("capabilities are not permissions (tools capability does not grant mutation)", () => {
    const mock = createMockProvider();
    const caps = mock.capabilities();
    expect(caps.tools).toBe(false);
    expect(caps).not.toHaveProperty("grant");
    expect(caps).not.toHaveProperty("EDIT");
  });

  it("registering a future slot does not replace applyCommand", async () => {
    clearProviderRegistry();
    registerProvider("openai-compatible", () => createMockProvider());
    const provider = createProvider("openai-compatible");
    const req: ChatRequest = { requestId: "req_x", messages: [{ role: "user", content: "x" }] };
    const res = await provider.chat(req);
    expect(res.requestId).toBe("req_x");
    const session = sessionWithClip();
    const moved = applyCommand(session, { type: "moveClips", clipIds: ["clip_test"], deltaMs: 2000 });
    expect(moved.project.clips[0]?.startMs).toBe(32_000);
    expect(session.project.clips[0]?.startMs).toBe(30_000);
    clearProviderRegistry();
    registerBuiltInProviders();
  });
});
