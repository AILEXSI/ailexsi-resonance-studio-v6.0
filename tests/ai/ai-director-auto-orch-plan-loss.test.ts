/**
 * Human regression: Auto-Orchestration plan loss.
 * Selected video clip. Manual UI ASK / DRAFT / NONE.
 * Prompt: "Verschiebe den Clip zwei Sekunden nach rechts"
 * Provider returns timeline.move_clip (local-openai-compatible behavior).
 *
 * MUST FAIL on Foundation HEAD 4bec8a5 before the request-scoped plan repair.
 */
import { describe, expect, it } from "vitest";
import { createSession, type Session } from "../../src/app/session";
import {
  allowDirectorGrantOnce,
  applyHostApproved,
  createDirectorHostState,
  submitDirectorAutoTurn,
  type DirectorHostState,
} from "../../src/app/ai/host";
import { planDirectorTurn } from "../../src/app/ai/orchestration";
import { createOrchestrator } from "../../src/app/ai/orchestrator";
import { DIRECTOR_MUTATING_TOOL } from "../../src/app/ai/contract";
import type { AIProvider, ChatRequest, ChatResponse } from "../../src/app/ai/providers/types";
import { createMemoryBlobStore } from "../../src/core/persistence";
import { asset, clip, projectWith } from "../helpers";

/** Exact human prompt that failed in the studio. Not the golden "markierten" / "exakt" phrase. */
export const HUMAN_MOVE_PROMPT = "Verschiebe den Clip zwei Sekunden nach rechts";

const SELECTION_DENIED = "Denied: Context SELECTION is required to move a clip. No project changes were made.";

function selectedVideo(): Session {
  const a = asset({ id: "asset_vid", kind: "video", durationMs: 8000, name: "user-video.mp4" });
  const c = clip({
    id: "clip_video",
    assetId: "asset_vid",
    trackId: "V1",
    startMs: 30_000,
    durationMs: 2000,
  });
  return {
    ...createSession(createMemoryBlobStore()),
    project: { ...projectWith([c], [a]), snap: true, playheadMs: 31_000 },
    selectedClipId: "clip_video",
    selectedClipIds: ["clip_video"],
  };
}

/** Manual defaults as observed: Mode ASK, Grant DRAFT, Context NONE. Advanced so UI is not auto-written. */
function manualAskDraftNone(): DirectorHostState {
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
  };
}

/** Local LLM behavior: still emits timeline.move_clip for the human move phrase. */
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

async function autoTurn(session: Session, state: DirectorHostState, text: string): Promise<DirectorHostState> {
  return submitDirectorAutoTurn(
    state,
    text,
    { provider: localMoveProvider(), orchestrator: createOrchestrator() },
    undefined,
    session,
    { providerInjected: true },
  );
}

describe("AI Director auto-orchestration human regression — plan loss", () => {
  it("A. selected clip + ASK/DRAFT/NONE + human move prompt plans AGENT/SELECTION/EDIT and must not deny SELECTION", async () => {
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
  });
});
