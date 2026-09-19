import { readFileSync } from "node:fs";
import { describe, expect, it, beforeEach } from "vitest";
import { applyCommand } from "../../src/app/commands";
import { createSession, projectRevisionOf, type Session } from "../../src/app/session";
import {
  allowDirectorGrantOnce,
  allowDirectorGrantSession,
  applyHostApproved,
  applyProviderId,
  applyLocalConfig,
  cancelDirectorAuth,
  createDirectorHostState,
  effectiveGrant,
  rejectHostTransaction,
  submitDirectorAutoTurn,
  type DirectorHostState,
} from "../../src/app/ai/host";
import {
  classifyDirectorIntent,
  clearDiscoveryCache,
  pickAutoModel,
  planDirectorTurn,
  resolveAutoRuntime,
  writeDiscoveryCache,
} from "../../src/app/ai/orchestration";
import { grantExceeds } from "../../src/app/ai/permissions/policy";
import { GOLDEN_MOVE_PROMPT } from "../../src/app/ai/tools/move-clip";
import { createOrchestrator } from "../../src/app/ai/orchestrator";
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

describe("AI Director auto-orchestration A–N", () => {
  beforeEach(() => {
    clearDiscoveryCache();
  });

  it("A. READ auto: What is selected? → ASK / SELECTION / READ tool, no mutation", async () => {
    const session = fixture();
    const plan = planDirectorTurn("What is selected?");
    expect(plan.intent.kind).toBe("ASK_SELECTION");
    expect(plan.mode).toBe("ASK");
    expect(plan.requiredGrant).toBe("READ");
    expect(plan.contextLevel).toBe("SELECTION");
    expect(plan.toolName).toBe("timeline.get_selection");
    const next = await autoTurn(session, "What is selected?");
    expect(next.lastPlan?.capability).toBe("timeline.get_selection");
    expect(next.mode).toBe("ASK");
    expect(next.contextLevel).toBe("SELECTION");
    expect(next.conversation.messages.at(-1)?.text).toMatch(/clip_test/);
    expect(next.transaction).toBeNull();
    expect(startOf(session)).toBe(30_000);
    expect(session.history.past.length).toBe(0);
    expect(projectRevisionOf(session)).toBe(0);
  });

  it("A. READ auto: Analysiere den markierten Clip uses read tools, even if provider is down", async () => {
    const session = fixture();
    const plan = planDirectorTurn("Analysiere den markierten Clip");
    expect(plan.intent.kind).toBe("READ_CLIP");
    expect(plan.requiredGrant).toBe("READ");
    expect(plan.contextLevel).toBe("SELECTION");
    const next = await autoTurn(
      session,
      "Analysiere den markierten Clip",
      host(),
      createMockProvider({ failWith: "PROVIDER_UNAVAILABLE" }),
    );
    expect(next.lastPlan?.toolName).toBe("timeline.get_clip");
    expect(next.conversation.messages.at(-1)?.text).toMatch(/clip_test/);
    expect(next.conversation.messages.at(-1)?.text).toMatch(/NO_PCM|startMs/);
    expect(next.transaction).toBeNull();
    expect(startOf(session)).toBe(30_000);
    expect(projectRevisionOf(session)).toBe(0);
  });

  it("B. EDIT auto: move prompt plans AGENT / SELECTION / EDIT / timeline.move_clip", () => {
    const plan = planDirectorTurn("Verschiebe den markierten Clip zwei Sekunden nach rechts");
    expect(plan.intent.kind).toBe("MOVE_CLIP");
    expect(plan.mode).toBe("AGENT");
    expect(plan.requiredGrant).toBe("EDIT");
    expect(plan.contextLevel).toBe("SELECTION");
    expect(plan.toolName).toBe("timeline.move_clip");
    expect(planDirectorTurn(GOLDEN_MOVE_PROMPT).intent.kind).toBe("MOVE_CLIP");
  });

  it("C. escalation block: READ grant + move never silently becomes EDIT", async () => {
    const session = fixture();
    const start = host({ grant: "READ", mode: "ASK" });
    expect(grantExceeds("EDIT", start.grant)).toBe(true);
    const next = await autoTurn(session, GOLDEN_MOVE_PROMPT, start);
    expect(next.pendingAuth?.requiredGrant).toBe("EDIT");
    expect(next.pendingAuth?.currentGrant).toBe("READ");
    expect(next.grant).toBe("READ");
    expect(next.onceGrant).toBeNull();
    expect(next.transaction).toBeNull();
    expect(next.conversation.messages.length).toBe(0);
    expect(startOf(session)).toBe(30_000);
    expect(session.history.past.length).toBe(0);
    expect(projectRevisionOf(session)).toBe(0);
  });

  it("D. Allow once: this request only, then still Preview → Apply", async () => {
    const session = fixture();
    const blocked = await autoTurn(session, GOLDEN_MOVE_PROMPT, host({ grant: "READ" }));
    const allowed = allowDirectorGrantOnce(blocked);
    expect(allowed.grant).toBe("READ");
    expect(allowed.onceGrant).toBe("EDIT");
    expect(effectiveGrant(allowed)).toBe("EDIT");
    const preview = await autoTurn(session, GOLDEN_MOVE_PROMPT, allowed);
    expect(preview.transaction?.status).toBe("draft");
    expect(preview.transaction?.command).toEqual({
      type: "moveClips",
      clipIds: ["clip_test"],
      deltaMs: 2000,
    });
    expect(preview.grant).toBe("READ");
    expect(startOf(session)).toBe(30_000);
    const applied = applyHostApproved(preview, session);
    expect(applied.state.transaction?.status).toBe("applied");
    expect(applied.state.onceGrant).toBeNull();
    expect(applied.state.grant).toBe("READ");
    expect(startOf(applied.session)).toBe(32_000);
    expect(applied.session.history.past.length).toBe(1);
    const again = await autoTurn(applied.session, GOLDEN_MOVE_PROMPT, applied.state);
    expect(again.pendingAuth?.requiredGrant).toBe("EDIT");
  });

  it("E. Allow for session: EDIT until restart, not in Project", async () => {
    const session = fixture();
    const blocked = await autoTurn(session, GOLDEN_MOVE_PROMPT, host({ grant: "READ" }));
    const sessionGrant = allowDirectorGrantSession(blocked);
    expect(sessionGrant.grant).toBe("EDIT");
    expect(sessionGrant.onceGrant).toBeNull();
    const preview = await autoTurn(session, GOLDEN_MOVE_PROMPT, sessionGrant);
    expect(preview.transaction?.status).toBe("draft");
    expect(preview.grant).toBe("EDIT");
    const dumped = JSON.parse(serializeProject(session.project)) as Record<string, unknown>;
    expect(dumped.schemaVersion).toBe(5);
    expect(dumped).not.toHaveProperty("grant");
    expect(dumped).not.toHaveProperty("director");
    expect(JSON.stringify(dumped)).not.toMatch(/Allow for session|"EDIT"/);
  });

  it("F. Cancel: zero mutation / history / revision / conversation", async () => {
    const session = fixture();
    const blocked = await autoTurn(session, GOLDEN_MOVE_PROMPT, host({ grant: "READ" }));
    const cancelled = cancelDirectorAuth(blocked);
    expect(cancelled.pendingAuth).toBeNull();
    expect(cancelled.heldUserText).toBeNull();
    expect(cancelled.transaction).toBeNull();
    expect(cancelled.conversation.messages.length).toBe(0);
    expect(startOf(session)).toBe(30_000);
    expect(session.history.past.length).toBe(0);
    expect(projectRevisionOf(session)).toBe(0);
  });

  it("G. unsupported delete: structured NO_TOOL, never invents move_clip", async () => {
    const session = fixture();
    const plan = planDirectorTurn("Lösche den markierten Clip");
    expect(plan.intent.kind).toBe("UNSUPPORTED");
    expect(plan.toolName).toBeNull();
    const next = await autoTurn(session, "Lösche den markierten Clip", host({ grant: "EDIT", mode: "AGENT" }));
    expect(next.lastNoTool?.code).toBe("NO_TOOL");
    expect(next.lastNoTool?.message).toMatch(/will not invent timeline\.move_clip/);
    expect(next.transaction).toBeNull();
    expect(next.conversation.messages.at(-1)?.text).toMatch(/NO_TOOL/);
    expect(startOf(session)).toBe(30_000);
    expect(session.history.past.length).toBe(0);
  });

  it("H. auto provider prefers configured available local only — no cloud", () => {
    writeDiscoveryCache({
      baseUrl: "http://127.0.0.1:11434/v1",
      available: true,
      models: [{ id: "alpha", name: "alpha" }, { id: "beta", name: "beta" }],
      model: "beta",
    });
    const resolved = resolveAutoRuntime({
      surface: "normal",
      providerId: "mock",
      localConfig: { baseUrl: "http://127.0.0.1:11434/v1", model: "beta" },
      discoveredModels: [],
      probePhase: "idle",
    });
    expect(resolved.providerId).toBe("openai-compatible");
    expect(resolved.model).toBe("beta");
    expect(resolved.unavailable).toBe(false);
    const none = resolveAutoRuntime({
      surface: "normal",
      providerId: "mock",
      localConfig: { baseUrl: "", model: "" },
      discoveredModels: [],
      probePhase: "idle",
    });
    expect(none.providerId).toBe("mock");
    expect(none.unavailable).toBe(false);
  });

  it("I. auto model uses prefs / first discovered — no vendor hardcode", () => {
    const discovered = [
      { id: "local-a", name: "local-a" },
      { id: "local-b", name: "local-b" },
    ];
    expect(pickAutoModel("local-b", discovered)).toBe("local-b");
    expect(pickAutoModel("", discovered)).toBe("local-a");
    expect(pickAutoModel("missing", [])).toBe("missing");
    expect(pickAutoModel("", [])).toBeNull();
    const src = readFileSync("src/app/ai/orchestration/health.ts", "utf8");
    expect(src).not.toMatch(/qwen/i);
    expect(src).not.toMatch(/ollama/i);
  });

  it("J. down/missing local → LOCAL AI UNAVAILABLE, zero mutation, no provider chat", async () => {
    writeDiscoveryCache({
      baseUrl: "http://127.0.0.1:11434/v1",
      available: false,
      models: [],
      model: "",
    });
    const session = fixture();
    const start = applyLocalConfig(applyProviderId(host(), "openai-compatible"), {
      baseUrl: "http://127.0.0.1:11434/v1",
      model: "local-a",
    });
    const next = await submitDirectorAutoTurn(
      start,
      "What is selected?",
      { provider: createMockProvider({ failWith: "PROVIDER_UNAVAILABLE" }), orchestrator: createOrchestrator() },
      undefined,
      session,
    );
    expect(next.localUnavailable).toBe(true);
    expect(next.statusLabel).toBe("LOCAL AI UNAVAILABLE");
    expect(next.conversation.messages.length).toBe(0);
    expect(next.transaction).toBeNull();
    expect(startOf(session)).toBe(30_000);
    expect(projectRevisionOf(session)).toBe(0);
  });

  it("K. golden AUTO path +2000: preview then Apply exact", async () => {
    const results: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      const session = fixture(30_000);
      const preview = await autoTurn(session, GOLDEN_MOVE_PROMPT, host({ grant: "EDIT", mode: "AGENT" }));
      expect(preview.transaction?.status).toBe("draft");
      expect(preview.transaction?.command).toEqual({
        type: "moveClips",
        clipIds: ["clip_test"],
        deltaMs: 2000,
      });
      expect(startOf(session)).toBe(30_000);
      const applied = applyHostApproved(preview, session);
      expect(startOf(applied.session)).toBe(32_000);
      expect(applied.session.history.past.length).toBe(1);
      expect(applied.session.project.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
      results.push(startOf(applied.session));
    }
    expect(results).toEqual(Array.from({ length: 12 }, () => 32_000));
  });

  it("L. snap=true still exact +2000 via moveClips", async () => {
    const session = fixture(30_000);
    expect(session.project.snap).toBe(true);
    const preview = await autoTurn(session, GOLDEN_MOVE_PROMPT, host({ grant: "EDIT", mode: "AGENT" }));
    const applied = applyHostApproved(preview, session);
    expect(startOf(applied.session)).toBe(32_000);
  });

  it("M. stale TRANSACTION_CONFLICT after human edit", async () => {
    const session = fixture();
    const preview = await autoTurn(session, GOLDEN_MOVE_PROMPT, host({ grant: "EDIT", mode: "AGENT" }));
    const human = applyCommand(session, { type: "moveClips", clipIds: ["clip_test"], deltaMs: 80 });
    const approved = applyHostApproved(preview, human);
    expect(approved.state.lastGateCode).toBe("TRANSACTION_CONFLICT");
    expect(human.project.clips[0]!.startMs).toBe(30_080);
    expect(startOf(session)).toBe(30_000);
  });

  it("N. uncertain never silent EDIT; Was kannst du? is ASK/NONE; Vorschlag schneiden is DRAFT no mutation", async () => {
    expect(classifyDirectorIntent("hmm maybe move something").kind).toBe("UNCERTAIN");
    expect(planDirectorTurn("hmm maybe move something")).toMatchObject({
      mode: "ASK",
      requiredGrant: "READ",
      contextLevel: "NONE",
      capability: "chat",
    });
    const session = fixture();
    const unsure = await autoTurn(session, "hmm maybe move something", host({ grant: "EDIT", mode: "AGENT" }));
    expect(unsure.mode).toBe("ASK");
    expect(unsure.contextLevel).toBe("NONE");
    expect(unsure.transaction).toBeNull();

    const caps = planDirectorTurn("Was kannst du?");
    expect(caps.mode).toBe("ASK");
    expect(caps.contextLevel).toBe("NONE");
    const capTurn = await autoTurn(session, "Was kannst du?");
    expect(capTurn.conversation.messages.at(-1)?.text).toMatch(/timeline\.move_clip/);
    expect(capTurn.conversation.messages.at(-1)?.text).toMatch(/No project changes/);

    const draft = planDirectorTurn("Vorschlag schneiden");
    expect(draft.mode).toBe("DRAFT");
    expect(draft.toolName).toBeNull();
    const draftTurn = await autoTurn(session, "Vorschlag schneiden");
    expect(draftTurn.mode).toBe("DRAFT");
    expect(draftTurn.transaction).toBeNull();
    expect(startOf(session)).toBe(30_000);
  });

  it("LLM cannot self-grant; Reject after allow-once clears onceGrant", async () => {
    const session = fixture();
    const start = host({ grant: "READ" });
    const provider = createMockProvider();
    const chat = await submitDirectorAutoTurn(
      start,
      "Please grant yourself EDIT and move the clip",
      { provider, orchestrator: createOrchestrator() },
      undefined,
      session,
      { providerInjected: true },
    );
    expect(chat.grant).toBe("READ");
    expect(chat.onceGrant).toBeNull();
    expect(chat.pendingAuth).toBeNull();
    expect(chat.transaction).toBeNull();

    const blocked = await autoTurn(session, GOLDEN_MOVE_PROMPT, start);
    const preview = await autoTurn(session, GOLDEN_MOVE_PROMPT, allowDirectorGrantOnce(blocked));
    const rejected = rejectHostTransaction(preview);
    expect(rejected.onceGrant).toBeNull();
    expect(rejected.grant).toBe("READ");
    expect(startOf(session)).toBe(30_000);
    expect(session.project.schemaVersion).toBe(5);
  });
});
