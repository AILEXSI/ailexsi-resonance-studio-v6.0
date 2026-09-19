/**
 * Auto-Orchestration plan-loss repair — tests A–J.
 * Execution must use the sealed DirectorPlan, not Advanced ASK/DRAFT/NONE.
 */
import { describe, expect, it } from "vitest";
import { applyUndo, applyRedo, createSession, projectRevisionOf, type Session } from "../../src/app/session";
import {
  allowDirectorGrantOnce,
  allowDirectorGrantSession,
  applyContextLevel,
  applyGrant,
  applyHostApproved,
  applyMode,
  applyOrchestrationPlan,
  cancelDirectorAuth,
  createDirectorHostState,
  submitDirectorAutoTurn,
  submitDirectorProviderTurn,
  type DirectorHostState,
} from "../../src/app/ai/host";
import { planDirectorTurn } from "../../src/app/ai/orchestration";
import { createOrchestrator } from "../../src/app/ai/orchestrator";
import { DIRECTOR_MUTATING_TOOL } from "../../src/app/ai/contract";
import { GOLDEN_MOVE_PROMPT, HUMAN_MOVE_PROMPT } from "../../src/app/ai/tools/move-clip";
import { createMockProvider } from "../../src/app/ai/providers/mock";
import type { AIProvider, ChatRequest, ChatResponse } from "../../src/app/ai/providers/types";
import { PROJECT_SCHEMA_VERSION, serializeProject } from "../../src/core/project";
import { createMemoryBlobStore } from "../../src/core/persistence";
import { asset, clip, projectWith } from "../helpers";

const SELECTION_DENIED = "Denied: Context SELECTION is required to move a clip. No project changes were made.";

function selectedVideo(startMs = 30_000): Session {
  const a = asset({ id: "asset_vid", kind: "video", durationMs: 8000, name: "user-video.mp4" });
  const c = clip({
    id: "clip_video",
    assetId: "asset_vid",
    trackId: "V1",
    startMs,
    durationMs: 2000,
  });
  return {
    ...createSession(createMemoryBlobStore()),
    project: { ...projectWith([c], [a]), snap: true, playheadMs: 31_000 },
    selectedClipId: "clip_video",
    selectedClipIds: ["clip_video"],
  };
}

function emptySelection(): Session {
  const session = selectedVideo();
  return { ...session, selectedClipId: null, selectedClipIds: [] };
}

function manualAskDraftNone(patch?: Partial<DirectorHostState>): DirectorHostState {
  return {
    ...createDirectorHostState(),
    providerId: "openai-compatible",
    providerLabel: "Provider: local-openai-compatible",
    mode: "ASK",
    modeLabel: "Mode: ASK",
    grant: "DRAFT",
    contextLevel: "NONE",
    contextLabel: "Context: NONE",
    surface: "advanced",
    ...patch,
  };
}

function localMoveProvider(): AIProvider {
  return {
    id: "openai-compatible",
    capabilities: () => ({ chat: true, stream: false, tools: false, local: true }),
    getModels: async () => [{ id: "local-model", name: "local-model" }],
    testConnection: async () => ({ ok: true }),
    abort: () => undefined,
    chat: async (request: ChatRequest): Promise<ChatResponse> => ({
      requestId: request.requestId,
      text: JSON.stringify({
        message: "Preview timeline.move_clip +2000ms on the selected clip. Apply to commit.",
        toolRequest: { name: DIRECTOR_MUTATING_TOOL, arguments: { deltaMs: 2000 } },
      }),
      model: "local-model",
    }),
  };
}

function conversationText(state: DirectorHostState): string {
  return state.conversation.messages.map((m) => m.text).join("\n");
}

async function autoTurn(
  session: Session,
  state: DirectorHostState,
  text: string,
  provider: AIProvider = localMoveProvider(),
): Promise<DirectorHostState> {
  return submitDirectorAutoTurn(
    state,
    text,
    { provider, orchestrator: createOrchestrator() },
    undefined,
    session,
    { providerInjected: true },
  );
}

describe("AI Director auto-orchestration A–J (request-scoped plan)", () => {
  it("A. human regression: selected clip + ASK/DRAFT/NONE plans AGENT/SELECTION/EDIT and must not deny SELECTION", async () => {
    const session = selectedVideo();
    expect(session.selectedClipId).toBe("clip_video");
    expect(session.project.clips[0]!.trackId).toBe("V1");

    const plan = planDirectorTurn(HUMAN_MOVE_PROMPT);
    expect(plan.intent.kind).toBe("MOVE_CLIP");
    expect(plan.mode).toBe("AGENT");
    expect(plan.requiredGrant).toBe("EDIT");
    expect(plan.contextLevel).toBe("SELECTION");
    expect(plan.toolName).toBe("timeline.move_clip");

    const start = manualAskDraftNone();
    expect(start.mode).toBe("ASK");
    expect(start.grant).toBe("DRAFT");
    expect(start.contextLevel).toBe("NONE");

    const first = await autoTurn(session, start, HUMAN_MOVE_PROMPT);
    expect(conversationText(first)).not.toContain(SELECTION_DENIED);
    expect(first.lastPlan?.mode).toBe("AGENT");
    expect(first.lastPlan?.contextLevel).toBe("SELECTION");
    expect(first.lastPlan?.requiredGrant).toBe("EDIT");
    expect(first.pendingAuth?.requiredGrant).toBe("EDIT");
    expect(first.mode).toBe("ASK");
    expect(first.grant).toBe("DRAFT");
    expect(first.contextLevel).toBe("NONE");
    expect(first.transaction).toBeNull();
    expect(session.project.clips[0]!.startMs).toBe(30_000);

    const preview = await autoTurn(session, allowDirectorGrantOnce(first), HUMAN_MOVE_PROMPT);
    expect(conversationText(preview)).not.toContain(SELECTION_DENIED);
    expect(preview.transaction?.status).toBe("draft");
    expect(preview.transaction?.command).toEqual({
      type: "moveClips",
      clipIds: ["clip_video"],
      deltaMs: 2000,
    });
    expect(preview.mode).toBe("ASK");
    expect(preview.grant).toBe("DRAFT");
    expect(preview.contextLevel).toBe("NONE");
    expect(session.project.clips[0]!.startMs).toBe(30_000);

    const applied = applyHostApproved(preview, session);
    expect(applied.state.transaction?.status).toBe("applied");
    expect(applied.session.project.clips[0]!.startMs).toBe(32_000);
    expect(applied.state.mode).toBe("ASK");
    expect(applied.state.grant).toBe("DRAFT");
    expect(applied.state.contextLevel).toBe("NONE");
    expect(applied.state.onceGrant).toBeNull();
  });

  it("B. Allow once: EDIT for this request only; dropdown stays DRAFT; next turn re-auths", async () => {
    const session = selectedVideo();
    const blocked = await autoTurn(session, manualAskDraftNone(), HUMAN_MOVE_PROMPT);
    const allowed = allowDirectorGrantOnce(blocked);
    expect(allowed.grant).toBe("DRAFT");
    expect(allowed.onceGrant).toBe("EDIT");
    expect(allowed.mode).toBe("ASK");
    const preview = await autoTurn(session, allowed, HUMAN_MOVE_PROMPT);
    expect(preview.transaction?.status).toBe("draft");
    expect(preview.grant).toBe("DRAFT");
    const applied = applyHostApproved(preview, session);
    expect(applied.state.onceGrant).toBeNull();
    expect(applied.state.grant).toBe("DRAFT");
    const again = await autoTurn(applied.session, applied.state, HUMAN_MOVE_PROMPT);
    expect(again.pendingAuth?.requiredGrant).toBe("EDIT");
    expect(applied.session.project.clips[0]!.startMs).toBe(32_000);
  });

  it("C. Allow session: EDIT until restart, not Project JSON; dropdown may show EDIT after explicit allow", async () => {
    const session = selectedVideo();
    const blocked = await autoTurn(session, manualAskDraftNone(), HUMAN_MOVE_PROMPT);
    const sessionGrant = allowDirectorGrantSession(blocked);
    expect(sessionGrant.grant).toBe("EDIT");
    const preview = await autoTurn(session, sessionGrant, HUMAN_MOVE_PROMPT);
    expect(preview.transaction?.status).toBe("draft");
    const dumped = JSON.parse(serializeProject(session.project)) as Record<string, unknown>;
    expect(dumped.schemaVersion).toBe(5);
    expect(dumped).not.toHaveProperty("grant");
    expect(dumped).not.toHaveProperty("director");
    expect(JSON.stringify(dumped)).not.toMatch(/Allow for session/);
  });

  it("D. Cancel: zero mutation / history / revision / conversation", async () => {
    const session = selectedVideo();
    const blocked = await autoTurn(session, manualAskDraftNone(), HUMAN_MOVE_PROMPT);
    const cancelled = cancelDirectorAuth(blocked);
    expect(cancelled.pendingAuth).toBeNull();
    expect(cancelled.heldUserText).toBeNull();
    expect(cancelled.transaction).toBeNull();
    expect(cancelled.conversation.messages.length).toBe(0);
    expect(session.project.clips[0]!.startMs).toBe(30_000);
    expect(session.history.past.length).toBe(0);
    expect(projectRevisionOf(session)).toBe(0);
  });

  it("E. no selection: fail-closed, never Context SELECTION required, no mutation", async () => {
    const session = emptySelection();
    const start = manualAskDraftNone({ grant: "EDIT" });
    const next = await autoTurn(session, start, HUMAN_MOVE_PROMPT);
    expect(conversationText(next)).not.toContain(SELECTION_DENIED);
    expect(next.transaction).toBeNull();
    expect(conversationText(next)).toMatch(/No clip selected|single selected clip/i);
    expect(session.history.past.length).toBe(0);
    expect(projectRevisionOf(session)).toBe(0);
  });

  it("F. READ auto still works with UI NONE — plan SELECTION, no mutation", async () => {
    const session = selectedVideo();
    const start = manualAskDraftNone({ grant: "READ" });
    const next = await autoTurn(session, start, "What is selected?", createMockProvider());
    expect(next.lastPlan?.contextLevel).toBe("SELECTION");
    expect(next.lastPlan?.requiredGrant).toBe("READ");
    expect(next.contextLevel).toBe("NONE");
    expect(next.conversation.messages.at(-1)?.text).toMatch(/clip_video/);
    expect(next.transaction).toBeNull();
    expect(session.project.clips[0]!.startMs).toBe(30_000);
  });

  it("G. unsupported delete: NO_TOOL, never invents move_clip", async () => {
    const session = selectedVideo();
    const next = await autoTurn(
      session,
      manualAskDraftNone({ grant: "EDIT", mode: "AGENT" }),
      "Lösche den markierten Clip",
      createMockProvider(),
    );
    expect(next.lastNoTool?.code).toBe("NO_TOOL");
    expect(next.lastNoTool?.message).toMatch(/will not invent timeline\.move_clip/);
    expect(next.transaction).toBeNull();
    expect(session.project.clips[0]!.startMs).toBe(30_000);
  });

  it("H. stale UI mid-flight: clobber ASK/NONE after seal; execution still uses plan", async () => {
    const session = selectedVideo();
    const start = manualAskDraftNone({ grant: "EDIT" });
    const planned = applyOrchestrationPlan(start, planDirectorTurn(HUMAN_MOVE_PROMPT), session, HUMAN_MOVE_PROMPT);
    expect(planned.sealedRequest?.plan.mode).toBe("AGENT");
    expect(planned.sealedRequest?.clipId).toBe("clip_video");
    const clobbered = applyGrant(applyContextLevel(applyMode(planned, "ASK"), "NONE"), "READ");
    expect(clobbered.mode).toBe("ASK");
    expect(clobbered.contextLevel).toBe("NONE");
    expect(clobbered.grant).toBe("READ");
    const withOnce: DirectorHostState = { ...clobbered, onceGrant: "EDIT" };
    const preview = await submitDirectorProviderTurn(
      withOnce,
      HUMAN_MOVE_PROMPT,
      { provider: localMoveProvider(), orchestrator: createOrchestrator() },
      undefined,
      session,
    );
    expect(conversationText(preview)).not.toContain(SELECTION_DENIED);
    expect(preview.transaction?.status).toBe("draft");
    expect(preview.transaction?.command).toEqual({
      type: "moveClips",
      clipIds: ["clip_video"],
      deltaMs: 2000,
    });
    expect(preview.mode).toBe("ASK");
    expect(preview.contextLevel).toBe("NONE");
  });

  it("I. provider failure: fail-closed, zero mutation", async () => {
    const session = selectedVideo();
    const next = await autoTurn(
      session,
      manualAskDraftNone({ grant: "EDIT" }),
      HUMAN_MOVE_PROMPT,
      createMockProvider({ failWith: "PROVIDER_UNAVAILABLE" }),
    );
    expect(next.transaction).toBeNull();
    expect(conversationText(next)).toMatch(/PROVIDER_UNAVAILABLE|Provider error/);
    expect(session.project.clips[0]!.startMs).toBe(30_000);
    expect(session.history.past.length).toBe(0);
    expect(projectRevisionOf(session)).toBe(0);
  });

  it("J. golden AUTO snap=true +2000 then Undo / Redo; UI stays ASK/DRAFT/NONE", async () => {
    const session = selectedVideo(30_000);
    expect(session.project.snap).toBe(true);
    const start = manualAskDraftNone({ grant: "EDIT" });
    const preview = await autoTurn(session, start, GOLDEN_MOVE_PROMPT, createMockProvider());
    expect(preview.transaction?.command).toEqual({
      type: "moveClips",
      clipIds: ["clip_video"],
      deltaMs: 2000,
    });
    expect(preview.mode).toBe("ASK");
    expect(preview.grant).toBe("EDIT");
    expect(preview.contextLevel).toBe("NONE");
    const applied = applyHostApproved(preview, session);
    expect(applied.session.project.clips[0]!.startMs).toBe(32_000);
    expect(applied.session.project.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(applied.session.history.past.length).toBe(1);
    const undone = applyUndo(applied.session);
    expect(undone.project.clips[0]!.startMs).toBe(30_000);
    const redone = applyRedo(undone);
    expect(redone.project.clips[0]!.startMs).toBe(32_000);
    expect(applied.state.mode).toBe("ASK");
    expect(applied.state.contextLevel).toBe("NONE");
  });

  it("applyOrchestrationPlan never writes Mode / Grant / Context dropdowns", () => {
    const start = manualAskDraftNone();
    const next = applyOrchestrationPlan(start, planDirectorTurn(HUMAN_MOVE_PROMPT));
    expect(next.mode).toBe("ASK");
    expect(next.grant).toBe("DRAFT");
    expect(next.contextLevel).toBe("NONE");
    expect(next.modeLabel).toBe("Mode: ASK");
    expect(next.contextLabel).toBe("Context: NONE");
    expect(next.lastPlan?.mode).toBe("AGENT");
    expect(Object.isFrozen(next.lastPlan)).toBe(true);
  });
});
