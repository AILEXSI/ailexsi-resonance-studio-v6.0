import { describe, expect, it } from "vitest";
import { applyCommand } from "../../src/app/commands";
import { applyCopy, applySetVisualizer, createSession, type Session } from "../../src/app/session";
import { FRAME_MS } from "../../src/core/models";
import { createMemoryBlobStore } from "../../src/core/persistence";
import { createEmptyProject } from "../../src/core/project";
import {
  formatVisEventLabel,
  minVisEventDurationMs,
  splitVisualizerAtPlayhead,
  splitVisualizerEventAt,
  visualizerEventsOf,
} from "../../src/core/visualizer";
import { asset, clip, projectWith } from "../helpers";

function visSession(events: Session["project"]["visualizer"]["events"], extra: Partial<Session["project"]> = {}): Session {
  const project = createEmptyProject("VIS");
  project.visualizer = {
    ...project.visualizer,
    events,
  };
  project.snap = false;
  Object.assign(project, extra);
  return {
    ...createSession(createMemoryBlobStore()),
    project,
    selectedVis: true,
    selectedVisEventId: events?.[0]?.id ?? null,
  };
}

describe("VIS event edit ops", () => {
  it("moves startMs and keeps duration; history-worthy", () => {
    const start = visSession([{ id: "ve1", sceneId: "spectrum-bars", startMs: 1000, durationMs: 4000 }]);
    const next = applyCommand(start, { type: "moveVisEvent", eventId: "ve1", startMs: 2500 });
    expect(visualizerEventsOf(next.project)).toEqual([
      { id: "ve1", sceneId: "spectrum-bars", startMs: 2500, durationMs: 4000 },
    ]);
    expect(next.history.past.length).toBe(start.history.past.length + 1);
    expect(next.status).toBe("Moved VIS event");
    const undone = applyCommand(next, { type: "undo" });
    expect(visualizerEventsOf(undone.project)[0]!.startMs).toBe(1000);
  });

  it("stretches left and right edges; min duration is one frame", () => {
    const start = visSession([{ id: "ve1", sceneId: "pulse-orb", startMs: 1000, durationMs: 4000 }]);
    const left = applyCommand(start, { type: "stretchVisEvent", eventId: "ve1", edge: "in", nextEdgeMs: 1500 });
    expect(visualizerEventsOf(left.project)[0]).toMatchObject({ startMs: 1500, durationMs: 3500 });
    const right = applyCommand(start, { type: "stretchVisEvent", eventId: "ve1", edge: "out", nextEdgeMs: 2200 });
    expect(visualizerEventsOf(right.project)[0]).toMatchObject({ startMs: 1000, durationMs: 1200 });
    const squeezed = applyCommand(start, {
      type: "stretchVisEvent",
      eventId: "ve1",
      edge: "out",
      nextEdgeMs: 1001,
    });
    expect(visualizerEventsOf(squeezed.project)[0]!.durationMs).toBe(minVisEventDurationMs());
    expect(minVisEventDurationMs()).toBe(Math.round(FRAME_MS));
  });

  it("copy+paste at playhead uses vis clipboard and a new id", () => {
    const start = visSession(
      [{ id: "ve1", sceneId: "lita-bloom", startMs: 200, durationMs: 800 }],
      { playheadMs: 5000 },
    );
    const copied = applyCommand(start, { type: "copy" });
    expect(copied.clipboard).toEqual([]);
    expect(copied.visClipboard).toEqual({ sceneId: "lita-bloom", durationMs: 800 });
    expect(copied.lastClipboardKind).toBe("vis");
    const pasted = applyCommand(copied, { type: "paste" });
    const events = visualizerEventsOf(pasted.project);
    expect(events).toHaveLength(2);
    const clone = events.find((e) => e.id !== "ve1")!;
    expect(clone.startMs).toBe(5000);
    expect(clone.durationMs).toBe(800);
    expect(clone.sceneId).toBe("lita-bloom");
    expect(pasted.selectedVisEventId).toBe(clone.id);
    expect(pasted.status).toBe("Pasted VIS event");
  });

  it("VIS paste snaps to nearby edges; playhead stays (P93)", () => {
    const start = visSession(
      [{ id: "ve1", sceneId: "lita-bloom", startMs: 200, durationMs: 800 }],
      {
        playheadMs: 2070,
        snap: true,
        markers: [{ id: "m1", timeMs: 2000, label: "M" }],
      },
    );
    const copied = applyCommand(start, { type: "copy" });
    const pasted = applyCommand(copied, { type: "paste" });
    const clone = visualizerEventsOf(pasted.project).find((e) => e.id !== "ve1")!;
    expect(clone.startMs).toBe(2000);
    expect(pasted.project.playheadMs).toBe(2070);
  });

  it("cut with the playhead inside a VIS block leaves two positive parts and one undo", () => {
    const start = visSession(
      [{ id: "ve1", sceneId: "resonance-wave", startMs: 0, durationMs: 480_000 }],
      { playheadMs: 225_000 },
    );
    const cut = applyCommand(start, { type: "cut" });
    expect(cut.error).toBeNull();
    expect(cut.status).toBe("Cut VIS event");
    expect(cut.history.past.length).toBe(start.history.past.length + 1);
    const events = visualizerEventsOf(cut.project).sort((a, b) => a.startMs - b.startMs);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      id: "ve1",
      sceneId: "resonance-wave",
      startMs: 0,
      durationMs: 225_000,
    });
    expect(events[1]).toMatchObject({
      sceneId: "resonance-wave",
      startMs: 225_000,
      durationMs: 255_000,
    });
    expect(events[0]!.durationMs).toBeGreaterThan(0);
    expect(events[1]!.durationMs).toBeGreaterThan(0);
    const undone = applyCommand(cut, { type: "undo" });
    expect(visualizerEventsOf(undone.project)).toEqual([
      { id: "ve1", sceneId: "resonance-wave", startMs: 0, durationMs: 480_000 },
    ]);
  });

  it("cut inside the later VIS block keeps the earlier block and splits the one under the playhead", () => {
    const start = visSession(
      [
        { id: "left", sceneId: "resonance-wave", startMs: 0, durationMs: 225_000 },
        { id: "right", sceneId: "lexi-v3", startMs: 225_000, durationMs: 260_000 },
      ],
      { playheadMs: 403_840 },
    );
    start.project.visualizer.sceneId = "lexi-v3";
    start.selectedVisEventId = "right";
    start.selectedVisEventIds = ["right"];
    const cut = applyCommand(start, { type: "cut" });
    expect(cut.error).toBeNull();
    expect(cut.history.past.length).toBe(start.history.past.length + 1);
    const events = visualizerEventsOf(cut.project).sort((a, b) => a.startMs - b.startMs);
    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({
      id: "left",
      sceneId: "resonance-wave",
      startMs: 0,
      durationMs: 225_000,
    });
    expect(events[1]).toMatchObject({
      id: "right",
      sceneId: "lexi-v3",
      startMs: 225_000,
      durationMs: 178_840,
    });
    expect(events[2]).toMatchObject({
      sceneId: "lexi-v3",
      startMs: 403_840,
      durationMs: 81_160,
    });
    expect(events.every((e) => e.durationMs > 0)).toBe(true);
    const undone = applyCommand(cut, { type: "undo" });
    expect(visualizerEventsOf(undone.project).map((e) => e.id).sort()).toEqual(["left", "right"]);
  });

  it("cut too close to a VIS edge leaves the block in place", () => {
    const start = visSession(
      [{ id: "ve1", sceneId: "resonance-wave", startMs: 0, durationMs: 480_000 }],
      { playheadMs: 10 },
    );
    const cut = applyCommand(start, { type: "cut" });
    expect(cut.error).toBe("Split too close to VIS event edge");
    expect(cut.status).toBe("Cut rejected");
    expect(visualizerEventsOf(cut.project)).toEqual([
      { id: "ve1", sceneId: "resonance-wave", startMs: 0, durationMs: 480_000 },
    ]);
    expect(cut.history.past.length).toBe(start.history.past.length);
  });

  it("cut copies then deletes the selected event", () => {
    const start = visSession([
      { id: "ve1", sceneId: "tunnel-spiral", startMs: 0, durationMs: 1000 },
      { id: "ve2", sceneId: "pulse-orb", startMs: 2000, durationMs: 500 },
    ]);
    const cut = applyCommand(start, { type: "cut" });
    expect(visualizerEventsOf(cut.project).map((e) => e.id)).toEqual(["ve2"]);
    expect(cut.visClipboard).toEqual({ sceneId: "tunnel-spiral", durationMs: 1000 });
    expect(cut.clipboard).toEqual([]);
    expect(cut.selectedVisEventId).toBeNull();
    const pasted = applyCommand({ ...cut, project: { ...cut.project, playheadMs: 9000 } }, { type: "paste" });
    expect(visualizerEventsOf(pasted.project).some((e) => e.startMs === 9000 && e.sceneId === "tunnel-spiral")).toBe(
      true,
    );
  });

  it("delete removes the selected vis event when no clip is selected", () => {
    const start = visSession([{ id: "ve1", sceneId: "resonance-wave", startMs: 100, durationMs: 400 }]);
    const next = applyCommand(start, { type: "liftDelete" });
    expect(visualizerEventsOf(next.project)).toEqual([]);
    expect(next.selectedVisEventId).toBeNull();
    expect(next.history.past.length).toBe(start.history.past.length + 1);
  });

  it("rounds start/duration to integer ms on write and labels", () => {
    const start = visSession([{ id: "ve1", sceneId: "spectrum-bars", startMs: 1000, durationMs: 2000 }]);
    const moved = applyCommand(start, { type: "moveVisEvent", eventId: "ve1", startMs: 9141.438248204342 });
    const event = visualizerEventsOf(moved.project)[0]!;
    expect(Number.isInteger(event.startMs)).toBe(true);
    expect(event.startMs).toBe(9141);
    expect(event.durationMs).toBe(2000);
    expect(formatVisEventLabel(event)).toBe("Bars 9141–11141ms");
    expect(formatVisEventLabel({ sceneId: "spectrum-bars", startMs: 9141.438, durationMs: 177319.74 })).toBe(
      "Bars 9141–186461ms",
    );
    const inspected = applySetVisualizer(start, { startMs: 9141.438248204342, durationMs: 177319.743 });
    expect(visualizerEventsOf(inspected.project)[0]).toMatchObject({ startMs: 9141, durationMs: 177320 });
  });

  it("clip Ctrl+C/V still works when a clip is selected", () => {
    const va = asset({ id: "va", kind: "video", durationMs: 4000 });
    const c1 = clip({ id: "c1", assetId: "va", trackId: "V1", startMs: 0, durationMs: 1000 });
    const start: Session = {
      ...createSession(createMemoryBlobStore()),
      project: {
        ...projectWith([c1], [va]),
        playheadMs: 2500,
        visualizer: {
          ...createEmptyProject().visualizer,
          events: [{ id: "ve1", sceneId: "pulse-orb", startMs: 0, durationMs: 500 }],
        },
      },
      selectedClipId: "c1",
      selectedClipIds: ["c1"],
      selectedVis: false,
      selectedVisEventId: null,
    };
    const copied = applyCopy(start);
    expect(copied.clipboard[0]?.id).toBe("c1");
    expect(copied.lastClipboardKind).toBe("clip");
    expect(copied.visClipboard).toBeNull();
    const pasted = applyCommand(copied, { type: "paste" });
    expect(pasted.status).toBe("Pasted clip");
    expect(pasted.project.clips).toHaveLength(2);
    expect(visualizerEventsOf(pasted.project)).toHaveLength(1);
    expect(pasted.project.clips.find((c) => c.id !== "c1")!.startMs).toBe(2500);
    const visSelected = {
      ...copied,
      selectedClipId: null,
      selectedClipIds: [],
      selectedVis: true,
      selectedVisEventId: "ve1",
    };
    const visPaste = applyCommand(visSelected, { type: "paste" });
    expect(visPaste.project.clips).toHaveLength(1);
    expect(visPaste.error).toBe("Clipboard empty");
  });

  it("click-insert on a covered playhead selects the event instead of stacking", () => {
    const start = visSession([{ id: "ve1", sceneId: "particle-field", startMs: 0, durationMs: 4000 }], {
      playheadMs: 200,
    });
    const next = applyCommand(start, { type: "insertVisEvent" });
    expect(visualizerEventsOf(next.project)).toHaveLength(1);
    expect(next.selectedVisEventId).toBe("ve1");
    expect(next.history.past.length).toBe(start.history.past.length);
  });

  it("split at playhead cuts a VIS event into two same-scene blocks", () => {
    const start = visSession(
      [{ id: "ve1", sceneId: "tunnel-spiral", startMs: 0, durationMs: 8000 }],
      { playheadMs: 2500 },
    );
    const next = applyCommand(start, { type: "split" });
    expect(next.error).toBeNull();
    expect(next.status).toBe("Split at playhead");
    const events = visualizerEventsOf(next.project).sort((a, b) => a.startMs - b.startMs);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ id: "ve1", sceneId: "tunnel-spiral", startMs: 0, durationMs: 2500 });
    expect(events[1]).toMatchObject({ sceneId: "tunnel-spiral", startMs: 2500, durationMs: 5500 });
    const undone = applyCommand(next, { type: "undo" });
    expect(visualizerEventsOf(undone.project)).toEqual([
      { id: "ve1", sceneId: "tunnel-spiral", startMs: 0, durationMs: 8000 },
    ]);
  });

  it("splitVisualizerEventAt rejects cuts on the edge", () => {
    const start = visSession([{ id: "ve1", sceneId: "aurora-veil", startMs: 1000, durationMs: 2000 }]);
    const nearIn = splitVisualizerEventAt(start.project, "ve1", 1000);
    expect(nearIn.error).toBe("Split too close to VIS event edge");
    const nearOut = splitVisualizerEventAt(start.project, "ve1", 3000);
    expect(nearOut.error).toBe("Split too close to VIS event edge");
    const gap = splitVisualizerAtPlayhead({ ...start.project, playheadMs: 50 });
    expect(gap.error).toBe("No VIS event under playhead");
  });
});
