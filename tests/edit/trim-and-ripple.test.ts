import { describe, expect, it } from "vitest";
import { acceptTransaction, proposeTransaction } from "../../src/app/ai/transactions";
import { planMutation } from "../../src/app/ai/tools/mutate";
import { applyCommand } from "../../src/app/commands";
import { dispatchEditorKey } from "../../src/app/keys";
import { createSession } from "../../src/app/session";
import { trimClip } from "../../src/core/timeline";
import { createMemoryBlobStore } from "../../src/core/persistence";
import { asset, clip, projectWith } from "../helpers";

function session() {
  const base = createSession(createMemoryBlobStore());
  return {
    ...base,
    selectedClipId: "c1",
    selectedClipIds: ["c1"],
    project: {
      ...projectWith(
        [
          clip({ id: "c1", assetId: "a", trackId: "A1", startMs: 0, durationMs: 4000, sourceOutMs: 4000 }),
          clip({ id: "c2", assetId: "a", trackId: "A1", startMs: 5000, durationMs: 2000, sourceOutMs: 2000 }),
        ],
        [asset({ id: "a", kind: "audio", durationMs: 60000 })],
      ),
      snap: true,
      playheadMs: 1000,
      markers: [{ id: "m1", timeMs: 1500, label: "cue" }],
    },
  };
}

describe("trim to playhead and ripple delete", () => {
  it("snaps a lift trim to a nearby marker", () => {
    const project = session().project;
    const trimmed = trimClip(project, "c1", "out", 1560);
    expect(trimmed.error).toBeUndefined();
    expect(trimmed.project.clips.find((c) => c.id === "c1")?.durationMs).toBe(1500);
  });

  it("trims the selected edge to the playhead as one undo", () => {
    const start = session();
    const next = applyCommand(start, { type: "trimToPlayhead", edge: "out" });
    expect(next.history.past).toHaveLength(start.history.past.length + 1);
    expect(next.project.clips.find((c) => c.id === "c1")?.durationMs).toBe(1000);
    expect(next.project.clips.find((c) => c.id === "c2")?.startMs).toBe(5000);
  });

  it("closes the gap on ripple delete and keeps lift delete from moving the neighbor", () => {
    const start = session();
    const lifted = applyCommand(start, { type: "liftDelete" });
    expect(lifted.project.clips.find((c) => c.id === "c2")?.startMs).toBe(5000);
    const rippled = applyCommand(start, { type: "rippleDelete" });
    expect(rippled.project.clips.find((c) => c.id === "c1")).toBeUndefined();
    expect(rippled.project.clips.find((c) => c.id === "c2")?.startMs).toBe(1000);
    expect(rippled.history.past).toHaveLength(1);
  });

  it("routes [ and ] to trim in and out", () => {
    const start = session();
    const out = dispatchEditorKey(start, false, { key: "]", code: "BracketRight" });
    expect(out.type).toBe("session");
    if (out.type !== "session") return;
    expect(out.session.project.clips.find((c) => c.id === "c1")?.durationMs).toBe(1000);
  });

  it("proposes trim and ripple delete without editing until accept", () => {
    const start = session();
    const before = structuredClone(start.project);
    const trim = planMutation(start, "timeline.trim", { edge: "out", targetEdgeMs: 2000 });
    expect(trim.ok).toBe(true);
    if (!trim.ok) return;
    expect(start.project).toEqual(before);
    const txn = proposeTransaction(start, trim.data, "trim");
    const accepted = acceptTransaction(start, txn);
    expect(accepted.error).toBeUndefined();
    expect(accepted.session.history.past).toHaveLength(1);
    expect(accepted.session.project.clips.find((c) => c.id === "c1")?.durationMs).toBe(2000);

    const ripple = planMutation(start, "timeline.ripple_delete", {});
    expect(ripple.ok).toBe(true);
    if (!ripple.ok) return;
    const rippled = acceptTransaction(start, proposeTransaction(start, ripple.data, "ripple"));
    expect(rippled.session.history.past).toHaveLength(1);
    expect(rippled.session.project.clips.find((c) => c.id === "c2")?.startMs).toBe(1000);
  });
});
