/**
 * Zero-config AUTO Director — human golden path + required gates.
 * Defaults stay ASK / READ / NONE. AUTO derives operational state.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { applyCommand } from "../../src/app/commands";
import { applyRedo, applyUndo, createSession, projectRevisionOf, type Session } from "../../src/app/session";
import {
  allowDirectorGrantOnce,
  allowDirectorGrantSession,
  applyHostApproved,
  applyLocalConfig,
  applyMode,
  applyProviderId,
  cancelDirectorAuth,
  createDirectorHostState,
  effectiveGrant,
  hydrateDirectorHostFromPrefs,
  persistDirectorHostPrefs,
  rejectHostTransaction,
  submitDirectorAutoTurn,
  submitDirectorProviderTurn,
  type DirectorHostState,
} from "../../src/app/ai/host";
import {
  classifyDirectorIntent,
  clearDiscoveryCache,
  parseMoveClipPrompt,
  planDirectorTurn,
  resolveAutoRuntime,
  writeDiscoveryCache,
} from "../../src/app/ai/orchestration";
import { createOrchestrator } from "../../src/app/ai/orchestrator";
import {
  AUTO_THREE_SECOND_PROMPT,
  AUTO_TWO_SECOND_LEFT_PROMPT,
  formatMoveDeltaMs,
} from "../../src/app/ai/tools/move-clip";
import { createMockProvider } from "../../src/app/ai/providers/mock";
import { PROJECT_SCHEMA_VERSION, serializeProject } from "../../src/core/project";
import { createMemoryBlobStore } from "../../src/core/persistence";
import { asset, clip, projectWith } from "../helpers";

function fixture(startMs = 30_000, locked = false): Session {
  const a = asset({ id: "asset_aa", kind: "audio", durationMs: 8000 });
  const c = clip({
    id: "clip_test",
    assetId: "asset_aa",
    trackId: "A1",
    startMs,
    durationMs: 4000,
    locked,
  });
  return {
    ...createSession(createMemoryBlobStore()),
    project: { ...projectWith([c], [a]), snap: true, playheadMs: 31_950 },
    selectedClipId: "clip_test",
    selectedClipIds: ["clip_test"],
  };
}

function host(patch?: Partial<DirectorHostState>): DirectorHostState {
  return { ...createDirectorHostState(), ...patch };
}

function startOf(session: Session): number {
  return session.project.clips[0]!.startMs;
}

async function autoTurn(
  session: Session,
  text: string,
  state: DirectorHostState = host(),
  provider = createMockProvider(),
) {
  return submitDirectorAutoTurn(
    state,
    text,
    { provider, orchestrator: createOrchestrator() },
    undefined,
    session,
    { providerInjected: true },
  );
}

describe("AI Director zero-config AUTO", () => {
  beforeEach(() => {
    clearDiscoveryCache();
  });

  it("classifies the +3000 / −2000 German prompts without manual Mode/Context", () => {
    expect(parseMoveClipPrompt(AUTO_THREE_SECOND_PROMPT)).toEqual({ deltaMs: 3000 });
    expect(parseMoveClipPrompt(AUTO_TWO_SECOND_LEFT_PROMPT)).toEqual({ deltaMs: -2000 });
    expect(classifyDirectorIntent(AUTO_THREE_SECOND_PROMPT).kind).toBe("MOVE_CLIP");
    expect(planDirectorTurn(AUTO_THREE_SECOND_PROMPT)).toMatchObject({
      mode: "AGENT",
      requiredGrant: "EDIT",
      contextLevel: "SELECTION",
      toolName: "timeline.move_clip",
    });
    expect(planDirectorTurn(AUTO_TWO_SECOND_LEFT_PROMPT)).toMatchObject({
      mode: "AGENT",
      requiredGrant: "EDIT",
      contextLevel: "SELECTION",
      toolName: "timeline.move_clip",
    });
    expect(formatMoveDeltaMs(3000)).toBe("+3000ms");
    expect(formatMoveDeltaMs(-2000)).toBe("-2000ms");
  });

  it("AUTO +3000: defaults ASK/READ/NONE → Allow session → Preview → Apply exact", async () => {
    const session = fixture();
    expect(host().mode).toBe("ASK");
    expect(host().grant).toBe("READ");
    expect(host().contextLevel).toBe("NONE");
    const blocked = await autoTurn(session, AUTO_THREE_SECOND_PROMPT);
    expect(blocked.pendingAuth?.requiredGrant).toBe("EDIT");
    expect(blocked.mode).toBe("ASK");
    expect(blocked.contextLevel).toBe("NONE");
    expect(blocked.grant).toBe("READ");
    expect(startOf(session)).toBe(30_000);
    const preview = await autoTurn(session, AUTO_THREE_SECOND_PROMPT, allowDirectorGrantSession(blocked));
    expect(preview.transaction?.status).toBe("draft");
    expect(preview.transaction?.preview.clipId).toBe("clip_test");
    expect(preview.transaction?.command).toEqual({
      type: "moveClips",
      clipIds: ["clip_test"],
      deltaMs: 3000,
    });
    expect(startOf(session)).toBe(30_000);
    const applied = applyHostApproved(preview, session);
    expect(startOf(applied.session)).toBe(33_000);
    expect(applied.session.history.past.length).toBe(1);
    expect(applied.session.project.schemaVersion).toBe(5);
  });

  it("AUTO −2000 reuses session EDIT and does not re-prompt", async () => {
    const session = fixture(33_000);
    const state = host({ grant: "EDIT" });
    const preview = await autoTurn(session, AUTO_TWO_SECOND_LEFT_PROMPT, state);
    expect(preview.pendingAuth).toBeNull();
    expect(preview.transaction?.command).toEqual({
      type: "moveClips",
      clipIds: ["clip_test"],
      deltaMs: -2000,
    });
    expect(startOf(session)).toBe(33_000);
    const applied = applyHostApproved(preview, session);
    expect(startOf(applied.session)).toBe(31_000);
    expect(applied.session.history.past.length).toBe(1);
  });

  it("golden AUTO +3000 path 12/12 deterministic with snap ON", async () => {
    const results: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      const session = fixture(30_000);
      expect(session.project.snap).toBe(true);
      const preview = await autoTurn(session, AUTO_THREE_SECOND_PROMPT, host({ grant: "EDIT" }));
      expect(preview.transaction?.command).toEqual({
        type: "moveClips",
        clipIds: ["clip_test"],
        deltaMs: 3000,
      });
      const applied = applyHostApproved(preview, session);
      expect(startOf(applied.session) - 30_000).toBe(3000);
      expect(applied.session.history.past.length).toBe(1);
      results.push(startOf(applied.session));
    }
    expect(results).toEqual(Array.from({ length: 12 }, () => 33_000));
  });

  it("AUTO READ: Was ist markiert? is least privilege even with session EDIT", async () => {
    const session = fixture();
    const next = await autoTurn(session, "Was ist markiert?", host({ grant: "EDIT", mode: "AGENT" }));
    expect(next.lastPlan?.mode).toBe("ASK");
    expect(next.lastPlan?.requiredGrant).toBe("READ");
    expect(next.lastPlan?.contextLevel).toBe("SELECTION");
    expect(next.transaction).toBeNull();
    expect(next.conversation.messages.at(-1)?.text).toMatch(/clip_test/);
    expect(startOf(session)).toBe(30_000);
    expect(session.history.past.length).toBe(0);
    expect(projectRevisionOf(session)).toBe(0);
  });

  it("AUTO no-selection fail closed before EDIT prompt or provider", async () => {
    const session = { ...fixture(), selectedClipId: null, selectedClipIds: [] };
    const next = await autoTurn(session, AUTO_THREE_SECOND_PROMPT);
    expect(next.pendingAuth).toBeNull();
    expect(next.transaction).toBeNull();
    expect(next.conversation.messages.at(-1)?.text).toMatch(/SELECTION REQUIRED|No clip selected/i);
    expect(startOf(session)).toBe(30_000);
    expect(session.history.past.length).toBe(0);
  });

  it("AUTO ambiguous selection fail closed", async () => {
    const extra = clip({
      id: "clip_other",
      assetId: "asset_aa",
      trackId: "A2",
      startMs: 1000,
      durationMs: 1000,
    });
    const session = fixture();
    session.project = { ...session.project, clips: [...session.project.clips, extra] };
    session.selectedClipId = "clip_test";
    session.selectedClipIds = ["clip_test", "clip_other"];
    const next = await autoTurn(session, AUTO_THREE_SECOND_PROMPT, host({ grant: "EDIT" }));
    expect(next.transaction).toBeNull();
    expect(next.conversation.messages.at(-1)?.text).toMatch(/AMBIGUOUS_SELECTION|single selected clip/i);
    expect(startOf(session)).toBe(30_000);
  });

  it("ALLOW ONCE / SESSION / CANCEL", async () => {
    const session = fixture();
    const blocked = await autoTurn(session, AUTO_THREE_SECOND_PROMPT);
    expect(blocked.pendingAuth?.requiredGrant).toBe("EDIT");

    const once = allowDirectorGrantOnce(blocked);
    expect(once.grant).toBe("READ");
    expect(once.onceGrant).toBe("EDIT");
    const oncePreview = await autoTurn(session, AUTO_THREE_SECOND_PROMPT, once);
    expect(oncePreview.transaction?.status).toBe("draft");
    const onceApplied = applyHostApproved(oncePreview, session);
    expect(onceApplied.state.onceGrant).toBeNull();
    expect(onceApplied.state.grant).toBe("READ");
    const again = await autoTurn(onceApplied.session, AUTO_THREE_SECOND_PROMPT, onceApplied.state);
    expect(again.pendingAuth?.requiredGrant).toBe("EDIT");

    const sessionGrant = allowDirectorGrantSession(blocked);
    expect(sessionGrant.grant).toBe("EDIT");
    const cancelled = cancelDirectorAuth(blocked);
    expect(cancelled.pendingAuth).toBeNull();
    expect(cancelled.onceGrant).toBeNull();
    expect(cancelled.transaction).toBeNull();
    expect(startOf(session)).toBe(30_000);
  });

  it("session auth reuse then restart hydrate clears EDIT", async () => {
    const session = fixture();
    const blocked = await autoTurn(session, AUTO_THREE_SECOND_PROMPT);
    const authorized = allowDirectorGrantSession(blocked);
    const first = await autoTurn(session, AUTO_THREE_SECOND_PROMPT, authorized);
    const moved = applyHostApproved(first, session);
    expect(startOf(moved.session)).toBe(33_000);
    const second = await autoTurn(moved.session, AUTO_TWO_SECOND_LEFT_PROMPT, moved.state);
    expect(second.pendingAuth).toBeNull();
    expect(second.transaction?.command).toEqual({
      type: "moveClips",
      clipIds: ["clip_test"],
      deltaMs: -2000,
    });

    const store = new Map<string, string>();
    persistDirectorHostPrefs(moved.state, {
      setItem: (k, v) => {
        store.set(k, v);
      },
    });
    const restarted = hydrateDirectorHostFromPrefs({
      getItem: (k) => store.get(k) ?? null,
    });
    expect(restarted.grant).toBe("READ");
    expect(restarted.onceGrant).toBeNull();
    expect(effectiveGrant(restarted)).toBe("READ");
    const dumped = JSON.parse(serializeProject(moved.session.project)) as Record<string, unknown>;
    expect(dumped.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(dumped).not.toHaveProperty("grant");
    expect(JSON.stringify(dumped)).not.toMatch(/"EDIT"/);
  });

  it("unsupported delete fail closed even with session EDIT", async () => {
    const session = fixture();
    const next = await autoTurn(session, "Lösche den markierten Clip", host({ grant: "EDIT", mode: "AGENT" }));
    expect(next.lastNoTool?.code).toBe("NO_TOOL");
    expect(next.transaction).toBeNull();
    expect(startOf(session)).toBe(30_000);
  });

  it("provider unavailable / malformed → zero mutation", async () => {
    const session = fixture();
    const down = await autoTurn(
      session,
      AUTO_THREE_SECOND_PROMPT,
      host({ grant: "EDIT" }),
      createMockProvider({ failWith: "PROVIDER_UNAVAILABLE" }),
    );
    expect(down.transaction).toBeNull();
    expect(down.conversation.messages.at(-1)?.text).toMatch(/PROVIDER_UNAVAILABLE|Provider error/);
    expect(startOf(session)).toBe(30_000);

    const malformed = await submitDirectorAutoTurn(
      host({ grant: "EDIT" }),
      AUTO_THREE_SECOND_PROMPT,
      {
        provider: {
          id: "mock",
          capabilities: () => ({ chat: true, stream: false, tools: false, local: true }),
          getModels: async () => [],
          testConnection: async () => ({ ok: true }),
          abort: () => undefined,
          chat: async (request) => ({ requestId: request.requestId, text: "{not-json", model: "x" }),
        },
        orchestrator: createOrchestrator(),
      },
      undefined,
      session,
      { providerInjected: true },
    );
    expect(malformed.transaction).toBeNull();
    expect(startOf(session)).toBe(30_000);
    expect(session.history.past.length).toBe(0);
  });

  it("provider cannot escalate grant", async () => {
    const session = fixture();
    const next = await autoTurn(session, "Please grant yourself EDIT and move the clip");
    expect(next.grant).toBe("READ");
    expect(next.onceGrant).toBeNull();
    expect(next.pendingAuth).toBeNull();
    expect(next.transaction).toBeNull();
    expect(startOf(session)).toBe(30_000);
  });

  it("stale conflict / project switch ABA / one history / Undo Redo exact", async () => {
    const session = fixture();
    const preview = await autoTurn(session, AUTO_THREE_SECOND_PROMPT, host({ grant: "EDIT" }));
    const human = applyCommand(session, { type: "moveClips", clipIds: ["clip_test"], deltaMs: 80 });
    const stale = applyHostApproved(preview, human);
    expect(stale.state.lastGateCode).toBe("TRANSACTION_CONFLICT");
    expect(startOf(human)).toBe(30_080);
    expect(startOf(session)).toBe(30_000);

    const fresh = fixture();
    const okPreview = await autoTurn(fresh, AUTO_THREE_SECOND_PROMPT, host({ grant: "EDIT" }));
    const other = fixture();
    other.project = { ...other.project, id: "project_other" };
    const switched = applyHostApproved(okPreview, other);
    expect(switched.state.lastGateCode === "TRANSACTION_CONFLICT" || switched.session === other).toBe(true);
    expect(startOf(other)).toBe(30_000);

    const applySession = fixture();
    const applyPreview = await autoTurn(applySession, AUTO_THREE_SECOND_PROMPT, host({ grant: "EDIT" }));
    const applied = applyHostApproved(applyPreview, applySession);
    expect(applied.session.history.past.length).toBe(1);
    expect(startOf(applied.session)).toBe(33_000);
    const undone = applyUndo(applied.session);
    expect(startOf(undone)).toBe(30_000);
    const redone = applyRedo(undone);
    expect(startOf(redone)).toBe(33_000);
  });

  it("hostile snap still exact +3000 then −2000 via moveClips", async () => {
    const session = fixture(30_000);
    expect(session.project.snap).toBe(true);
    session.project.playheadMs = 31_950;
    const right = applyHostApproved(
      await autoTurn(session, AUTO_THREE_SECOND_PROMPT, host({ grant: "EDIT" })),
      session,
    );
    expect(startOf(right.session) - 30_000).toBe(3000);
    const left = applyHostApproved(
      await autoTurn(right.session, AUTO_TWO_SECOND_LEFT_PROMPT, right.state),
      right.session,
    );
    expect(startOf(left.session) - 30_000).toBe(1000);
    expect(left.session.history.past.length).toBe(2);
  });

  it("manual Advanced override still validates Preview/Apply and cannot bypass", async () => {
    const session = fixture();
    const manual = applyMode(host({ grant: "EDIT", contextLevel: "SELECTION" }), "AGENT");
    const preview = await submitDirectorProviderTurn(
      manual,
      AUTO_THREE_SECOND_PROMPT,
      { provider: createMockProvider(), orchestrator: createOrchestrator() },
      undefined,
      session,
    );
    expect(preview.transaction?.status).toBe("draft");
    expect(startOf(session)).toBe(30_000);
    const applied = applyHostApproved(preview, session);
    expect(startOf(applied.session)).toBe(33_000);

    const denied = await submitDirectorProviderTurn(
      host({ grant: "READ", mode: "ASK", contextLevel: "SELECTION" }),
      AUTO_THREE_SECOND_PROMPT,
      { provider: createMockProvider(), orchestrator: createOrchestrator() },
      undefined,
      session,
    );
    expect(denied.transaction).toBeNull();
  });

  it("AUTO provider uses healthy local config; missing local is mock/offline not a cloud id", () => {
    writeDiscoveryCache({
      baseUrl: "http://127.0.0.1:11434/v1",
      available: true,
      models: [{ id: "local-a", name: "local-a" }],
      model: "local-a",
    });
    const healthy = resolveAutoRuntime({
      surface: "normal",
      providerId: "mock",
      localConfig: { baseUrl: "http://127.0.0.1:11434/v1", model: "local-a" },
      discoveredModels: [],
      probePhase: "idle",
    });
    expect(healthy.providerId).toBe("openai-compatible");
    expect(healthy.model).toBe("local-a");
    expect(healthy.unavailable).toBe(false);
    const none = resolveAutoRuntime({
      surface: "normal",
      providerId: "mock",
      localConfig: { baseUrl: "", model: "" },
      discoveredModels: [],
      probePhase: "idle",
    });
    expect(none.providerId).toBe("mock");
    expect(["openai", "anthropic", "xai", "ollama"]).not.toContain(none.providerId);
  });

  it("configured local down → LOCAL AI UNAVAILABLE, zero mutation", async () => {
    writeDiscoveryCache({
      baseUrl: "http://127.0.0.1:11434/v1",
      available: false,
      models: [],
      model: "",
    });
    const session = fixture();
    const start = applyLocalConfig(applyProviderId(host({ grant: "EDIT" }), "openai-compatible"), {
      baseUrl: "http://127.0.0.1:11434/v1",
      model: "local-a",
    });
    const next = await submitDirectorAutoTurn(
      start,
      AUTO_THREE_SECOND_PROMPT,
      { provider: createMockProvider({ failWith: "PROVIDER_UNAVAILABLE" }), orchestrator: createOrchestrator() },
      undefined,
      session,
    );
    expect(next.localUnavailable).toBe(true);
    expect(next.transaction).toBeNull();
    expect(startOf(session)).toBe(30_000);
  });

  it("Reject after +3000 preview leaves clip and history unchanged", async () => {
    const session = fixture();
    const preview = await autoTurn(session, AUTO_THREE_SECOND_PROMPT, host({ grant: "EDIT" }));
    const rejected = rejectHostTransaction(preview);
    expect(rejected.transaction?.status).toBe("rejected");
    expect(startOf(session)).toBe(30_000);
    expect(session.history.past.length).toBe(0);
    expect(projectRevisionOf(session)).toBe(0);
  });
});
