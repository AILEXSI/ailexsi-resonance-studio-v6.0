/**
 * AUTO request-scoped routing — mission tests 1–16 + 12/12 golden.
 * Manual ASK / READ / NONE stay diagnostics. Tool metadata is source of truth.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { applyCommand } from "../../src/app/commands";
import { applyRedo, applyUndo, createSession, projectRevisionOf, type Session } from "../../src/app/session";
import {
  allowDirectorGrantSession,
  applyHostApproved,
  applyLocalConfig,
  applyProviderId,
  autoPlanStatusLabel,
  createDirectorHostState,
  rejectHostTransaction,
  submitDirectorAutoTurn,
  type DirectorHostState,
} from "../../src/app/ai/host";
import {
  classifyDirectorIntent,
  parseMoveClipPrompt,
  planDirectorTurn,
  toolRequirementOf,
  MOVE_CLIP_REQUIREMENT,
} from "../../src/app/ai/orchestration";
import { createOrchestrator } from "../../src/app/ai/orchestrator";
import {
  AUTO_DURATION_PROMPT,
  AUTO_ENGLISH_SELECTED_PROMPT,
  AUTO_ENGLISH_VIDEO_PROMPT,
  AUTO_GERMAN_SCHIEB_PROMPT,
  AUTO_GERMAN_VIDEO_PROMPT,
  AUTO_HELLO_PROMPT,
  AUTO_THREE_SECOND_PROMPT,
  AUTO_TRACKS_PROMPT,
  AUTO_TWO_SECOND_LEFT_PROMPT,
} from "../../src/app/ai/tools/move-clip";
import { createMockProvider } from "../../src/app/ai/providers/mock";
import { PROJECT_SCHEMA_VERSION, serializeProject } from "../../src/core/project";
import { createMemoryBlobStore } from "../../src/core/persistence";
import { asset, clip, projectWith } from "../helpers";

function fixture(startMs = 30_000): Session {
  const a = asset({ id: "asset_aa", kind: "video", durationMs: 8000 });
  const c = clip({
    id: "clip_test",
    assetId: "asset_aa",
    trackId: "A1",
    startMs,
    durationMs: 4000,
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

describe("AI Director AUTO request routing 1–16", () => {
  beforeEach(() => {
    expect(createDirectorHostState().mode).toBe("ASK");
    expect(createDirectorHostState().grant).toBe("READ");
    expect(createDirectorHostState().contextLevel).toBe("NONE");
    expect(createDirectorHostState().runtimeMode).toBe("AUTO");
  });

  it("tool requirement metadata is the MOVE_CLIP source of truth", () => {
    expect(MOVE_CLIP_REQUIREMENT).toEqual({
      name: "timeline.move_clip",
      mutation: true,
      requiredPermission: "EDIT",
      requiredContext: "SELECTION",
      targetType: "clip",
      supportsMultipleTargets: false,
    });
    expect(toolRequirementOf("timeline.move_clip")).toEqual(MOVE_CLIP_REQUIREMENT);
    expect(toolRequirementOf("project.describe")).toMatchObject({
      mutation: false,
      requiredPermission: "READ",
      requiredContext: "PROJECT",
      targetType: "project",
    });
    const plan = planDirectorTurn(AUTO_THREE_SECOND_PROMPT);
    const req = toolRequirementOf(plan.toolName);
    expect(plan.requiredPermission).toBe(req?.requiredPermission);
    expect(plan.requiredGrant).toBe(req?.requiredPermission);
    expect(plan.contextLevel).toBe(req?.requiredContext);
    expect(plan.toolName).toBe("timeline.move_clip");
  });

  it("1. selected clip + German +3000 Preview — no mutation before Apply", async () => {
    const session = fixture();
    const start = host({ mode: "ASK", grant: "EDIT", contextLevel: "NONE" });
    expect(start.mode).toBe("ASK");
    expect(start.contextLevel).toBe("NONE");
    const preview = await autoTurn(session, AUTO_THREE_SECOND_PROMPT, start);
    expect(preview.transaction?.status).toBe("draft");
    expect(preview.transaction?.toolName).toBe("timeline.move_clip");
    expect(preview.transaction?.preview.clipId).toBe("clip_test");
    expect(preview.transaction?.command).toEqual({
      type: "moveClips",
      clipIds: ["clip_test"],
      deltaMs: 3000,
    });
    expect(preview.sealedRequest?.clipId).toBe("clip_test");
    expect(preview.sealedRequest?.requiredPermission).toBe("EDIT");
    expect(preview.sealedRequest?.authorizedGrant).toBe("EDIT");
    expect(preview.mode).toBe("ASK");
    expect(preview.contextLevel).toBe("NONE");
    expect(startOf(session)).toBe(30_000);
    expect(session.history.past.length).toBe(0);
    expect(projectRevisionOf(session)).toBe(0);
    expect(autoPlanStatusLabel(preview)).toMatch(
      /AUTO · Intent MOVE_CLIP · Tool timeline\.move_clip · Context SELECTION · Permission EDIT/,
    );
  });

  it("2. Apply exact +3000, one history, schema 5", async () => {
    const session = fixture();
    const preview = await autoTurn(session, AUTO_THREE_SECOND_PROMPT, host({ grant: "EDIT" }));
    const applied = applyHostApproved(preview, session);
    expect(startOf(applied.session)).toBe(33_000);
    expect(applied.session.history.past.length).toBe(1);
    expect(applied.session.project.schemaVersion).toBe(5);
    expect(JSON.parse(serializeProject(applied.session.project)).schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
  });

  it("3. Reject after Preview — zero mutation / history / revision", async () => {
    const session = fixture();
    const preview = await autoTurn(session, AUTO_THREE_SECOND_PROMPT, host({ grant: "EDIT" }));
    const rejected = rejectHostTransaction(preview);
    expect(rejected.transaction?.status).toBe("rejected");
    expect(startOf(session)).toBe(30_000);
    expect(session.history.past.length).toBe(0);
    expect(projectRevisionOf(session)).toBe(0);
  });

  it("4. Undo / Redo exact after Apply", async () => {
    const session = fixture();
    const applied = applyHostApproved(
      await autoTurn(session, AUTO_THREE_SECOND_PROMPT, host({ grant: "EDIT" })),
      session,
    );
    expect(startOf(applied.session)).toBe(33_000);
    const undone = applyUndo(applied.session);
    expect(startOf(undone)).toBe(30_000);
    const redone = applyRedo(undone);
    expect(startOf(redone)).toBe(33_000);
  });

  it("5. hostile Snap does not alter exact +3000", async () => {
    const session = fixture(30_000);
    expect(session.project.snap).toBe(true);
    session.project.playheadMs = 31_950;
    const applied = applyHostApproved(
      await autoTurn(session, AUTO_THREE_SECOND_PROMPT, host({ grant: "EDIT" })),
      session,
    );
    expect(startOf(applied.session) - 30_000).toBe(3000);
    const left = applyHostApproved(
      await autoTurn(applied.session, AUTO_TWO_SECOND_LEFT_PROMPT, applied.state),
      applied.session,
    );
    expect(startOf(left.session) - 30_000).toBe(1000);
  });

  it("6. no selection fail closed — No clip is selected.", async () => {
    const session = { ...fixture(), selectedClipId: null, selectedClipIds: [] };
    const next = await autoTurn(session, AUTO_THREE_SECOND_PROMPT, host({ grant: "EDIT" }));
    expect(next.pendingAuth).toBeNull();
    expect(next.transaction).toBeNull();
    expect(next.conversation.messages.at(-1)?.text).toMatch(/No clip is selected/i);
    expect(startOf(session)).toBe(30_000);
    expect(session.history.past.length).toBe(0);
  });

  it("7. displayed manual NONE but AUTO has actual selection → Preview", async () => {
    const session = fixture();
    const start = host({
      mode: "ASK",
      grant: "EDIT",
      contextLevel: "NONE",
      contextLabel: "Context: NONE",
    });
    expect(start.contextLevel).toBe("NONE");
    const preview = await autoTurn(session, AUTO_THREE_SECOND_PROMPT, start);
    expect(preview.contextLevel).toBe("NONE");
    expect(preview.sealedRequest?.plan.contextLevel).toBe("SELECTION");
    expect(preview.sealedRequest?.clipId).toBe("clip_test");
    expect(preview.transaction?.status).toBe("draft");
    expect(preview.transaction?.command).toEqual({
      type: "moveClips",
      clipIds: ["clip_test"],
      deltaMs: 3000,
    });
    expect(startOf(session)).toBe(30_000);
  });

  it("8. Manual ASK/READ/NONE must not fail a valid AUTO merely from defaults", async () => {
    const session = fixture();
    const start = host({ mode: "ASK", grant: "READ", contextLevel: "NONE" });
    const blocked = await autoTurn(session, AUTO_THREE_SECOND_PROMPT, start);
    expect(blocked.pendingAuth?.requiredGrant).toBe("EDIT");
    expect(blocked.pendingAuth?.currentGrant).toBe("READ");
    expect(blocked.mode).toBe("ASK");
    expect(blocked.grant).toBe("READ");
    expect(blocked.contextLevel).toBe("NONE");
    expect(blocked.transaction).toBeNull();
    expect(blocked.conversation.messages.at(-1)?.text ?? "").not.toMatch(/Context SELECTION is required/);
    expect(startOf(session)).toBe(30_000);
    const preview = await autoTurn(session, AUTO_THREE_SECOND_PROMPT, allowDirectorGrantSession(blocked));
    expect(preview.transaction?.status).toBe("draft");
    expect(preview.transaction?.preview.clipId).toBe("clip_test");
    expect(preview.mode).toBe("ASK");
    expect(preview.contextLevel).toBe("NONE");
    expect(startOf(session)).toBe(30_000);
  });

  it("9. Unauthorized EDIT — no silent elevate, zero mutation", async () => {
    const session = fixture();
    const next = await autoTurn(session, AUTO_THREE_SECOND_PROMPT, host({ grant: "READ" }));
    expect(next.pendingAuth?.requiredGrant).toBe("EDIT");
    expect(next.grant).toBe("READ");
    expect(next.onceGrant).toBeNull();
    expect(next.transaction).toBeNull();
    expect(startOf(session)).toBe(30_000);
    expect(projectRevisionOf(session)).toBe(0);
  });

  it("10. Provider unavailable → zero mutation", async () => {
    const session = fixture();
    const next = await autoTurn(
      session,
      AUTO_THREE_SECOND_PROMPT,
      host({ grant: "EDIT" }),
      createMockProvider({ failWith: "PROVIDER_UNAVAILABLE" }),
    );
    expect(next.transaction).toBeNull();
    expect(next.conversation.messages.at(-1)?.text).toMatch(/PROVIDER_UNAVAILABLE|Provider error/);
    expect(startOf(session)).toBe(30_000);
  });

  it("11. Stale transaction after human edit — Apply blocked", async () => {
    const session = fixture();
    const preview = await autoTurn(session, AUTO_THREE_SECOND_PROMPT, host({ grant: "EDIT" }));
    const human = applyCommand(session, { type: "moveClips", clipIds: ["clip_test"], deltaMs: 80 });
    const stale = applyHostApproved(preview, human);
    expect(stale.state.lastGateCode).toBe("TRANSACTION_CONFLICT");
    expect(startOf(human)).toBe(30_080);
    expect(startOf(session)).toBe(30_000);
  });

  it("12. Project switch / ABA — target project unchanged", async () => {
    const session = fixture();
    const preview = await autoTurn(session, AUTO_THREE_SECOND_PROMPT, host({ grant: "EDIT" }));
    const other = fixture();
    other.project = { ...other.project, id: "project_other" };
    const switched = applyHostApproved(preview, other);
    expect(switched.state.lastGateCode === "TRANSACTION_CONFLICT" || switched.session === other).toBe(true);
    expect(startOf(other)).toBe(30_000);
    expect(other.history.past.length).toBe(0);
  });

  it("13. German variants converge to timeline.move_clip +3000", () => {
    const phrases = [
      AUTO_THREE_SECOND_PROMPT,
      AUTO_GERMAN_VIDEO_PROMPT,
      AUTO_GERMAN_SCHIEB_PROMPT,
    ];
    for (const text of phrases) {
      expect(parseMoveClipPrompt(text)).toEqual({ deltaMs: 3000 });
      expect(classifyDirectorIntent(text).kind).toBe("MOVE_CLIP");
      expect(planDirectorTurn(text)).toMatchObject({
        mode: "AGENT",
        requiredPermission: "EDIT",
        requiredGrant: "EDIT",
        contextLevel: "SELECTION",
        toolName: "timeline.move_clip",
      });
    }
  });

  it("13b. German variants Preview the same stable id +3000", async () => {
    for (const text of [AUTO_GERMAN_VIDEO_PROMPT, AUTO_GERMAN_SCHIEB_PROMPT]) {
      const session = fixture();
      const preview = await autoTurn(session, text, host({ grant: "EDIT" }));
      expect(preview.transaction?.command).toEqual({
        type: "moveClips",
        clipIds: ["clip_test"],
        deltaMs: 3000,
      });
      expect(startOf(session)).toBe(30_000);
    }
  });

  it("14. English variants converge to the same CLIP tool", async () => {
    for (const text of [AUTO_ENGLISH_SELECTED_PROMPT, AUTO_ENGLISH_VIDEO_PROMPT]) {
      expect(parseMoveClipPrompt(text)).toEqual({ deltaMs: 3000 });
      expect(classifyDirectorIntent(text).kind).toBe("MOVE_CLIP");
      const session = fixture();
      const preview = await autoTurn(session, text, host({ grant: "EDIT" }));
      expect(preview.transaction?.command).toEqual({
        type: "moveClips",
        clipIds: ["clip_test"],
        deltaMs: 3000,
      });
    }
  });

  it("15. Hallo — no mutation, no EDIT elevation", async () => {
    const session = fixture();
    const next = await autoTurn(session, AUTO_HELLO_PROMPT, host({ grant: "READ", mode: "ASK" }));
    expect(classifyDirectorIntent(AUTO_HELLO_PROMPT).kind).toBe("CHAT");
    expect(next.lastPlan?.requiredPermission).toBe("READ");
    expect(next.lastPlan?.contextLevel).toBe("NONE");
    expect(next.pendingAuth).toBeNull();
    expect(next.transaction).toBeNull();
    expect(next.grant).toBe("READ");
    expect(startOf(session)).toBe(30_000);
    expect(session.history.past.length).toBe(0);
  });

  it("16. read-only questions — duration SELECTION, tracks PROJECT", async () => {
    const session = fixture();
    const duration = await autoTurn(session, AUTO_DURATION_PROMPT, host({ grant: "READ" }));
    expect(classifyDirectorIntent(AUTO_DURATION_PROMPT).kind).toBe("READ_CLIP");
    expect(duration.lastPlan?.requiredPermission).toBe("READ");
    expect(duration.lastPlan?.contextLevel).toBe("SELECTION");
    expect(duration.lastPlan?.toolName).toBe("timeline.get_clip");
    expect(duration.pendingAuth).toBeNull();
    expect(duration.transaction).toBeNull();
    expect(duration.conversation.messages.at(-1)?.text).toMatch(/durationMs/);
    expect(startOf(session)).toBe(30_000);

    const tracks = await autoTurn(session, AUTO_TRACKS_PROMPT, host({ grant: "READ", contextLevel: "NONE" }));
    expect(classifyDirectorIntent(AUTO_TRACKS_PROMPT).kind).toBe("READ_PROJECT");
    expect(tracks.lastPlan?.requiredPermission).toBe("READ");
    expect(tracks.lastPlan?.contextLevel).toBe("PROJECT");
    expect(tracks.lastPlan?.toolName).toBe("project.describe");
    expect(tracks.pendingAuth).toBeNull();
    expect(tracks.transaction).toBeNull();
    expect(tracks.conversation.messages.at(-1)?.text).toMatch(/trackIds/);
    expect(startOf(session)).toBe(30_000);
    expect(projectRevisionOf(session)).toBe(0);
  });

  it("12/12 deterministic golden AUTO +3000 with snap ON", async () => {
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

  it("AUTO does not overwrite manual provider dropdown when resolving local", async () => {
    const session = fixture();
    const start = applyLocalConfig(applyProviderId(host({ grant: "EDIT" }), "mock"), {
      baseUrl: "http://127.0.0.1:11434/v1",
      model: "qwen2.5:7b",
    });
    expect(start.providerId).toBe("mock");
    const preview = await autoTurn(session, AUTO_THREE_SECOND_PROMPT, start);
    expect(preview.providerId).toBe("mock");
    expect(preview.localConfig.model).toBe("qwen2.5:7b");
    expect(preview.transaction?.status).toBe("draft");
  });
});
