/**
 * Human retest repair — canonical selection is Session via selectClips / selectionOf.
 * Dropdown SELECTION is never a substitute. No second selection store.
 */
import { describe, expect, it } from "vitest";
import { applyCommand } from "../../src/app/commands";
import {
  applyUndo,
  applyRedo,
  canonicalClipSelection,
  createSession,
  newProject,
  selectionOf,
  type Session,
} from "../../src/app/session";
import {
  applyHostApproved,
  canonicalContextLabel,
  createDirectorHostState,
  requestContextTrace,
  submitDirectorAutoTurn,
  type DirectorHostState,
} from "../../src/app/ai/host";
import { DIRECTOR_RESPONSE_CONTRACT_PROMPT } from "../../src/app/ai/contract";
import { createOrchestrator } from "../../src/app/ai/orchestrator";
import { AUTO_THREE_SECOND_PROMPT } from "../../src/app/ai/tools/move-clip";
import { createMockProvider } from "../../src/app/ai/providers/mock";
import type { AIProvider } from "../../src/app/ai/providers/types";
import { PROJECT_SCHEMA_VERSION, serializeProject } from "../../src/core/project";
import { createMemoryBlobStore } from "../../src/core/persistence";
import { asset, clip, projectWith } from "../helpers";

const VIDEO_A = "clip_video_a";
const VIDEO_B = "clip_video_b";

function multiClipSession(): Session {
  const va = asset({ id: "asset_va", kind: "video", durationMs: 8000, name: "file-a.mp4" });
  const vb = asset({ id: "asset_vb", kind: "video", durationMs: 8000, name: "file-b.mp4" });
  const a = clip({ id: VIDEO_A, assetId: "asset_va", trackId: "V1", startMs: 10_000, durationMs: 4000 });
  const b = clip({ id: VIDEO_B, assetId: "asset_vb", trackId: "V2", startMs: 20_000, durationMs: 4000 });
  return {
    ...createSession(createMemoryBlobStore()),
    project: { ...projectWith([a, b], [va, vb]), snap: true, playheadMs: 11_000 },
    selectedClipId: null,
    selectedClipIds: [],
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

describe("canonical selection — AUTO context (A–F + 12/12)", () => {
  it("A: one canonical timeline clip → AUTO resolves the same stable ID", async () => {
    const session = selectViaTimeline(multiClipSession(), VIDEO_B);
    expect(selectionOf(session)).toEqual([VIDEO_B]);
    expect(canonicalClipSelection(session).usableMoveTarget).toBe(VIDEO_B);
    expect(canonicalContextLabel(session)).toBe("Context SELECTION · 1 clip");

    const preview = await autoTurn(session, AUTO_THREE_SECOND_PROMPT);
    const trace = requestContextTrace(preview);
    expect(trace.selectedClipIds).toEqual([VIDEO_B]);
    expect(trace.clipId).toBe(VIDEO_B);
    expect(preview.sealedRequest?.canonicalClipIds).toEqual([VIDEO_B]);
    expect(preview.sealedRequest?.clipId).toBe(VIDEO_B);
    expect(preview.transaction?.command).toEqual({
      type: "moveClips",
      clipIds: [VIDEO_B],
      deltaMs: 3000,
    });
    expect(startOf(session, VIDEO_B)).toBe(20_000);
  });

  it("B: dropdown/effective SELECTION but canonical empty → SELECTION_REQUIRED", async () => {
    const session = multiClipSession();
    expect(selectionOf(session)).toEqual([]);
    const masquerade = freshHost({
      grant: "EDIT",
      mode: "AGENT",
      modeLabel: "Mode: AGENT",
      contextLevel: "SELECTION",
      contextLabel: "Context: SELECTION",
    });
    const next = await autoTurn(session, AUTO_THREE_SECOND_PROMPT, masquerade);
    expect(next.transaction).toBeNull();
    expect(next.conversation.messages.at(-1)?.text).toMatch(/SELECTION REQUIRED|No clip selected/i);
    expect(next.conversation.messages.at(-1)?.text).not.toMatch(
      /Denied: Context SELECTION is required/,
    );
    expect(startOf(session, VIDEO_A)).toBe(10_000);
    expect(session.history.past.length).toBe(0);
  });

  it("C: selection A→B → next request targets B, not stale A", async () => {
    const first = selectViaTimeline(multiClipSession(), VIDEO_A);
    const previewA = await autoTurn(first, AUTO_THREE_SECOND_PROMPT);
    expect(previewA.transaction?.command).toEqual({
      type: "moveClips",
      clipIds: [VIDEO_A],
      deltaMs: 3000,
    });
    const second = selectViaTimeline(first, VIDEO_B);
    const previewB = await autoTurn(second, AUTO_THREE_SECOND_PROMPT, previewA);
    expect(previewB.sealedRequest?.clipId).toBe(VIDEO_B);
    expect(previewB.transaction?.command).toEqual({
      type: "moveClips",
      clipIds: [VIDEO_B],
      deltaMs: 3000,
    });
  });

  it("D: selected clip removed before txn → fail closed", async () => {
    const session = selectViaTimeline(multiClipSession(), VIDEO_A);
    const gone = {
      ...session,
      project: { ...session.project, clips: session.project.clips.filter((c) => c.id !== VIDEO_A) },
    };
    expect(canonicalClipSelection(gone).clipIds).toEqual([]);
    const next = await autoTurn(gone, AUTO_THREE_SECOND_PROMPT);
    expect(next.transaction).toBeNull();
    expect(next.conversation.messages.at(-1)?.text).toMatch(/SELECTION REQUIRED|No clip selected/i);
    expect(gone.history.past.length).toBe(0);
  });

  it("E: selection changes after Preview before Apply → stale protection", async () => {
    const session = selectViaTimeline(multiClipSession(), VIDEO_A);
    const preview = await autoTurn(session, AUTO_THREE_SECOND_PROMPT);
    expect(preview.transaction?.status).toBe("draft");
    const switched = selectViaTimeline(session, VIDEO_B);
    const approved = applyHostApproved(preview, switched);
    expect(approved.state.lastGateCode).toBe("TRANSACTION_CONFLICT");
    expect(startOf(approved.session, VIDEO_A)).toBe(10_000);
    expect(startOf(approved.session, VIDEO_B)).toBe(20_000);
    expect(switched.history.past.length).toBe(0);
  });

  it("F: project switch same clip ID → ABA protection", async () => {
    const session = selectViaTimeline(multiClipSession(), VIDEO_A);
    const preview = await autoTurn(session, AUTO_THREE_SECOND_PROMPT);
    const other = newProject(session);
    const switched = {
      ...other,
      project: { ...other.project, id: "project_other", clips: session.project.clips, assets: session.project.assets },
      selectedClipId: VIDEO_A,
      selectedClipIds: [VIDEO_A],
    };
    const approved = applyHostApproved(preview, switched);
    expect(approved.state.lastGateCode === "TRANSACTION_CONFLICT" || approved.session === switched).toBe(true);
    expect(approved.session.project.id).toBe("project_other");
    expect(startOf(switched, VIDEO_A)).toBe(10_000);
  });

  it("AUTO does not require manual AGENT / EDIT / SELECTION dropdowns; session EDIT is enough", async () => {
    const session = selectViaTimeline(multiClipSession(), VIDEO_A);
    const start = freshHost();
    expect(start.mode).toBe("ASK");
    expect(start.grant).toBe("READ");
    expect(start.contextLevel).toBe("NONE");
    const blocked = await autoTurn(session, AUTO_THREE_SECOND_PROMPT, start);
    expect(blocked.pendingAuth?.requiredGrant).toBe("EDIT");
    expect(blocked.mode).toBe("ASK");
    expect(blocked.contextLevel).toBe("NONE");
    const authorized = { ...blocked, grant: "EDIT" as const, pendingAuth: null, heldUserText: null };
    const preview = await autoTurn(session, AUTO_THREE_SECOND_PROMPT, authorized);
    expect(preview.mode).toBe("ASK");
    expect(preview.contextLevel).toBe("NONE");
    expect(preview.transaction?.command).toEqual({
      type: "moveClips",
      clipIds: [VIDEO_A],
      deltaMs: 3000,
    });
    expect(startOf(session, VIDEO_A)).toBe(10_000);
  });

  it("12/12 human golden-path AUTO +3000 with snap ON", async () => {
    const results: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      const session = selectViaTimeline(multiClipSession(), VIDEO_B);
      expect(session.project.snap).toBe(true);
      const preview = await autoTurn(session, AUTO_THREE_SECOND_PROMPT);
      expect(preview.conversation.messages.some((m) => /moved|done|completed|changed/i.test(m.text))).toBe(
        false,
      );
      expect(preview.transaction?.command).toEqual({
        type: "moveClips",
        clipIds: [VIDEO_B],
        deltaMs: 3000,
      });
      expect(startOf(session, VIDEO_B)).toBe(20_000);
      const applied = applyHostApproved(preview, session);
      expect(startOf(applied.session, VIDEO_B)).toBe(23_000);
      const undone = applyUndo(applied.session);
      expect(startOf(undone, VIDEO_B)).toBe(20_000);
      const redone = applyRedo(undone);
      expect(startOf(redone, VIDEO_B)).toBe(23_000);
      expect(redone.project.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
      expect(JSON.parse(serializeProject(redone.project)).schemaVersion).toBe(5);
      results.push(startOf(applied.session, VIDEO_B));
    }
    expect(results).toEqual(Array.from({ length: 12 }, () => 23_000));
  });

  it("provider contract forbids claiming execution before Apply", () => {
    expect(DIRECTOR_RESPONSE_CONTRACT_PROMPT).toMatch(/Prepared move/);
    expect(DIRECTOR_RESPONSE_CONTRACT_PROMPT).toMatch(/Never say moved, done, completed, or changed/);
  });
});
