import { describe, expect, it } from "vitest";
import { applyCommand } from "../../src/app/commands";
import { dispatchEditorKey } from "../../src/app/keys";
import { createSession } from "../../src/app/session";
import { createMemoryBlobStore } from "../../src/core/persistence";
import { SHORTCUT_ROWS } from "../../src/ui/shortcuts/labels";
import { EDIT_MENU_ITEMS } from "../../src/ui/toolbar/EditMenu";
import { asset, clip, projectWith } from "../helpers";

function session() {
  const base = createSession(createMemoryBlobStore());
  return {
    ...base,
    selectedClipId: "c1",
    selectedClipIds: ["c1", "c2"],
    project: {
      ...projectWith(
        [
          clip({ id: "c1", assetId: "a", trackId: "A1", startMs: 0, durationMs: 1000, sourceOutMs: 1000 }),
          clip({ id: "c2", assetId: "a", trackId: "A1", startMs: 3000, durationMs: 1000, sourceOutMs: 1000 }),
        ],
        [asset({ id: "a", kind: "audio", durationMs: 60000 })],
      ),
      playheadMs: 8000,
    },
  };
}

describe("clipboard and multi-select", () => {
  it("lists copy, paste, duplicate, and select all in the Edit menu", () => {
    const types = EDIT_MENU_ITEMS.map((item) => item.command.type);
    expect(types).toEqual(expect.arrayContaining(["copy", "paste", "duplicate", "selectAll"]));
    const help = SHORTCUT_ROWS.map((row) => row.action).join("\n");
    expect(help).toContain("Select the range of clips on that track");
    expect(help).toContain("Marquee-select clips");
    expect(help).toContain("Paste clip(s) at playhead");
  });

  it("moves every selected clip in one undo step", () => {
    const start = session();
    const next = applyCommand(start, { type: "moveClips", clipIds: ["c1", "c2"], deltaMs: 500 });
    expect(next.history.past).toHaveLength(1);
    expect(next.project.clips.find((c) => c.id === "c1")?.startMs).toBe(500);
    expect(next.project.clips.find((c) => c.id === "c2")?.startMs).toBe(3500);
    const undone = applyCommand(next, { type: "undo" });
    expect(undone.project.clips.find((c) => c.id === "c1")?.startMs).toBe(0);
    expect(undone.project.clips.find((c) => c.id === "c2")?.startMs).toBe(3000);
  });

  it("lift-deletes every selected clip in one undo step", () => {
    const start = session();
    const next = applyCommand(start, { type: "liftDelete" });
    expect(next.project.clips).toHaveLength(0);
    expect(next.history.past).toHaveLength(1);
  });

  it("copies without history and pastes the selection at the playhead as one undo", () => {
    const start = session();
    const copied = applyCommand(start, { type: "copy" });
    expect(copied.history.past).toHaveLength(0);
    expect(copied.clipboard).toHaveLength(2);
    const pasted = applyCommand(copied, { type: "paste" });
    expect(pasted.history.past).toHaveLength(1);
    expect(pasted.project.clips).toHaveLength(4);
    const added = pasted.project.clips.filter((c) => c.id !== "c1" && c.id !== "c2");
    expect(added.map((c) => c.startMs).sort((a, b) => a - b)).toEqual([8000, 11000]);
  });

  it("duplicates the selection at the playhead with Ctrl+D as one undo", () => {
    const start = session();
    const out = dispatchEditorKey(start, false, { key: "d", ctrlKey: true });
    expect(out.type).toBe("session");
    if (out.type !== "session") return;
    expect(out.session.history.past).toHaveLength(1);
    expect(out.session.project.clips).toHaveLength(4);
    expect(out.session.clipboard).toHaveLength(0);
  });
});
