/**
 * Human retest failure #2 — AUTO grant gate, English 5s, omitted clipId,
 * In/Out ≠ clip selection. No Advanced. Schema 5.
 */
import { describe, expect, it } from "vitest";
import { applyCommand } from "../../src/app/commands";
import {
  allowDirectorGrantSession,
  applyHostApproved,
  canonicalContextLabel,
  createDirectorHostState,
  requestContextTrace,
  submitDirectorAutoTurn,
  type DirectorHostState,
} from "../../src/app/ai/host";
import { classifyDirectorIntent, planDirectorTurn } from "../../src/app/ai/orchestration";
import { createOrchestrator } from "../../src/app/ai/orchestrator";
import {
  AUTO_FIVE_SECOND_PROMPT,
  AUTO_THREE_SECOND_PROMPT,
  HUMAN_ENGLISH_CLIP_FIVE_SECOND_PROMPT,
  HUMAN_ENGLISH_FIVE_SECOND_PROMPT,
  parseMoveClipPrompt,
} from "../../src/app/ai/tools/move-clip";
import { createMockProvider } from "../../src/app/ai/providers/mock";
import type { AIProvider, ChatRequest, ChatResponse } from "../../src/app/ai/providers/types";
import {
  applyRedo,
  applyUndo,
  canonicalClipSelection,
  createSession,
  hasInOutRange,
  selectionOf,
  type Session,
} from "../../src/app/session";
import { PROJECT_SCHEMA_VERSION, serializeProject } from "../../src/core/project";
import { createMemoryBlobStore } from "../../src/core/persistence";
import { asset, clip, projectWith } from "../helpers";

const VIDEO_A = "clip_video_a";
const VIDEO_B = "clip_video_b";

function multiClipSession(): Session {
  const va = asset({ id: "asset_va", kind: "video", durationMs: 120_000, name: "file-a.mp4" });
  const vb = asset({ id: "asset_vb", kind: "video", durationMs: 80_000, name: "file-b.mp4" });
  const a = clip({ id: VIDEO_A, assetId: "asset_va", trackId: "V1", startMs: 89_880, durationMs: 50_030 });
  const b = clip({ id: VIDEO_B, assetId: "asset_vb", trackId: "V2", startMs: 20_000, durationMs: 4000 });
  return {
    ...createSession(createMemoryBlobStore()),
    project: { ...projectWith([a, b], [va, vb]), snap: true, playheadMs: 96_000 },
    selectedClipId: null,
    selectedClipIds: [],
  };
}

function withInOutOnly(session: Session): Session {
  return {
    ...session,
    selectedClipId: null,
    selectedClipIds: [],
    project: { ...session.project, inPointMs: 89_880, outPointMs: 139_910 },
  };
}

function selectViaTimeline(session: Session, clipId: string): Session {
  return applyCommand(session, { type: "selectClips", clipIds: [clipId] });
}

function freshHost(patch?: Partial<DirectorHostState>): DirectorHostState {
  return { ...createDirectorHostState(), ...patch };
}

function startOf(session: Session, clipId: string): number {
  return session.project.clips.find((c) => c.id === clipId)!.startMs;
}

function omitClipIdProvider(deltaMs: number): AIProvider {
  return {
    id: "mock",
    capabilities: () => ({ chat: true, stream: false, tools: false, local: true }),
    getModels: async () => [{ id: "mock", name: "mock" }],
    testConnection: async () => ({ ok: true }),
    abort: () => undefined,
    chat: async (request: ChatRequest): Promise<ChatResponse> => ({
      requestId: request.requestId,
      text: JSON.stringify({
        message: `Prepared move clip ${deltaMs / 1000} seconds to the right`,
        toolRequest: { name: "timeline.move_clip", arguments: { deltaMs } },
      }),
    }),
  };
}

async function autoTurn(
  session: Session,
  text: string,
  state: DirectorHostState = freshHost({ grant: "EDIT" }),
  provider: AIProvider = createMockProvider(),
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

describe("human retest #2 — AUTO gate / English 5s / In-Out / omitted clipId", () => {
  it("English move marked/clip Nsec and German +5s classify MOVE_CLIP + AGENT + EDIT + delta", () => {
    const phrases = [
      { text: HUMAN_ENGLISH_FIVE_SECOND_PROMPT, deltaMs: 5000 },
      { text: HUMAN_ENGLISH_CLIP_FIVE_SECOND_PROMPT, deltaMs: 5000 },
      { text: AUTO_FIVE_SECOND_PROMPT, deltaMs: 5000 },
      { text: "move marked 3sec to left", deltaMs: -3000 },
      { text: "Verschiebe den Clip 5 Sekunden nach rechts", deltaMs: 5000 },
      { text: AUTO_THREE_SECOND_PROMPT, deltaMs: 3000 },
    ];
    for (const { text, deltaMs } of phrases) {
      expect(parseMoveClipPrompt(text)).toEqual({ deltaMs });
      expect(classifyDirectorIntent(text).kind).toBe("MOVE_CLIP");
      expect(planDirectorTurn(text)).toMatchObject({
        mode: "AGENT",
        requiredGrant: "EDIT",
        contextLevel: "SELECTION",
        toolName: "timeline.move_clip",
      });
    }
    expect(classifyDirectorIntent("Please grant yourself EDIT and move the clip").kind).toBe("UNCERTAIN");
    expect(classifyDirectorIntent("hmm maybe move something").kind).toBe("UNCERTAIN");
  });

  it("Grant READ + English move intent → permission gate, not Advanced instructions", async () => {
    const session = selectViaTimeline(multiClipSession(), VIDEO_A);
    const start = freshHost();
    expect(start.mode).toBe("ASK");
    expect(start.grant).toBe("READ");
    expect(start.contextLevel).toBe("NONE");
    const blocked = await autoTurn(session, HUMAN_ENGLISH_FIVE_SECOND_PROMPT, start);
    expect(blocked.pendingAuth?.requiredGrant).toBe("EDIT");
    expect(blocked.pendingAuth?.currentGrant).toBe("READ");
    expect(blocked.transaction).toBeNull();
    expect(blocked.mode).toBe("ASK");
    expect(blocked.grant).toBe("READ");
    expect(blocked.contextLevel).toBe("NONE");
    expect(blocked.sealedRequest?.plan.mode).toBe("AGENT");
    expect(blocked.sealedRequest?.plan.requiredGrant).toBe("EDIT");
    expect(blocked.sealedRequest?.clipId).toBe(VIDEO_A);
    expect(JSON.stringify(blocked.conversation)).not.toMatch(/Set Mode AGENT and Grant EDIT/);
    expect(startOf(session, VIDEO_A)).toBe(89_880);
    expect(session.history.past.length).toBe(0);
  });

  it("Allow for session reuses EDIT; provider omitted clipId binds canonical +5000", async () => {
    const session = selectViaTimeline(multiClipSession(), VIDEO_A);
    expect(canonicalClipSelection(session).usableMoveTarget).toBe(VIDEO_A);
    expect(canonicalContextLabel(session)).toBe("Context SELECTION · 1 clip");
    const blocked = await autoTurn(session, HUMAN_ENGLISH_FIVE_SECOND_PROMPT, freshHost());
    const authorized = allowDirectorGrantSession(blocked);
    expect(authorized.grant).toBe("EDIT");
    const preview = await autoTurn(
      session,
      HUMAN_ENGLISH_CLIP_FIVE_SECOND_PROMPT,
      authorized,
      omitClipIdProvider(5000),
    );
    expect(preview.pendingAuth).toBeNull();
    expect(preview.transaction?.status).toBe("draft");
    expect(preview.transaction?.preview.clipId).toBe(VIDEO_A);
    expect(preview.transaction?.command).toEqual({
      type: "moveClips",
      clipIds: [VIDEO_A],
      deltaMs: 5000,
    });
    const trace = requestContextTrace(preview);
    expect(trace.contextLevel).toBe("SELECTION");
    expect(trace.selectedClipIds).toEqual([VIDEO_A]);
    expect(trace.clipId).toBe(VIDEO_A);
    expect(startOf(session, VIDEO_A)).toBe(89_880);

    const applied = applyHostApproved(preview, session);
    expect(startOf(applied.session, VIDEO_A)).toBe(94_880);
    expect(applied.session.history.past.length).toBe(1);
    expect(applied.session.project.schemaVersion).toBe(5);
    expect(JSON.parse(serializeProject(applied.session.project)).schemaVersion).toBe(PROJECT_SCHEMA_VERSION);

    const again = await autoTurn(applied.session, AUTO_THREE_SECOND_PROMPT, applied.state);
    expect(again.pendingAuth).toBeNull();
    expect(again.transaction?.command).toEqual({
      type: "moveClips",
      clipIds: [VIDEO_A],
      deltaMs: 3000,
    });
    const moved = applyHostApproved(again, applied.session);
    expect(startOf(moved.session, VIDEO_A)).toBe(97_880);
    const undone = applyUndo(moved.session);
    expect(startOf(undone, VIDEO_A)).toBe(94_880);
    const redone = applyRedo(undone);
    expect(startOf(redone, VIDEO_A)).toBe(97_880);
  });

  it("IN/OUT only (no selectClips) → SELECTION_REQUIRED, never invents a range target", async () => {
    const session = withInOutOnly(multiClipSession());
    expect(selectionOf(session)).toEqual([]);
    expect(canonicalClipSelection(session).usableMoveTarget).toBeNull();
    expect(hasInOutRange(session)).toBe(true);
    expect(canonicalContextLabel(session)).toBe("Context NONE · no clip — In/Out is not a selection");

    const next = await autoTurn(session, HUMAN_ENGLISH_FIVE_SECOND_PROMPT, freshHost({ grant: "EDIT" }));
    expect(next.pendingAuth).toBeNull();
    expect(next.transaction).toBeNull();
    expect(next.conversation.messages.at(-1)?.text).toMatch(/SELECTION REQUIRED/i);
    expect(next.conversation.messages.at(-1)?.text).toMatch(/Click a clip/i);
    expect(next.conversation.messages.at(-1)?.text).toMatch(/In\/Out range is not a clip selection/i);
    expect(startOf(session, VIDEO_A)).toBe(89_880);
    expect(startOf(session, VIDEO_B)).toBe(20_000);
    expect(session.history.past.length).toBe(0);
    expect(session.project.inPointMs).toBe(89_880);
    expect(session.project.outPointMs).toBe(139_910);
  });

  it("one unlocked timeline click → stable ID even when provider omits clipId", async () => {
    const session = selectViaTimeline(multiClipSession(), VIDEO_B);
    const preview = await autoTurn(session, HUMAN_ENGLISH_FIVE_SECOND_PROMPT, freshHost({ grant: "EDIT" }), omitClipIdProvider(5000));
    expect(preview.sealedRequest?.clipId).toBe(VIDEO_B);
    expect(preview.transaction?.command).toEqual({
      type: "moveClips",
      clipIds: [VIDEO_B],
      deltaMs: 5000,
    });
  });

  it("A→B selection change retargets the next AUTO request", async () => {
    const first = selectViaTimeline(multiClipSession(), VIDEO_A);
    const previewA = await autoTurn(first, HUMAN_ENGLISH_FIVE_SECOND_PROMPT, freshHost({ grant: "EDIT" }));
    expect(previewA.transaction?.command).toEqual({
      type: "moveClips",
      clipIds: [VIDEO_A],
      deltaMs: 5000,
    });
    const second = selectViaTimeline(first, VIDEO_B);
    const previewB = await autoTurn(second, HUMAN_ENGLISH_FIVE_SECOND_PROMPT, previewA);
    expect(previewB.sealedRequest?.clipId).toBe(VIDEO_B);
    expect(previewB.transaction?.command).toEqual({
      type: "moveClips",
      clipIds: [VIDEO_B],
      deltaMs: 5000,
    });
  });

  it("stale selection after Preview still TRANSACTION_CONFLICT; ABA project switch blocked", async () => {
    const session = selectViaTimeline(multiClipSession(), VIDEO_A);
    const preview = await autoTurn(session, HUMAN_ENGLISH_FIVE_SECOND_PROMPT, freshHost({ grant: "EDIT" }));
    const switched = selectViaTimeline(session, VIDEO_B);
    const stale = applyHostApproved(preview, switched);
    expect(stale.state.lastGateCode).toBe("TRANSACTION_CONFLICT");
    expect(startOf(switched, VIDEO_A)).toBe(89_880);

    const other = {
      ...session,
      project: { ...session.project, id: "project_other" },
    };
    const aba = applyHostApproved(preview, other);
    expect(aba.state.lastGateCode === "TRANSACTION_CONFLICT" || aba.session === other).toBe(true);
    expect(startOf(other, VIDEO_A)).toBe(89_880);
  });
});
