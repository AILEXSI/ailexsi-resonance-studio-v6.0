/**
 * Human Gate Repair #2 — selection context dataflow.
 * Canonical selection is Session via selectClips / selectionOf.
 * Do not fixture-bypass the request snapshot.
 */
import { describe, expect, it } from "vitest";
import { applyCommand } from "../../src/app/commands";
import {
  createSession,
  projectRevisionOf,
  selectionOf,
  type Session,
} from "../../src/app/session";
import {
  applyHostApproved,
  createDirectorHostState,
  requestContextTrace,
  submitDirectorAutoTurn,
  type DirectorHostState,
} from "../../src/app/ai/host";
import { classifyDirectorIntent, planDirectorTurn } from "../../src/app/ai/orchestration";
import { createOrchestrator } from "../../src/app/ai/orchestrator";
import {
  GOLDEN_MOVE_PROMPT,
  HUMAN_THREE_SECOND_PROMPT,
} from "../../src/app/ai/tools/move-clip";
import { createMockProvider } from "../../src/app/ai/providers/mock";
import type { AIProvider, ChatRequest, ChatResponse } from "../../src/app/ai/providers/types";
import { PROJECT_SCHEMA_VERSION, serializeProject } from "../../src/core/project";
import { createMemoryBlobStore } from "../../src/core/persistence";
import { asset, clip, projectWith } from "../helpers";

const VIDEO_A = "clip_video_a";
const VIDEO_B = "clip_video_b";
const AUDIO_A = "clip_audio_a";

function multiClipSession(): Session {
  const va = asset({ id: "asset_va", kind: "video", durationMs: 8000, name: "file-a.mp4" });
  const vb = asset({ id: "asset_vb", kind: "video", durationMs: 8000, name: "file-b.mp4" });
  const aa = asset({ id: "asset_aa", kind: "audio", durationMs: 8000, name: "file-c.wav" });
  const a = clip({ id: VIDEO_A, assetId: "asset_va", trackId: "V1", startMs: 10_000, durationMs: 4000 });
  const b = clip({ id: VIDEO_B, assetId: "asset_vb", trackId: "V2", startMs: 20_000, durationMs: 4000 });
  const c = clip({ id: AUDIO_A, assetId: "asset_aa", trackId: "A1", startMs: 5_000, durationMs: 4000 });
  return {
    ...createSession(createMemoryBlobStore()),
    project: { ...projectWith([a, b, c], [va, vb, aa]), snap: true, playheadMs: 11_000 },
    selectedClipId: null,
    selectedClipIds: [],
  };
}

function selectViaTimeline(session: Session, clipId: string): Session {
  return applyCommand(session, { type: "selectClips", clipIds: [clipId] });
}

function agentEditSelection(patch?: Partial<DirectorHostState>): DirectorHostState {
  return {
    ...createDirectorHostState(),
    mode: "AGENT",
    modeLabel: "Mode: AGENT",
    grant: "EDIT",
    contextLevel: "SELECTION",
    contextLabel: "Context: SELECTION",
    ...patch,
  };
}

function startOf(session: Session, clipId: string): number {
  return session.project.clips.find((c) => c.id === clipId)!.startMs;
}

async function autoTurn(
  session: Session,
  text: string,
  state: DirectorHostState = agentEditSelection(),
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

function wrongTargetProvider(clipId: string): AIProvider {
  return {
    id: "mock",
    capabilities: () => ({ chat: true, stream: false, tools: false, local: true }),
    getModels: async () => [{ id: "mock", name: "mock" }],
    testConnection: async () => ({ ok: true }),
    abort: () => undefined,
    chat: async (request: ChatRequest): Promise<ChatResponse> => ({
      requestId: request.requestId,
      text: JSON.stringify({
        message: "move other",
        toolRequest: { name: "timeline.move_clip", arguments: { clipId, deltaMs: 3000 } },
      }),
    }),
  };
}

describe("selection context dataflow — human 3s + matrix", () => {
  it("AUTO classifies the human EXE phrasing as MOVE_CLIP / SELECTION", () => {
    expect(classifyDirectorIntent(HUMAN_THREE_SECOND_PROMPT).kind).toBe("MOVE_CLIP");
    expect(classifyDirectorIntent("verschiebe markiertes file 3sec nach rechts").kind).toBe("MOVE_CLIP");
    const plan = planDirectorTurn(HUMAN_THREE_SECOND_PROMPT);
    expect(plan.mode).toBe("AGENT");
    expect(plan.contextLevel).toBe("SELECTION");
    expect(plan.requiredGrant).toBe("EDIT");
    expect(plan.toolName).toBe("timeline.move_clip");
  });

  it("2. THREE SECOND +3000: canonical selectClips survives Preview Apply", async () => {
    const empty = multiClipSession();
    expect(selectionOf(empty)).toEqual([]);
    const session = selectViaTimeline(empty, VIDEO_B);
    expect(selectionOf(session)).toEqual([VIDEO_B]);
    expect(session.selectedClipId).toBe(VIDEO_B);

    const preview = await autoTurn(session, HUMAN_THREE_SECOND_PROMPT);
    const trace = requestContextTrace(preview);
    expect(trace.contextLevel).toBe("SELECTION");
    expect(trace.selectedClipIds).toEqual([VIDEO_B]);
    expect(trace.clipId).toBe(VIDEO_B);
    expect(trace.projectId).toBe(session.project.id);
    expect(preview.sealedRequest?.contextSnapshot?.selection.clipIds).toEqual([VIDEO_B]);
    expect(preview.sealedRequest?.clipId).toBe(VIDEO_B);
    expect(preview.lastSnapshot).toBe(preview.sealedRequest?.contextSnapshot);
    expect(preview.transaction?.status).toBe("draft");
    expect(preview.transaction?.toolName).toBe("timeline.move_clip");
    expect(preview.transaction?.command).toEqual({
      type: "moveClips",
      clipIds: [VIDEO_B],
      deltaMs: 3000,
    });
    expect(startOf(session, VIDEO_A)).toBe(10_000);
    expect(startOf(session, VIDEO_B)).toBe(20_000);
    expect(startOf(session, AUDIO_A)).toBe(5_000);
    expect(session.history.past.length).toBe(0);
    expect(projectRevisionOf(session)).toBe(0);

    const applied = applyHostApproved(preview, session);
    expect(applied.state.transaction?.status).toBe("applied");
    expect(startOf(applied.session, VIDEO_B)).toBe(23_000);
    expect(startOf(applied.session, VIDEO_A)).toBe(10_000);
    expect(startOf(applied.session, AUDIO_A)).toBe(5_000);
    expect(applied.session.history.past.length).toBe(1);
    expect(projectRevisionOf(applied.session)).toBe(1);
    expect(applied.session.project.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(JSON.parse(serializeProject(applied.session.project)).schemaVersion).toBe(5);
  });

  it("1. REALISTIC EDIT +2000 SELECTION survives Preview Apply", async () => {
    const session = selectViaTimeline(multiClipSession(), VIDEO_A);
    const preview = await autoTurn(session, GOLDEN_MOVE_PROMPT);
    expect(requestContextTrace(preview).selectedClipIds).toEqual([VIDEO_A]);
    expect(preview.transaction?.command).toEqual({
      type: "moveClips",
      clipIds: [VIDEO_A],
      deltaMs: 2000,
    });
    expect(startOf(session, VIDEO_A)).toBe(10_000);
    const applied = applyHostApproved(preview, session);
    expect(startOf(applied.session, VIDEO_A)).toBe(12_000);
    expect(startOf(applied.session, VIDEO_B)).toBe(20_000);
  });

  it("3. NO SELECTION → fail-closed, zero mutation", async () => {
    const session = multiClipSession();
    expect(selectionOf(session)).toEqual([]);
    const next = await autoTurn(session, HUMAN_THREE_SECOND_PROMPT);
    expect(next.transaction).toBeNull();
    expect(next.conversation.messages.at(-1)?.text).toMatch(/Denied|No clip selected|SELECTION/i);
    expect(startOf(session, VIDEO_A)).toBe(10_000);
    expect(startOf(session, VIDEO_B)).toBe(20_000);
    expect(session.history.past.length).toBe(0);
    expect(projectRevisionOf(session)).toBe(0);
  });

  it("4. WRONG TARGET non-selected ID → DENIED zero mutation", async () => {
    const session = selectViaTimeline(multiClipSession(), VIDEO_A);
    const next = await autoTurn(session, HUMAN_THREE_SECOND_PROMPT, agentEditSelection(), wrongTargetProvider(VIDEO_B));
    expect(next.transaction).toBeNull();
    expect(next.conversation.messages.at(-1)?.text).toMatch(/Denied: target clip is not in the request selection/);
    expect(startOf(session, VIDEO_A)).toBe(10_000);
    expect(startOf(session, VIDEO_B)).toBe(20_000);
    expect(session.history.past.length).toBe(0);
  });

  it("5. READ Was ist markiert? selected context, zero mutation", async () => {
    const session = selectViaTimeline(multiClipSession(), VIDEO_B);
    const next = await autoTurn(session, "Was ist markiert?");
    expect(next.lastPlan?.contextLevel).toBe("SELECTION");
    expect(next.sealedRequest?.clipId).toBe(VIDEO_B);
    expect(next.conversation.messages.at(-1)?.text).toMatch(VIDEO_B);
    expect(next.transaction).toBeNull();
    expect(startOf(session, VIDEO_B)).toBe(20_000);
    expect(session.history.past.length).toBe(0);
  });

  it("6. UNSUPPORTED delete → UNSUPPORTED zero mutation", async () => {
    const session = selectViaTimeline(multiClipSession(), VIDEO_A);
    const next = await autoTurn(session, "Lösche den markierten Clip");
    expect(next.lastPlan?.intent.kind).toBe("UNSUPPORTED");
    expect(next.lastNoTool?.code).toBe("NO_TOOL");
    expect(next.transaction).toBeNull();
    expect(startOf(session, VIDEO_A)).toBe(10_000);
    expect(session.history.past.length).toBe(0);
  });

  it("7. STALE preview then manual change → TRANSACTION_CONFLICT", async () => {
    const session = selectViaTimeline(multiClipSession(), VIDEO_B);
    const preview = await autoTurn(session, HUMAN_THREE_SECOND_PROMPT);
    expect(preview.transaction?.status).toBe("draft");
    const human = applyCommand(session, { type: "moveClips", clipIds: [VIDEO_B], deltaMs: 80 });
    const approved = applyHostApproved(preview, human);
    expect(approved.state.lastGateCode).toBe("TRANSACTION_CONFLICT");
    expect(startOf(approved.session, VIDEO_B)).toBe(20_080);
    expect(human.history.past.length).toBe(1);
  });

  it("8. PROVIDER FAILURE → zero mutation", async () => {
    const session = selectViaTimeline(multiClipSession(), VIDEO_A);
    const next = await autoTurn(
      session,
      HUMAN_THREE_SECOND_PROMPT,
      agentEditSelection(),
      createMockProvider({ failWith: "PROVIDER_UNAVAILABLE" }),
    );
    expect(next.status).toBe("error");
    expect(next.transaction).toBeNull();
    expect(startOf(session, VIDEO_A)).toBe(10_000);
    expect(session.history.past.length).toBe(0);
  });

  it("9. SNAP ON +2000 exact", async () => {
    const session = selectViaTimeline(multiClipSession(), VIDEO_A);
    expect(session.project.snap).toBe(true);
    const preview = await autoTurn(session, GOLDEN_MOVE_PROMPT);
    const applied = applyHostApproved(preview, session);
    expect(applied.session.project.snap).toBe(true);
    expect(startOf(applied.session, VIDEO_A) - 10_000).toBe(2000);
    expect(applied.session.project.schemaVersion).toBe(5);
  });
});
