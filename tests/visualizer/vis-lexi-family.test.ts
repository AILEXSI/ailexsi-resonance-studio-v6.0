import { beforeAll, describe, expect, it } from "vitest";
import { deserializeProject, serializeProject, createEmptyProject } from "../../src/core/project";
import { createVisualEngine } from "../../src/core/visualz/engine";
import {
  LEXI_FAMILIES,
  LEXI_SCENE_IDS,
  SCENE_CATALOG,
  VISUALIZER_SCENE_IDS,
  catalogEntriesFor,
  getCatalogEntry,
  lexiFamilyOf,
} from "../../src/core/visualz/scene-catalog";
import { builtinScenes, ensureLexiScenes, getRegisteredScene } from "../../src/core/visualz";
import { featuresAt, renderVisualizerScene, sceneShortName } from "../../src/core/visualizer";
import { jobFromProject } from "../../src/core/exporter/job";
import { createPixelCanvas } from "../helpers/pixel-canvas";

const LEXI_FAMILY_SET = new Set<string>(LEXI_FAMILIES);

beforeAll(async () => {
  await ensureLexiScenes();
});

function stubCanvas() {
  const canvas = {
    width: 96,
    height: 54,
    getContext() {
      return {
        fillRect() {},
        fillText() {},
        beginPath() {},
        moveTo() {},
        lineTo() {},
        stroke() {},
        fill() {},
        arc() {},
        createLinearGradient() {
          return { addColorStop() {} };
        },
        createRadialGradient() {
          return { addColorStop() {} };
        },
        setLineDash() {},
      };
    },
  };
  return canvas as unknown as HTMLCanvasElement;
}

describe("LEXI family catalog", () => {
  it("keeps unique LEXI ids for every retained version", () => {
    const ids = LEXI_SCENE_IDS;
    expect(ids).toEqual([
      "lexi",
      "lexi-ref",
      "lexi-2036",
      "lexi-v3",
      "lexi-v2",
      "lexi-minimal",
      "lexi-v1",
    ]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(VISUALIZER_SCENE_IDS).toContain(id);
      expect(builtinScenes.filter((s) => s.id === id)).toHaveLength(1);
    }
  });

  it("maps every LEXI scene into one valid family", () => {
    for (const id of LEXI_SCENE_IDS) {
      const family = lexiFamilyOf(id);
      expect(family, id).toBeDefined();
      expect(LEXI_FAMILY_SET.has(family!)).toBe(true);
      expect(getCatalogEntry(id)?.suite).toBe("LEXI");
    }
    expect(LEXI_FAMILIES).toEqual(["FLOW", "GEOMETRY", "SYNTHWAVE", "PARTICLE", "STAGE"]);
  });

  it("exposes every LEXI scene through selector metadata", () => {
    const viaLexi = catalogEntriesFor({ category: "LEXI" });
    const viaFlow = catalogEntriesFor({ category: "LEXI", family: "FLOW" });
    expect(viaLexi.map((e) => e.id)).toEqual([...LEXI_SCENE_IDS]);
    expect(viaFlow.map((e) => e.id)).toEqual([...LEXI_SCENE_IDS]);
    for (const entry of viaLexi) {
      expect(entry.displayName.length).toBeGreaterThan(3);
      expect(entry.renderer).toBe(entry.id);
      expect(sceneShortName(entry.id)).toBe(entry.shortName);
      expect(getRegisteredScene(entry.id)?.defaultParams).toBeTruthy();
    }
    expect(catalogEntriesFor({ category: "LEXI", family: "GEOMETRY" })).toEqual([]);
    expect(catalogEntriesFor({ category: "ALL" }).map((e) => e.id)).toEqual([...VISUALIZER_SCENE_IDS]);
  });

  it("selecting one LEXI scene does not mutate another scene's params", () => {
    const a = getRegisteredScene("lexi-v1")!;
    const b = getRegisteredScene("lexi")!;
    const aSnap = JSON.stringify(a.defaultParams);
    const bSnap = JSON.stringify(b.defaultParams);
    const engine = createVisualEngine({ canvas: stubCanvas(), initialSceneId: "lexi-v1" });
    engine.setScene("lexi");
    expect(JSON.stringify(a.defaultParams)).toBe(aSnap);
    expect(JSON.stringify(b.defaultParams)).toBe(bSnap);
    expect(engine.getState().params.complexity).toBe(b.defaultParams.complexity);
    expect(engine.getState().params.complexity).not.toBe(a.defaultParams.complexity);
    engine.setScene("lexi-v1");
    expect(engine.getState().params.complexity).toBe(a.defaultParams.complexity);
    engine.destroy();
  });

  it("save/reload persists every LEXI scene id", () => {
    for (const sceneId of LEXI_SCENE_IDS) {
      const p = createEmptyProject("LEXI persist");
      p.visualizer = { enabled: true, muted: false, sceneId };
      expect(deserializeProject(serializeProject(p)).visualizer.sceneId).toBe(sceneId);
    }
  });

  it("Preview can instantiate every LEXI scene", () => {
    const features = featuresAt(0, 10_000);
    for (const id of LEXI_SCENE_IDS) {
      const scene = getRegisteredScene(id);
      expect(scene, id).toBeTruthy();
      const buf = createPixelCanvas(96, 54);
      expect(() => {
        renderVisualizerScene(buf.ctx, 96, 54, id, features, 1 / 30);
      }).not.toThrow();
      expect(buf.nonemptyCount(), id).toBeGreaterThan(20);
    }
  });

  it("Export job recognizes every LEXI scene id", () => {
    for (const sceneId of LEXI_SCENE_IDS) {
      const project = createEmptyProject("LEXI export");
      project.visualizer = { enabled: true, muted: false, sceneId, startMs: 0, durationMs: 2000 };
      const job = jobFromProject(project);
      expect(job.visualizer.sceneId).toBe(sceneId);
      expect(getRegisteredScene(job.visualizer.sceneId)?.id).toBe(sceneId);
    }
  });

  it("catalog is the single registry (no orphan builtin / no missing renderer)", () => {
    expect(SCENE_CATALOG.map((e) => e.id)).toEqual([...VISUALIZER_SCENE_IDS]);
    expect(builtinScenes.map((s) => s.id)).toEqual([...VISUALIZER_SCENE_IDS]);
    for (const entry of SCENE_CATALOG) {
      expect(getRegisteredScene(entry.id)?.id).toBe(entry.id);
    }
  });
});
