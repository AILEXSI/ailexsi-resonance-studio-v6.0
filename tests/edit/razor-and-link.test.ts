import { describe, expect, it } from "vitest";
import { applyCommand } from "../../src/app/commands";
import { dispatchEditorKey } from "../../src/app/keys";
import { createSession, type Session } from "../../src/app/session";
import { clipEndMs } from "../../src/core/models";
import { createMemoryBlobStore } from "../../src/core/persistence";
import { deserializeProject, serializeProject } from "../../src/core/project";
import { visualizerEventsOf } from "../../src/core/visualizer";
import { EDIT_MENU_ITEMS } from "../../src/ui/toolbar/EditMenu";
import { asset, clip, projectWith } from "../helpers";

function session(): Session {
  const base = createSession(createMemoryBlobStore());
  return {
    ...base,
    selectedClipId: "v1",
    selectedClipIds: ["v1", "a1"],
    project: {
      ...projectWith(
        [
          clip({
            id: "v1",
            assetId: "vid",
            trackId: "V1",
            startMs: 0,
            durationMs: 4000,
            sourceInMs: 0,
            sourceOutMs: 4000,
          }),
          clip({
            id: "a1",
            assetId: "aud",
            trackId: "A1",
            startMs: 0,
            durationMs: 4000,
            sourceInMs: 0,
            sourceOutMs: 4000,
          }),
          clip({
            id: "v2",
            assetId: "vid",
            trackId: "V1",
            startMs: 8000,
            durationMs: 2000,
            sourceInMs: 0,
            sourceOutMs: 2000,
          }),
        ],
        [
          asset({ id: "vid", kind: "video", durationMs: 60000 }),
          asset({ id: "aud", kind: "audio", durationMs: 60000 }),
        ],
      ),
      playheadMs: 1000,
      visualizer: {
        ...base.project.visualizer,
        events: [{ id: "ve1", sceneId: "spectrum-bars", startMs: 0, durationMs: 4000 }],
      },
    },
  };
}

describe("razor all and link", () => {
  it("keeps schema 5 when clips have no link", () => {
    const start = session();
    const raw = JSON.parse(serializeProject(start.project)) as {
      schemaVersion: number;
      clips: Array<Record<string, unknown>>;
    };
    expect(raw.schemaVersion).toBe(5);
    for (const item of raw.clips) delete item.linkId;
    const loaded = deserializeProject(JSON.stringify(raw));
    expect(loaded.schemaVersion).toBe(5);
    expect(loaded.clips.every((c) => c.linkId == null)).toBe(true);
  });

  it("cuts every track and the VIS event at the playhead in one undo", () => {
    const start = session();
    const next = applyCommand(start, { type: "razorAll" });
    expect(next.history.past).toHaveLength(1);
    expect(next.status).toBe("Razor all");
    const video = next.project.clips.filter((c) => c.trackId === "V1" && c.startMs < 8000);
    const audio = next.project.clips.filter((c) => c.trackId === "A1");
    expect(video.map((c) => c.startMs).sort((a, b) => a - b)).toEqual([0, 1000]);
    expect(audio.map((c) => c.startMs).sort((a, b) => a - b)).toEqual([0, 1000]);
    expect(video.reduce((sum, c) => sum + c.durationMs, 0)).toBe(4000);
    expect(audio.reduce((sum, c) => sum + c.durationMs, 0)).toBe(4000);
    const parked = next.project.clips.find((c) => c.id === "v2")!;
    expect(parked.startMs).toBe(8000);
    expect(parked.durationMs).toBe(2000);
    const events = visualizerEventsOf(next.project);
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.startMs).sort((a, b) => a - b)).toEqual([0, 1000]);
    const undone = applyCommand(next, { type: "undo" });
    expect(undone.project.clips).toHaveLength(3);
    expect(visualizerEventsOf(undone.project)).toHaveLength(1);
  });

  it("does not record history when nothing covers the playhead", () => {
    const start = session();
    start.project = {
      ...start.project,
      playheadMs: 6000,
      visualizer: {
        ...start.project.visualizer,
        events: [{ id: "ve1", sceneId: "spectrum-bars", startMs: 0, durationMs: 4000 }],
      },
    };
    const next = applyCommand(start, { type: "razorAll" });
    expect(next.history.past).toHaveLength(0);
    expect(next.error).toBe("Nothing to cut at the playhead");
    expect(next.project.clips).toHaveLength(3);
  });

  it("links one video and one audio, moves them together, then unlinks, each as one undo", () => {
    const start = session();
    const linked = applyCommand(
      { ...start, selectedClipIds: ["v1", "a1"], selectedClipId: "v1" },
      { type: "linkClips" },
    );
    expect(linked.history.past).toHaveLength(1);
    const video = linked.project.clips.find((c) => c.id === "v1")!;
    const audio = linked.project.clips.find((c) => c.id === "a1")!;
    expect(video.linkId).toBeTruthy();
    expect(video.linkId).toBe(audio.linkId);
    expect(linked.project.clips.find((c) => c.id === "v2")?.linkId).toBeUndefined();

    const again = applyCommand(linked, { type: "linkClips" });
    expect(again.history.past).toHaveLength(1);

    const swapped = applyCommand(
      {
        ...linked,
        selectedClipId: "v2",
        selectedClipIds: ["v2", "a1"],
        project: {
          ...linked.project,
          clips: [
            ...linked.project.clips,
            clip({
              id: "a2",
              assetId: "aud",
              trackId: "A2",
              startMs: 0,
              durationMs: 4000,
              sourceInMs: 0,
              sourceOutMs: 4000,
              linkId: "old-sound",
            }),
          ],
        },
      },
      { type: "linkClips" },
    );
    expect(swapped.history.past).toHaveLength(2);
    const picture = swapped.project.clips.find((c) => c.id === "v2")!;
    const sound = swapped.project.clips.find((c) => c.id === "a1")!;
    expect(picture.linkId).toBe(sound.linkId);
    expect(swapped.project.clips.find((c) => c.id === "v1")?.linkId).toBeUndefined();
    expect(swapped.project.clips.find((c) => c.id === "a2")?.linkId).toBe("old-sound");

    const moved = applyCommand(swapped, { type: "moveClips", clipIds: ["v2"], deltaMs: 500 });
    expect(moved.history.past).toHaveLength(3);
    expect(moved.project.clips.find((c) => c.id === "v2")?.startMs).toBe(8500);
    expect(moved.project.clips.find((c) => c.id === "a1")?.startMs).toBe(500);
    expect(moved.project.clips.find((c) => c.id === "v1")?.startMs).toBe(0);
    expect(clipEndMs(moved.project.clips.find((c) => c.id === "a1")!)).toBe(4500);

    const unlinked = applyCommand(
      { ...moved, selectedClipIds: ["v2", "a1"], selectedClipId: "v2" },
      { type: "unlinkSelection" },
    );
    expect(unlinked.history.past).toHaveLength(4);
    expect(unlinked.project.clips.find((c) => c.id === "v2")?.linkId).toBeUndefined();
    expect(unlinked.project.clips.find((c) => c.id === "a1")?.linkId).toBeUndefined();
    const undone = applyCommand(unlinked, { type: "undo" });
    expect(undone.project.clips.find((c) => c.id === "v2")?.linkId).toBe(picture.linkId);
  });

  it("routes B and Ctrl+L and lists razor, link, and unlink in the Edit menu", () => {
    const start = session();
    const cut = dispatchEditorKey(start, false, { key: "b" });
    expect(cut.type).toBe("session");
    if (cut.type !== "session") return;
    expect(cut.preventDefault).toBe(true);
    expect(cut.session.history.past).toHaveLength(1);
    expect(cut.session.project.clips.filter((c) => c.trackId === "A1")).toHaveLength(2);

    const linked = dispatchEditorKey(
      { ...start, selectedClipIds: ["v1", "a1"] },
      false,
      { key: "l", ctrlKey: true },
    );
    expect(linked.type).toBe("session");
    if (linked.type !== "session") return;
    const video = linked.session.project.clips.find((c) => c.id === "v1")!;
    expect(video.linkId).toBe(linked.session.project.clips.find((c) => c.id === "a1")?.linkId);

    const types = EDIT_MENU_ITEMS.map((item) => item.command.type);
    expect(types).toEqual(expect.arrayContaining(["razorAll", "linkClips", "unlinkSelection"]));
  });
});
