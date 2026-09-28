import { describe, expect, it } from "vitest";
import { applyCommand } from "../../src/app/commands";
import { applyCycleVisualizerScene, createSession, type Session } from "../../src/app/session";
import { DEFAULT_VISUALIZER_SCENE_ID } from "../../src/core/models";
import { createMemoryBlobStore } from "../../src/core/persistence";
import { createEmptyProject, deserializeProject, serializeProject } from "../../src/core/project";
import { compositeVideoAt, contextFromProject } from "../../src/core/transition";
import {
  DEFAULT_VIS_EVENT_MS,
  shouldShowVisualizer,
  visualizerEventAt,
  visualizerEventsOf,
  visualizerSceneAt,
} from "../../src/core/visualizer";
import { previewComposite } from "../../src/ui/preview/Preview";
import { asset, clip, projectWith } from "../helpers";

function sessionOf(project = createEmptyProject("VIS")): Session {
  return {
    ...createSession(createMemoryBlobStore()),
    project,
  };
}

describe("VIS events", () => {
  it("empty VIS click at playhead inserts an event", () => {
    const start = sessionOf({ ...createEmptyProject("VIS"), playheadMs: 1500 });
    expect(visualizerEventsOf(start.project)).toEqual([]);
    const next = applyCommand(start, { type: "insertVisEvent" });
    const events = visualizerEventsOf(next.project);
    expect(events).toHaveLength(1);
    expect(events[0]!.startMs).toBe(1500);
    expect(events[0]!.durationMs).toBe(DEFAULT_VIS_EVENT_MS);
    expect(events[0]!.sceneId).toBe(start.project.visualizer.sceneId);
    expect(next.selectedVis).toBe(true);
    expect(next.selectedVisEventId).toBe(events[0]!.id);
    expect(next.history.past.length).toBe(start.history.past.length + 1);
  });

  it("insert snaps to nearby edges; playhead stays (P94)", () => {
    const project = createEmptyProject("VIS");
    project.playheadMs = 2070;
    project.snap = true;
    project.markers = [{ id: "m1", timeMs: 2000, label: "M" }];
    const next = applyCommand(sessionOf(project), { type: "insertVisEvent" });
    const events = visualizerEventsOf(next.project);
    expect(events).toHaveLength(1);
    expect(events[0]!.startMs).toBe(2000);
    expect(next.project.playheadMs).toBe(2070);

    const off = applyCommand(
      sessionOf({ ...project, snap: false }),
      { type: "insertVisEvent" },
    );
    expect(visualizerEventsOf(off.project)[0]!.startMs).toBe(2070);
    expect(off.project.playheadMs).toBe(2070);
  });

  it("two events switch scene at the boundary in composite/preview helper", () => {
    const project = projectWith(
      [
        clip({ id: "v1", assetId: "va", trackId: "V1", startMs: 0, durationMs: 3000 }),
        clip({ id: "v2", assetId: "vb", trackId: "V2", startMs: 0, durationMs: 3000 }),
      ],
      [
        asset({ id: "va", kind: "video", durationMs: 4000 }),
        asset({ id: "vb", kind: "video", durationMs: 4000 }),
      ],
    );
    project.visualizer = {
      ...project.visualizer,
      events: [
        { id: "ve1", sceneId: "pulse-orb", startMs: 0, durationMs: 1000 },
        { id: "ve2", sceneId: "spectrum-bars", startMs: 1000, durationMs: 1000 },
      ],
    };
    expect(visualizerSceneAt(project, 999)).toBe("pulse-orb");
    expect(visualizerSceneAt(project, 1000)).toBe("spectrum-bars");
    expect(visualizerEventAt(project, 1000)?.id).toBe("ve2");
    expect(previewComposite).toBe(compositeVideoAt);
    expect(compositeVideoAt(contextFromProject(project), 500).layers[0]?.clipId).toBe("v2");
    expect(previewComposite(contextFromProject(project), 500).layers[0]?.clipId).toBe("v2");
  });

  it("deserialize old project with no events still uses sceneId+window", () => {
    const p = createEmptyProject("Legacy");
    const raw = JSON.parse(serializeProject(p)) as Record<string, unknown>;
    raw.visualizer = {
      enabled: true,
      muted: false,
      sceneId: "pulse-orb",
      startMs: 1000,
      durationMs: 500,
    };
    delete (raw as { frontVideoTrackId?: unknown }).frontVideoTrackId;
    const loaded = deserializeProject(JSON.stringify(raw));
    expect(loaded.visualizer.events ?? []).toEqual([]);
    expect(loaded.visualizer.sceneId).toBe("pulse-orb");
    expect(loaded.frontVideoTrackId).toBe("V2");
    expect(visualizerSceneAt(loaded, 1200)).toBe("pulse-orb");
    expect(visualizerSceneAt(loaded, 2000)).toBeUndefined();
    expect(shouldShowVisualizer(loaded, 1200)).toBe(true);
    expect(shouldShowVisualizer(loaded, 2000)).toBe(false);
  });

  it("VIS event does not hide covering video; only fills gaps", () => {
    const p = projectWith([
      clip({ id: "v1", assetId: "a", trackId: "V1", startMs: 0, durationMs: 2000 }),
    ]);
    expect(shouldShowVisualizer(p, 100)).toBe(false);
    p.visualizer = {
      ...p.visualizer,
      events: [{ id: "ve1", sceneId: "lita-bloom", startMs: 0, durationMs: 500 }],
    };
    expect(shouldShowVisualizer(p, 100)).toBe(false);
    expect(shouldShowVisualizer(p, 800)).toBe(false);
    // Gap after the clip: no covering VIS event → black (AUTO). Do not invent overlay.
    expect(shouldShowVisualizer(p, 2500)).toBe(false);
    expect(visualizerSceneAt(p, 100)).toBe("lita-bloom");
    p.visualizer = {
      ...p.visualizer,
      events: [
        { id: "ve1", sceneId: "lita-bloom", startMs: 0, durationMs: 500 },
        { id: "ve2", sceneId: "pulse-orb", startMs: 2000, durationMs: 1000 },
      ],
    };
    expect(shouldShowVisualizer(p, 100)).toBe(false);
    expect(shouldShowVisualizer(p, 2500)).toBe(true);
  });

  it("insert duration stretches to the next event", () => {
    const project = createEmptyProject("VIS");
    project.playheadMs = 0;
    project.visualizer = {
      ...project.visualizer,
      events: [{ id: "later", sceneId: "tunnel-spiral", startMs: 2500, durationMs: 1000 }],
    };
    const next = applyCommand(sessionOf(project), { type: "insertVisEvent" });
    const inserted = visualizerEventsOf(next.project).find((e) => e.id !== "later");
    expect(inserted?.startMs).toBe(0);
    expect(inserted?.durationMs).toBe(2500);
  });

  it("cycle-scene applies to the selected event else fallback sceneId", () => {
    const project = createEmptyProject("VIS");
    project.visualizer = {
      ...project.visualizer,
      sceneId: DEFAULT_VISUALIZER_SCENE_ID,
      events: [{ id: "ve1", sceneId: "pulse-orb", startMs: 0, durationMs: 1000 }],
    };
    const fallback = applyCycleVisualizerScene({
      ...sessionOf(project),
      selectedVis: true,
      selectedVisEventId: null,
    });
    expect(fallback.project.visualizer.sceneId).toBe("resonance-dunes");
    expect(visualizerEventsOf(fallback.project)[0]!.sceneId).toBe("pulse-orb");
    const selected = applyCommand(sessionOf(project), { type: "selectVisEvent", eventId: "ve1" });
    const cycled = applyCycleVisualizerScene(selected);
    expect(visualizerEventsOf(cycled.project)[0]!.sceneId).toBe("aurora-veil");
    expect(cycled.project.visualizer.sceneId).toBe(DEFAULT_VISUALIZER_SCENE_ID);
  });
});
