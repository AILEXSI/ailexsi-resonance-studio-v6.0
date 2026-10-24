import { describe, expect, it, vi } from "vitest";
import { applyCommand } from "../../src/app/commands";
import { dispatchTool } from "../../src/app/ai/orchestrator";
import { assertToolAllowed } from "../../src/app/ai/permissions";
import { acceptTransaction, rejectTransaction } from "../../src/app/ai/transactions";
import { createSession, type Session } from "../../src/app/session";
import { createMemoryBlobStore } from "../../src/core/persistence";
import { serializeProject } from "../../src/core/project";
import { asset, clip, projectWith } from "../helpers";

function sessionAt(startMs: number, opts?: { locked?: boolean }): Session {
  const base = createSession(createMemoryBlobStore());
  return {
    ...base,
    selectedClipId: "c1",
    selectedClipIds: ["c1"],
    project: {
      ...projectWith(
        [
          clip({
            id: "c1",
            assetId: "a",
            trackId: "A1",
            startMs,
            durationMs: 8000,
            locked: opts?.locked,
            linkId: "link_1",
          }),
          clip({ id: "c2", assetId: "v", trackId: "V1", startMs, durationMs: 8000, linkId: "link_1" }),
        ],
        [
          asset({ id: "a", kind: "audio", durationMs: 60000, sourcePath: "/secret/song.wav" }),
          asset({ id: "v", kind: "video", durationMs: 60000 }),
        ],
      ),
      snap: true,
      markers: [{ id: "mk_near", timeMs: startMs + 1000, label: "near" }],
    },
  };
}

function startOf(session: Session, id = "c1"): number {
  return session.project.clips.find((c) => c.id === id)!.startMs;
}

describe("AI-4 transactions", () => {
  it("moves the selected clip exactly 2000 ms, then one undo restores it", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const session = sessionAt(30000);
    const dispatched = dispatchTool(session, "timeline.move_clip", { deltaSeconds: 2 }, "move 2s");
    expect(dispatched.kind).toBe("proposal");
    if (dispatched.kind !== "proposal") return;
    expect(dispatched.transaction.status).toBe("proposed");
    expect(startOf(session)).toBe(30000);
    expect(session.history.past).toHaveLength(0);

    const accepted = acceptTransaction(session, dispatched.transaction);
    expect(accepted.error).toBeUndefined();
    expect(accepted.transaction.statuses).toEqual(["proposed", "accepted", "executed"]);
    expect(accepted.transaction.status).toBe("executed");
    expect(startOf(accepted.session)).toBe(32000);
    expect(startOf(accepted.session, "c2")).toBe(32000);
    expect(accepted.session.history.past).toHaveLength(1);
    expect(accepted.session.project.schemaVersion).toBe(5);
    expect(serializeProject(accepted.session.project)).not.toContain(accepted.transaction.id);
    expect(serializeProject(accepted.session.project)).not.toContain("Exact move");
    expect(fetchSpy).not.toHaveBeenCalled();

    const undone = applyCommand(accepted.session, { type: "undo" });
    expect(startOf(undone)).toBe(30000);
    expect(startOf(undone, "c2")).toBe(30000);
    const redone = applyCommand(undone, { type: "redo" });
    expect(startOf(redone)).toBe(32000);
    vi.unstubAllGlobals();
  });

  it("keeps +2000 ms exact across 12 fresh runs and 12 chained runs", () => {
    for (let run = 0; run < 12; run += 1) {
      const session = sessionAt(30000);
      const dispatched = dispatchTool(session, "timeline.move_clip", { deltaMs: 2000 }, "run");
      if (dispatched.kind !== "proposal") throw new Error("expected proposal");
      const accepted = acceptTransaction(session, dispatched.transaction);
      expect(startOf(accepted.session) - 30000).toBe(2000);
    }
    let chained = sessionAt(30000);
    for (let run = 0; run < 12; run += 1) {
      const dispatched = dispatchTool(chained, "timeline.move_clip", { deltaMs: 2000 }, "chain");
      if (dispatched.kind !== "proposal") throw new Error("expected proposal");
      chained = acceptTransaction(chained, dispatched.transaction).session;
    }
    expect(startOf(chained)).toBe(30000 + 12 * 2000);
    for (let run = 0; run < 12; run += 1) chained = applyCommand(chained, { type: "undo" });
    expect(startOf(chained)).toBe(30000);
  });

  it("rejects without a history push and fails closed on a stale project", () => {
    const session = sessionAt(30000);
    const dispatched = dispatchTool(session, "timeline.move_clip", { deltaMs: 2000 }, "move");
    if (dispatched.kind !== "proposal") throw new Error("expected proposal");
    const rejected = rejectTransaction(session, dispatched.transaction);
    expect(rejected.transaction.status).toBe("rejected");
    expect(rejected.session).toBe(session);
    expect(startOf(rejected.session)).toBe(30000);
    expect(rejected.session.history.past).toHaveLength(0);

    const human = applyCommand(session, { type: "nudgeClip", deltaMs: 40 });
    const conflict = acceptTransaction(human, dispatched.transaction);
    expect(conflict.error).toBe("TRANSACTION_CONFLICT");
    expect(conflict.session).toBe(human);
    expect(conflict.transaction.status).toBe("proposed");
  });

  it("does not execute a locked clip, a denied tool, or undo", () => {
    const locked = sessionAt(30000, { locked: true });
    expect(dispatchTool(locked, "timeline.move_clip", { deltaMs: 2000 }, "move")).toMatchObject({
      kind: "error",
      error: "Clip is locked",
    });
    expect(locked.history.past).toHaveLength(0);
    expect(assertToolAllowed("history.undo", ["history.undo"])).toMatchObject({
      ok: false,
      code: "TOOL_DENIED",
    });
    expect(dispatchTool(sessionAt(30000), "timeline.move_clip", { deltaMs: 2000 }, "move", [])).toMatchObject({
      kind: "error",
      code: "TOOL_DENIED",
    });
    const read = dispatchTool(sessionAt(30000), "get_selection", undefined, "look");
    expect(read.kind).toBe("read");
    if (read.kind !== "read" || !read.result.ok) return;
    expect(read.result.data).toMatchObject({ clipIds: ["c1"] });
  });
});
