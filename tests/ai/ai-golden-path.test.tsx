import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyCommand } from "../../src/app/commands";
import { createSession, projectRevisionOf, type Session } from "../../src/app/session";
import {
  applyHostApproved,
  applyProviderId,
  createDirectorHostState,
  hydrateDirectorHostFromPrefs,
  persistDirectorHostPrefs,
  rejectHostTransaction,
  submitDirectorProviderTurn,
  type DirectorHostState,
} from "../../src/app/ai/host";
import { parseDirectorResponse } from "../../src/app/ai/contract";
import { GOLDEN_MOVE_PROMPT } from "../../src/app/ai/tools/move-clip";
import { clearAudit, listAudit } from "../../src/app/ai/transactions/audit";
import { createMockProvider } from "../../src/app/ai/providers/mock";
import { createOpenAICompatibleProvider } from "../../src/app/ai/providers/openai-compatible";
import { AI_PREFS_KEY, loadAiPrefs } from "../../src/app/ai/providers/prefs";
import { createOrchestrator } from "../../src/app/ai/orchestrator";
import { PROJECT_SCHEMA_VERSION, serializeProject } from "../../src/core/project";
import { createMemoryBlobStore } from "../../src/core/persistence";
import { DirectorPanel } from "../../src/ui/director/DirectorPanel";
import { asset, clip, projectWith } from "../helpers";

function fixture(startMs = 30_000, locked = false): Session {
  const a = asset({ id: "asset_aa", kind: "audio", durationMs: 8000 });
  const c = clip({
    id: "clip_test",
    assetId: "asset_aa",
    trackId: "A1",
    startMs,
    durationMs: 2000,
    locked,
  });
  return {
    ...createSession(createMemoryBlobStore()),
    project: { ...projectWith([c], [a]), snap: true, playheadMs: 31_950 },
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
    ...patch,
  };
}

function startOf(session: Session): number {
  return session.project.clips[0]!.startMs;
}

async function submitGolden(
  session: Session,
  host = goldenHost(),
  provider = createMockProvider(),
) {
  return submitDirectorProviderTurn(
    host,
    GOLDEN_MOVE_PROMPT,
    { provider, orchestrator: createOrchestrator() },
    undefined,
    session,
  );
}

describe("AI Director golden path", () => {
  beforeEach(() => {
    clearAudit();
    localStorage.removeItem(AI_PREFS_KEY);
  });

  it("structured contract: free-form never mutates; malformed / unknown fail closed", () => {
    expect(parseDirectorResponse("hello")).toEqual({ ok: true, message: "hello" });
    expect(parseDirectorResponse('{"message":"ok"}')).toEqual({ ok: true, message: "ok" });
    const golden = parseDirectorResponse(
      JSON.stringify({
        message: "preview",
        toolRequest: { name: "timeline.move_clip", arguments: { deltaMs: 2000 } },
      }),
    );
    expect(golden).toMatchObject({
      ok: true,
      toolRequest: { name: "timeline.move_clip", arguments: { deltaMs: 2000 } },
    });
    expect(parseDirectorResponse("{not-json").ok).toBe(false);
    expect(
      parseDirectorResponse(
        JSON.stringify({ message: "x", toolRequest: { name: "timeline.explode", arguments: {} } }),
      ),
    ).toMatchObject({ ok: true, toolRequest: { name: "timeline.explode" } });
    expect(parseDirectorResponse(JSON.stringify({ message: 1 })).ok).toBe(false);
    expect(parseDirectorResponse(JSON.stringify({ message: "x", toolRequest: "move" })).ok).toBe(false);
  });

  it("Mock golden 12/12: NL → structured move_clip → PREVIEW → Apply exact +2000", async () => {
    const results: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      const session = fixture(30_000);
      const preview = await submitGolden(session);
      expect(preview.transaction?.status).toBe("draft");
      expect(preview.transaction?.toolName).toBe("timeline.move_clip");
      expect(preview.transaction?.command).toEqual({
        type: "moveClips",
        clipIds: ["clip_test"],
        deltaMs: 2000,
      });
      expect(startOf(session)).toBe(30_000);
      expect(session.history.past.length).toBe(0);
      expect(projectRevisionOf(session)).toBe(0);
      const applied = applyHostApproved(preview, session);
      expect(applied.state.transaction?.status).toBe("applied");
      expect(startOf(applied.session)).toBe(32_000);
      expect(applied.session.history.past.length).toBe(1);
      expect(projectRevisionOf(applied.session)).toBe(1);
      expect(applied.session.project.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
      results.push(startOf(applied.session));
    }
    expect(results).toEqual(Array.from({ length: 12 }, () => 32_000));
  });

  it("Reject 12/12: no move, no history, no revision bump, audit rejection", async () => {
    for (let i = 0; i < 12; i += 1) {
      clearAudit();
      const session = fixture(30_000);
      const preview = await submitGolden(session);
      expect(preview.transaction?.status).toBe("draft");
      const rejected = rejectHostTransaction(preview);
      expect(rejected.transaction?.status).toBe("rejected");
      expect(startOf(session)).toBe(30_000);
      expect(session.history.past.length).toBe(0);
      expect(projectRevisionOf(session)).toBe(0);
      expect(listAudit().some((e) => e.action === "reject" && e.result === "ok")).toBe(true);
    }
  });

  it("Hostile snap 12/12: Project.snap=true still exact +2000 via moveClips", async () => {
    for (let i = 0; i < 12; i += 1) {
      const session = fixture(30_000);
      expect(session.project.snap).toBe(true);
      const preview = await submitGolden(session);
      const applied = applyHostApproved(preview, session);
      expect(applied.state.transaction?.command).toEqual({
        type: "moveClips",
        clipIds: ["clip_test"],
        deltaMs: 2000,
      });
      expect(startOf(applied.session)).toBe(32_000);
    }
  });

  it("Stale txn 12/12: human move then Apply → TRANSACTION_CONFLICT, manual edit intact", async () => {
    for (let i = 0; i < 12; i += 1) {
      const session = fixture(30_000);
      const preview = await submitGolden(session);
      const human = applyCommand(session, { type: "moveClips", clipIds: ["clip_test"], deltaMs: 80 });
      expect(startOf(human)).toBe(30_080);
      const approved = applyHostApproved(preview, human);
      expect(approved.session).toBe(human);
      expect(startOf(approved.session)).toBe(30_080);
      expect(approved.state.statusLabel).toMatch(/TRANSACTION_CONFLICT/);
      expect(human.history.past.length).toBe(1);
    }
  });

  it("Provider failure 12/12: unavailable mock never drafts or applies", async () => {
    for (let i = 0; i < 12; i += 1) {
      const session = fixture(30_000);
      const next = await submitGolden(
        session,
        goldenHost(),
        createMockProvider({ failWith: "PROVIDER_UNAVAILABLE" }),
      );
      expect(next.status).toBe("error");
      expect(next.transaction).toBeNull();
      expect(startOf(session)).toBe(30_000);
      expect(session.history.past.length).toBe(0);
      expect(projectRevisionOf(session)).toBe(0);
    }
  });

  it("Undo/Redo after Apply restore exact original then +2000", async () => {
    const session = fixture(30_000);
    const preview = await submitGolden(session);
    const applied = applyHostApproved(preview, session);
    expect(startOf(applied.session)).toBe(32_000);
    const undone = applyCommand(applied.session, { type: "undo" });
    expect(startOf(undone)).toBe(30_000);
    const redone = applyCommand(undone, { type: "redo" });
    expect(startOf(redone)).toBe(32_000);
  });

  it("permission matrix: ASK/READ/NONE context deny with conversation, no mutation", async () => {
    const session = fixture();
    const ask = await submitGolden(session, goldenHost({ mode: "ASK", modeLabel: "Mode: ASK" }));
    expect(ask.transaction).toBeNull();
    expect(ask.conversation.messages.at(-1)?.text).toMatch(/Denied: Mode ASK/);
    expect(startOf(session)).toBe(30_000);

    const read = await submitGolden(session, goldenHost({ grant: "READ" }));
    expect(read.transaction).toBeNull();
    expect(read.conversation.messages.at(-1)?.text).toMatch(/Grant READ/);

    const noneHost = goldenHost({ contextLevel: "NONE", contextLabel: "Context: NONE" });
    const viaCanonical = await submitGolden(session, noneHost);
    expect(viaCanonical.transaction?.status).toBe("draft");
    expect(viaCanonical.transaction?.command).toEqual({
      type: "moveClips",
      clipIds: ["clip_test"],
      deltaMs: 2000,
    });
    expect(startOf(session)).toBe(30_000);

    const empty = { ...session, selectedClipId: null, selectedClipIds: [] };
    const none = await submitGolden(empty, noneHost);
    expect(none.transaction).toBeNull();
    expect(none.conversation.messages.at(-1)?.text).toMatch(/SELECTION REQUIRED|No clip selected/);
    expect(startOf(session)).toBe(30_000);
    expect(session.history.past.length).toBe(0);
  });

  it("prefs hydrate/save URL+model, never apiKey, and changing provider does not mutate Project", () => {
    const session = fixture();
    const beforeClips = structuredClone(session.project.clips);
    const host = applyProviderId(createDirectorHostState(), "openai-compatible");
    const configured = {
      ...host,
      localConfig: { baseUrl: "http://127.0.0.1:11434/v1", model: "local-model", apiKey: "sk-secret" },
    };
    persistDirectorHostPrefs(configured, localStorage);
    const loaded = loadAiPrefs(localStorage);
    expect(loaded.providerId).toBe("openai-compatible");
    expect(loaded.baseUrl).toBe("http://127.0.0.1:11434/v1");
    expect(loaded.model).toBe("local-model");
    expect(JSON.stringify(loaded)).not.toMatch(/apiKey|sk-secret/);
    const hydrated = hydrateDirectorHostFromPrefs(localStorage);
    expect(hydrated.providerId).toBe("openai-compatible");
    expect(hydrated.localConfig).not.toHaveProperty("apiKey");
    expect(session.project.clips).toEqual(beforeClips);
    expect(startOf(session)).toBe(30_000);
    const dumped = JSON.parse(serializeProject(session.project)) as Record<string, unknown>;
    expect(dumped.schemaVersion).toBe(5);
    expect(dumped).not.toHaveProperty("ai");
    expect(JSON.stringify(dumped)).not.toMatch(/apiKey|sk-secret|openai-compatible/);
  });

  it("opening / switching provider does not start a provider request", async () => {
    let fetches = 0;
    const original = globalThis.fetch;
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      fetches += 1;
      return original(input, init);
    }) as typeof fetch;
    try {
      persistDirectorHostPrefs(
        {
          ...applyProviderId(createDirectorHostState(), "openai-compatible"),
          localConfig: { baseUrl: "http://127.0.0.1:11434/v1", model: "m" },
        },
        localStorage,
      );
      hydrateDirectorHostFromPrefs(localStorage);
      applyProviderId(createDirectorHostState(), "openai-compatible");
      applyProviderId(createDirectorHostState(), "mock");
      expect(fetches).toBe(0);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("AI Director golden path UI", () => {
  let host: HTMLDivElement | undefined;
  let root: Root | undefined;
  let session: Session;
  let committed: Session | undefined;

  beforeEach(() => {
    localStorage.removeItem(AI_PREFS_KEY);
    session = fixture();
    committed = undefined;
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    host?.remove();
    host = undefined;
    root = undefined;
  });

  async function mount() {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(
        <DirectorPanel
          initialState={goldenHost()}
          session={session}
          onCanonicalCommit={(next) => {
            committed = next;
          }}
        />,
      );
    });
  }

  async function send(text: string) {
    const input = host!.querySelector('[data-testid="director-input"]') as HTMLTextAreaElement;
    await act(async () => {
      const native = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value");
      native?.set?.call(input, text);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      (host!.querySelector('[data-testid="director-send"]') as HTMLButtonElement).click();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it("shows PREVIEW with tool/target/+2000ms and does not move until Apply", async () => {
    await mount();
    expect(host!.querySelector('[data-testid="director-provider"]')?.getAttribute("data-provider-offline")).toBe(
      "true",
    );
    await send(GOLDEN_MOVE_PROMPT);
    expect(host!.querySelector('[data-testid="director-txn-phase"]')?.textContent).toBe("PREVIEW");
    expect(host!.querySelector('[data-testid="director-txn-tool"]')?.textContent).toMatch(/timeline\.move_clip/);
    expect(host!.querySelector('[data-testid="director-txn-target"]')?.textContent).toMatch(/clip_test/);
    expect(host!.querySelector('[data-testid="director-txn-delta"]')?.textContent).toMatch(/\+2000ms/);
    expect(startOf(session)).toBe(30_000);
    expect(committed).toBeUndefined();
    await act(async () => {
      (host!.querySelector('[data-testid="director-txn-apply"]') as HTMLButtonElement).click();
    });
    expect(committed).toBeTruthy();
    expect(startOf(committed!)).toBe(32_000);
  });

  it("Reject leaves the clip unmoved", async () => {
    await mount();
    await send(GOLDEN_MOVE_PROMPT);
    await act(async () => {
      (host!.querySelector('[data-testid="director-txn-reject"]') as HTMLButtonElement).click();
    });
    expect(startOf(session)).toBe(30_000);
    expect(committed).toBeUndefined();
    expect(host!.querySelector('[data-testid="director-txn-phase"]')?.textContent).toBe("REJECTED");
  });

  it("free-form mock chat does not create a transaction", async () => {
    await mount();
    await send("Hello Director");
    expect(host!.querySelector('[data-testid="director-txn"]')).toBeNull();
    expect(host!.textContent).toMatch(/Director \(mock\)/);
    expect(startOf(session)).toBe(30_000);
  });
});

describe("local OpenAI-compatible structured path", () => {
  it("parses a structured local reply into a preview without applying", async () => {
    const session = fixture();
    const provider = createOpenAICompatibleProvider({
      baseUrl: "http://127.0.0.1:11434/v1",
      model: "local-model",
      fetchImpl: (async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  role: "assistant",
                  content: JSON.stringify({
                    message: "Ready to move.",
                    toolRequest: { name: "timeline.move_clip", arguments: { deltaMs: 2000 } },
                  }),
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        )) as typeof fetch,
    });
    const next = await submitDirectorProviderTurn(
      { ...goldenHost(), providerId: "openai-compatible" },
      GOLDEN_MOVE_PROMPT,
      { provider, orchestrator: createOrchestrator() },
      undefined,
      session,
    );
    expect(next.transaction?.status).toBe("draft");
    expect(startOf(session)).toBe(30_000);
    expect(next.conversation.messages.at(-1)?.text).toBe("Ready to move.");
  });

  it("free-form local prose does not draft", async () => {
    const session = fixture();
    const provider = createOpenAICompatibleProvider({
      baseUrl: "http://127.0.0.1:11434/v1",
      model: "local-model",
      fetchImpl: (async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { role: "assistant", content: "I will move the clip for you." } }],
          }),
          { status: 200 },
        )) as typeof fetch,
    });
    const next = await submitDirectorProviderTurn(
      { ...goldenHost(), providerId: "openai-compatible" },
      GOLDEN_MOVE_PROMPT,
      { provider, orchestrator: createOrchestrator() },
      undefined,
      session,
    );
    expect(next.transaction).toBeNull();
    expect(startOf(session)).toBe(30_000);
  });
});
