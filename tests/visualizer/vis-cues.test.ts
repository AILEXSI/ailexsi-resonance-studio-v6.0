import { describe, expect, it } from "vitest";
import {
  applyCycleVisualizerScene,
  applyPickVisualizerScene,
  applySelectVis,
  applySetVisualizer,
  createSession,
  type Session,
} from "../../src/app/session";
import { DEFAULT_VISUALIZER_SCENE_ID, VISUALIZER_SCENE_IDS } from "../../src/core/models";
import { createMemoryBlobStore } from "../../src/core/persistence";
import { createEmptyProject } from "../../src/core/project";
import { jobFromProject } from "../../src/core/exporter/job";
import {
  insertCueAtPlayhead,
  nextSceneId,
  sceneAt,
  sceneIdAt,
  sceneShortName,
  visualizerEventsOf,
} from "../../src/core/visualizer";
import { clip, projectWith } from "../helpers";

function sessionOf(project = createEmptyProject("Cues")): Session {
  return {
    ...createSession(createMemoryBlobStore()),
    project,
  };
}

describe("VIS cues", () => {
  it("playhead mid then VIS cycle inserts two abutting blocks (left old, right next)", () => {
    const project = createEmptyProject("Cues");
    project.playheadMs = 2000;
    const next = applyCycleVisualizerScene(sessionOf(project));
    const events = visualizerEventsOf(next.project).sort((a, b) => a.startMs - b.startMs);
    expect(events).toHaveLength(2);
    expect(events[0]!.startMs).toBe(0);
    expect(events[0]!.durationMs).toBe(2000);
    expect(events[0]!.sceneId).toBe(DEFAULT_VISUALIZER_SCENE_ID);
    expect(events[1]!.startMs).toBe(2000);
    expect(events[1]!.sceneId).toBe("resonance-dunes");
    expect(next.project.visualizer.cues).toEqual([
      { startMs: 0, sceneId: DEFAULT_VISUALIZER_SCENE_ID },
      { startMs: 2000, sceneId: "resonance-dunes" },
    ]);
    expect(sceneAt(next.project, 1999)).toBe(DEFAULT_VISUALIZER_SCENE_ID);
    expect(sceneAt(next.project, 2000)).toBe("resonance-dunes");
    expect(sceneIdAt(next.project, 2000)).toBe("resonance-dunes");
    expect(next.selectedVisEventId).toBe(events[1]!.id);
  });

  it("sceneAt / sceneIdAt follow cues when events are empty", () => {
    const project = createEmptyProject("Cues");
    project.visualizer = {
      ...project.visualizer,
      cues: [
        { startMs: 0, sceneId: "pulse-orb" },
        { startMs: 1500, sceneId: "aurora-veil" },
      ],
    };
    expect(sceneAt(project, 0)).toBe("pulse-orb");
    expect(sceneAt(project, 1499)).toBe("pulse-orb");
    expect(sceneIdAt(project, 1500)).toBe("aurora-veil");
  });

  it("rematerialized events ride the existing export compositor (no exporter rebuild)", () => {
    const project = projectWith([clip({ id: "a1", assetId: "a", trackId: "A1", startMs: 0, durationMs: 8000 })]);
    project.playheadMs = 3000;
    const { project: cued } = insertCueAtPlayhead(project, 3000);
    const job = jobFromProject(cued);
    const events = [...(job.visualizer.events ?? [])].sort((a, b) => a.startMs - b.startMs);
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events[0]!.sceneId).toBe(DEFAULT_VISUALIZER_SCENE_ID);
    expect(events.some((e) => e.startMs === 3000 && e.sceneId === "resonance-dunes")).toBe(true);
  });

  it("menu pick uses the cycle rematerialize path so the VIS track scene actually changes", () => {
    const project = createEmptyProject("Pick");
    project.playheadMs = 2000;
    const cycled = applyCycleVisualizerScene(sessionOf(project));
    expect(sceneAt(cycled.project, 2000)).toBe("resonance-dunes");
    const deselected = applySelectVis(cycled);
    expect(deselected.selectedVisEventId).toBeNull();
    const picked = applyPickVisualizerScene(deselected, "lexi");
    expect(picked.project.visualizer.sceneId).toBe("lexi");
    expect(sceneAt(picked.project, 2000)).toBe("lexi");
    expect(visualizerEventsOf(picked.project).some((e) => e.startMs === 2000 && e.sceneId === "lexi")).toBe(
      true,
    );
    const again = applySetVisualizer(picked, { sceneId: "lexi-v3" });
    expect(sceneAt(again.project, 2000)).toBe("lexi-v3");
    expect(
      visualizerEventsOf(again.project).some((e) => e.startMs === 2000 && e.sceneId === "lexi-v3"),
    ).toBe(true);
  });

  it("nextSceneId walks the catalog cycle including 3D scenes and sceneAt follows them", () => {
    expect(VISUALIZER_SCENE_IDS).toContain("particle-field");
    expect(VISUALIZER_SCENE_IDS).toContain("resonance-wave");
    expect(VISUALIZER_SCENE_IDS).toContain("tunnel-spiral");
    expect(VISUALIZER_SCENE_IDS).toContain("lita-bloom");
    expect(nextSceneId("ember-rain")).toBe("particle-field");
    expect(nextSceneId("particle-field")).toBe("resonance-wave");
    expect(nextSceneId("lita-bloom")).toBe("void-lattice");
    expect(nextSceneId("void-lattice")).toBe("nebula-helix");
    expect(nextSceneId("nebula-helix")).toBe("accretion-disk");
    expect(nextSceneId("accretion-disk")).toBe("crystal-storm");
    expect(nextSceneId("crystal-storm")).toBe("lexi");
    expect(nextSceneId("lexi")).toBe("lexi-ref");
    expect(nextSceneId("lexi-v1")).toBe("spectrum-bars");
    expect(sceneShortName("void-lattice")).toBe("Lattice");
    expect(sceneShortName("nebula-helix")).toBe("Helix");
    expect(sceneShortName("accretion-disk")).toBe("Disk");
    expect(sceneShortName("crystal-storm")).toBe("Crystal");
    expect(sceneShortName("lexi")).toBe("LEXI");
    expect(sceneShortName("lexi-minimal")).toBe("LEXI Min");
    const project = createEmptyProject("3D");
    project.visualizer = {
      ...project.visualizer,
      cues: [
        { startMs: 0, sceneId: "lita-bloom" },
        { startMs: 2000, sceneId: "void-lattice" },
        { startMs: 4000, sceneId: "nebula-helix" },
        { startMs: 6000, sceneId: "accretion-disk" },
        { startMs: 8000, sceneId: "crystal-storm" },
      ],
    };
    expect(sceneAt(project, 1999)).toBe("lita-bloom");
    expect(sceneAt(project, 2000)).toBe("void-lattice");
    expect(sceneIdAt(project, 4000)).toBe("nebula-helix");
    expect(sceneAt(project, 6000)).toBe("accretion-disk");
    expect(sceneAt(project, 8000)).toBe("crystal-storm");
  });
});
