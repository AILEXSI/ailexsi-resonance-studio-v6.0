import { beforeAll, describe, expect, it } from "vitest";
import { VISUALIZER_SCENE_IDS, isVisualizerSceneId } from "../../src/core/models";
import {
  featuresAt,
  nextSceneId,
  presentVisualizerFeatures,
  renderVisualizerScene,
  sceneShortName,
  visFeaturesForExport,
  visFeaturesForPreview,
} from "../../src/core/visualizer";
import { builtinScenes, ensureLexiScenes, getRegisteredScene } from "../../src/core/visualz";
import {
  lexiAccent,
  lexiAmbientExpand,
  lexiFormShift,
  lexiGlow,
  lexiHighlightBloom,
  lexiHorizonBody,
  lexiHorizonLift,
  lexiPeakBias,
  lexiPressureWave,
  lexiRibbonWidth,
  lexiSheen,
  lexiTerrainSpread,
  lexiTransientFlash,
} from "../../src/core/visualz/scene-impact";
import {
  LEXI_2036_FG_TRACES,
  LEXI_2036_HERO_FILAMENTS,
  LEXI_2036_SIGNAL_TOWERS,
  LEXI_FLOW_FG_GRID,
  LEXI_DEFAULT_THEME,
  LEXI_REF_DUNE_CONTOURS,
  LEXI_REF_DUNE_MERIDIANS,
  LEXI_REF_FG_BOKEH,
  LEXI_REF_MOUNTAIN_PEAKS,
  LEXI_REF_SURFACE_POINTS,
  LEXI_REFLECT,
  LEXI_THEMES,
  LEXI_TITLE_SAFE,
  LEXI_V3_DEPTH_PLANES,
  LEXI_V3_LIGHT_BANDS,
  lexiScene,
  resolveLexiTheme,
} from "../../src/core/visualz/scenes/lexi";
import { lexiMinimalScene } from "../../src/core/visualz/scenes/lexi-minimal";
import type { AudioFeatures } from "../../src/core/visualz";
import { createPixelCanvas } from "../helpers/pixel-canvas";

beforeAll(async () => {
  await ensureLexiScenes();
});

const QUIET: AudioFeatures = {
  timeMs: 800,
  rms: 0.04,
  bass: 0.03,
  mid: 0.02,
  treble: 0.01,
  spectrum: new Float32Array(32),
  onset: false,
  beatPulse: 0,
};

const LOUD: AudioFeatures = {
  timeMs: 800,
  rms: 0.72,
  bass: 0.68,
  mid: 0.4,
  treble: 0.22,
  spectrum: Float32Array.from({ length: 32 }, (_, i) => 0.2 + (i % 7) * 0.08),
  onset: true,
  beatPulse: 0.92,
};

const PAD: AudioFeatures = {
  ...LOUD,
  onset: false,
  beatPulse: 0,
};

const SNARE: AudioFeatures = {
  timeMs: 800,
  rms: 0.38,
  bass: 0.14,
  mid: 0.36,
  treble: 0.72,
  spectrum: Float32Array.from({ length: 32 }, (_, i) => 0.15 + (i > 18 ? 0.45 : 0.08)),
  onset: true,
  beatPulse: 0.55,
};

const KICK_DARK: AudioFeatures = {
  timeMs: 800,
  rms: 0.7,
  bass: 0.78,
  mid: 0.18,
  treble: 0.04,
  spectrum: Float32Array.from({ length: 32 }, (_, i) => (i < 6 ? 0.7 : 0.05)),
  onset: true,
  beatPulse: 0.94,
};

function paint(id: (typeof VISUALIZER_SCENE_IDS)[number], features: AudioFeatures, dt = 1 / 30) {
  const buf = createPixelCanvas(96, 54);
  renderVisualizerScene(buf.ctx, 96, 54, id, features, dt);
  return buf;
}

describe("VIS-SCENE-LEXI registry", () => {
  it("registers flagship LEXI V3 and LEXI Minimal Horizon on the shared cycle", () => {
    expect(isVisualizerSceneId("lexi")).toBe(true);
    expect(isVisualizerSceneId("lexi-minimal")).toBe(true);
    expect(VISUALIZER_SCENE_IDS).toContain("lexi");
    expect(VISUALIZER_SCENE_IDS).toContain("lexi-minimal");
    expect(builtinScenes.some((s) => s.id === "lexi")).toBe(true);
    expect(builtinScenes.some((s) => s.id === "lexi-minimal")).toBe(true);
    expect(getRegisteredScene("lexi")?.name).toBe("LEXI");
    expect(getRegisteredScene("lexi-minimal")?.name).toBe("LEXI Minimal Horizon");
    expect(lexiScene.name).toBe("LEXI");
    expect(lexiMinimalScene.name).toBe("LEXI Minimal Horizon");
    expect(sceneShortName("lexi")).toBe("LEXI");
    expect(sceneShortName("lexi-minimal")).toBe("LEXI Min");
    expect(nextSceneId("crystal-storm")).toBe("lexi");
    expect(nextSceneId("lexi")).toBe("lexi-ref");
    expect(nextSceneId("lexi-v1")).toBe("spectrum-bars");
  });

  it("ships gold / champagne as the default and keeps later palettes as data", () => {
    expect(LEXI_DEFAULT_THEME).toBe("gold");
    expect(lexiScene.defaultParams.colorPrimary).toBe(LEXI_THEMES.gold.colorPrimary);
    expect(lexiScene.defaultParams.colorSecondary).toBe(LEXI_THEMES.gold.colorSecondary);
    expect(lexiScene.defaultParams.palette).toBe("gold");
    expect(lexiMinimalScene.defaultParams.palette).toBe("gold");
    expect(Object.keys(LEXI_THEMES)).toEqual(["gold", "cyan", "red", "green", "violet"]);
    expect(resolveLexiTheme(lexiScene.defaultParams)).toBe(LEXI_THEMES.gold);
    expect(resolveLexiTheme({ ...lexiScene.defaultParams, palette: "cyan" })).toBe(LEXI_THEMES.cyan);
    expect(LEXI_THEMES.gold.champagne).toMatch(/^#/);
    expect(LEXI_TITLE_SAFE.x0).toBeLessThan(LEXI_TITLE_SAFE.x1);
    expect(LEXI_TITLE_SAFE.y0).toBeLessThan(LEXI_TITLE_SAFE.y1);
  });

  it("keeps a useful param set on both scenes (no unused graveyard keys)", () => {
    for (const scene of [lexiScene, lexiMinimalScene]) {
      const p = scene.defaultParams;
      for (const key of [
        "intensity",
        "glowStrength",
        "lineThickness",
        "waveAmplitude",
        "depthStrength",
        "reactivity",
        "smoothing",
        "particleAmount",
        "colorPrimary",
        "colorSecondary",
        "backgroundLevel",
        "palette",
        "complexity",
      ]) {
        expect(p[key], `${scene.id}.${key}`).toBeDefined();
      }
    }
  });
});

describe("VIS-SCENE-LEXI reference-level cinematic language", () => {
  it("is a new image language — distinct from Minimal, Lattice, Wave, Gold", () => {
    const features = featuresAt(0, 10_000);
    const lexi = paint("lexi", features);
    expect(lexi.nonemptyCount()).toBeGreaterThan(20);
    expect(LEXI_V3_DEPTH_PLANES).toBe(3);
    expect(LEXI_V3_LIGHT_BANDS).toBeGreaterThanOrEqual(3);
    expect(LEXI_2036_HERO_FILAMENTS).toBeGreaterThanOrEqual(6);
    expect(LEXI_2036_FG_TRACES).toBeGreaterThanOrEqual(3);
    expect(LEXI_2036_SIGNAL_TOWERS).toBeGreaterThanOrEqual(6);
    expect(LEXI_REF_DUNE_MERIDIANS).toBeGreaterThanOrEqual(48);
    expect(LEXI_REF_DUNE_CONTOURS).toBeGreaterThanOrEqual(12);
    expect(LEXI_REF_SURFACE_POINTS).toBeGreaterThanOrEqual(600);
    expect(LEXI_REF_MOUNTAIN_PEAKS).toBeGreaterThanOrEqual(7);
    expect(LEXI_REF_FG_BOKEH).toBeGreaterThanOrEqual(16);
    expect(LEXI_FLOW_FG_GRID).toBeGreaterThanOrEqual(12);
    expect(LEXI_REFLECT.cyan).toMatch(/^#/);
    expect(LEXI_REFLECT.magenta).toMatch(/^#/);
    const minimal = paint("lexi-minimal", features).fingerprint();
    const lattice = paint("void-lattice", features).fingerprint();
    const wave = paint("resonance-wave", features).fingerprint();
    const gold = paint("liquid-gold", features).fingerprint();
    expect(lexi.fingerprint()).not.toBe(minimal);
    expect(lexi.fingerprint()).not.toBe(lattice);
    expect(lexi.fingerprint()).not.toBe(wave);
    expect(lexi.fingerprint()).not.toBe(gold);
  });

  it("is deterministic for the same presented packet", () => {
    lexiScene.onEnter?.({ width: 96, height: 54, ctx: paint("lexi", QUIET).ctx }, lexiScene.defaultParams);
    const a = paint("lexi", LOUD);
    lexiScene.onEnter?.({ width: 96, height: 54, ctx: paint("lexi", QUIET).ctx }, lexiScene.defaultParams);
    const b = paint("lexi", LOUD);
    expect(a.fingerprint()).toBe(b.fingerprint());
  });

  it("maps audio to form, not soup: bass lift, mid form, kick pressure, highlight bloom", () => {
    expect(lexiGlow(QUIET, 0.86)).toBeLessThan(lexiGlow(LOUD, 0.86) * 0.2);
    expect(lexiHorizonLift(QUIET, 0.86)).toBeLessThan(lexiHorizonLift(LOUD, 0.86) * 0.25);
    expect(lexiHorizonBody(QUIET, 0.86)).toBeLessThan(lexiHorizonBody(LOUD, 0.86) * 0.25);
    expect(lexiTerrainSpread(QUIET, 0.86)).toBeLessThan(lexiTerrainSpread(LOUD, 0.86));
    expect(lexiFormShift(QUIET, 0.86)).toBeLessThan(lexiFormShift(LOUD, 0.86) * 0.2);
    expect(lexiPressureWave(QUIET)).toBeLessThan(lexiPressureWave(LOUD) * 0.15);
    expect(lexiHighlightBloom(QUIET, 0.86)).toBeLessThan(lexiHighlightBloom(LOUD, 0.86) * 0.25);
    expect(lexiAccent(QUIET)).toBeLessThan(lexiAccent(LOUD));
    expect(lexiSheen(LOUD, 0.4)).toBeGreaterThan(lexiSheen(QUIET, 0.4));
    expect(Math.abs(lexiPeakBias(800, 0.78))).toBeGreaterThan(0.2);
    expect(lexiAmbientExpand(QUIET, 0.86)).toBeLessThan(lexiAmbientExpand(PAD, 0.86) * 0.25);
    expect(lexiRibbonWidth(QUIET, 0.86)).toBeLessThan(lexiRibbonWidth(PAD, 0.86) * 0.3);
    expect(lexiTransientFlash(SNARE)).toBeGreaterThan(lexiTransientFlash(KICK_DARK));
    expect(lexiTransientFlash(QUIET)).toBeLessThan(lexiTransientFlash(SNARE) * 0.2);
    expect(lexiPressureWave(KICK_DARK)).toBeGreaterThan(lexiPressureWave(SNARE));
  });

  it("paints a quieter / darker frame than a musical peak", () => {
    lexiScene.onEnter?.({ width: 96, height: 54, ctx: paint("lexi", QUIET).ctx }, lexiScene.defaultParams);
    const quiet = paint("lexi", QUIET);
    lexiScene.onEnter?.({ width: 96, height: 54, ctx: paint("lexi", QUIET).ctx }, lexiScene.defaultParams);
    const loud = paint("lexi", LOUD);
    expect(quiet.fingerprint()).not.toBe(loud.fingerprint());
    expect(loud.nonemptyCount()).toBeGreaterThan(quiet.nonemptyCount() * 0.55);
    // Software pixel canvas strokes paths and does not fill terrain quads, so
    // raw RGB sum is not a reliable "darker" proxy. Drivers carry the contrast.
    expect(lexiHighlightBloom(QUIET, 0.86) + lexiPressureWave(QUIET)).toBeLessThan(
      (lexiHighlightBloom(LOUD, 0.86) + lexiPressureWave(LOUD)) * 0.25,
    );
  });

  it("kick / onset changes the picture vs the same pad energy", () => {
    lexiScene.onEnter?.({ width: 96, height: 54, ctx: paint("lexi", PAD).ctx }, lexiScene.defaultParams);
    const pad = paint("lexi", PAD);
    lexiScene.onEnter?.({ width: 96, height: 54, ctx: paint("lexi", PAD).ctx }, lexiScene.defaultParams);
    const kick = paint("lexi", LOUD);
    expect(kick.fingerprint()).not.toBe(pad.fingerprint());
    expect(lexiPressureWave(LOUD)).toBeGreaterThan(lexiPressureWave(PAD));
  });

  it("snare / high-transient flashes the highlight without matching a dark kick", () => {
    lexiScene.onEnter?.({ width: 96, height: 54, ctx: paint("lexi", PAD).ctx }, lexiScene.defaultParams);
    const pad = paint("lexi", PAD);
    lexiScene.onEnter?.({ width: 96, height: 54, ctx: paint("lexi", PAD).ctx }, lexiScene.defaultParams);
    const snare = paint("lexi", SNARE);
    expect(snare.fingerprint()).not.toBe(pad.fingerprint());
    expect(lexiTransientFlash(SNARE)).toBeGreaterThan(lexiTransientFlash(PAD) * 1.4);
  });

  it("mids shift large form, not just glow", () => {
    const noMid: AudioFeatures = { ...LOUD, mid: 0.02, onset: false, beatPulse: 0 };
    const mid: AudioFeatures = { ...LOUD, mid: 0.78, onset: false, beatPulse: 0 };
    lexiScene.onEnter?.({ width: 96, height: 54, ctx: paint("lexi", noMid).ctx }, lexiScene.defaultParams);
    const a = paint("lexi", noMid);
    lexiScene.onEnter?.({ width: 96, height: 54, ctx: paint("lexi", noMid).ctx }, lexiScene.defaultParams);
    const b = paint("lexi", mid);
    expect(a.fingerprint()).not.toBe(b.fingerprint());
    expect(lexiFormShift(mid, 1)).toBeGreaterThan(lexiFormShift(noMid, 1) * 2);
  });

  it("uses complexity as terrain density, not a dead knob", () => {
    const ctx = paint("lexi", LOUD).ctx;
    lexiScene.onEnter?.({ width: 96, height: 54, ctx }, lexiScene.defaultParams);
    const sparse = createPixelCanvas(96, 54);
    lexiScene.render({ width: 96, height: 54, ctx: sparse.ctx }, LOUD, { ...lexiScene.defaultParams, complexity: 0.1 }, 1 / 30);
    const dense = createPixelCanvas(96, 54);
    lexiScene.onEnter?.({ width: 96, height: 54, ctx: dense.ctx }, lexiScene.defaultParams);
    lexiScene.render({ width: 96, height: 54, ctx: dense.ctx }, LOUD, { ...lexiScene.defaultParams, complexity: 0.95 }, 1 / 30);
    expect(sparse.fingerprint()).not.toBe(dense.fingerprint());
  });
});

describe("VIS-SCENE-LEXI Minimal Horizon (V2 quiet variant)", () => {
  it("keeps the calm parallel-horizon look as a second selectable scene", () => {
    lexiMinimalScene.onEnter?.({ width: 96, height: 54, ctx: paint("lexi-minimal", QUIET).ctx }, lexiMinimalScene.defaultParams);
    const quiet = paint("lexi-minimal", QUIET);
    lexiMinimalScene.onEnter?.({ width: 96, height: 54, ctx: paint("lexi-minimal", QUIET).ctx }, lexiMinimalScene.defaultParams);
    const loud = paint("lexi-minimal", LOUD);
    expect(quiet.nonemptyCount()).toBeGreaterThan(20);
    expect(quiet.fingerprint()).not.toBe(loud.fingerprint());
    expect(loud.nonemptyCount()).toBeGreaterThan(quiet.nonemptyCount() * 0.55);
  });

  it("is deterministic and not the flagship frame", () => {
    lexiMinimalScene.onEnter?.({ width: 96, height: 54, ctx: paint("lexi-minimal", QUIET).ctx }, lexiMinimalScene.defaultParams);
    const a = paint("lexi-minimal", LOUD);
    lexiMinimalScene.onEnter?.({ width: 96, height: 54, ctx: paint("lexi-minimal", QUIET).ctx }, lexiMinimalScene.defaultParams);
    const b = paint("lexi-minimal", LOUD);
    expect(a.fingerprint()).toBe(b.fingerprint());
    lexiScene.onEnter?.({ width: 96, height: 54, ctx: paint("lexi", QUIET).ctx }, lexiScene.defaultParams);
    const flagship = paint("lexi", LOUD);
    expect(a.fingerprint()).not.toBe(flagship.fingerprint());
  });
});

describe("VIS-SCENE-LEXI drivers (Preview === Export)", () => {
  it("reads the shared presented packet — no export-only path", () => {
    const raw: AudioFeatures = { ...LOUD };
    const presented = presentVisualizerFeatures(raw);
    const preview = visFeaturesForPreview({
      timeMs: raw.timeMs,
      durationMs: 10_000,
      live: raw,
      audioLoaded: false,
    });
    const exported = visFeaturesForExport(raw.timeMs, 10_000);
    expect(lexiHorizonLift(presented, 1)).toBeCloseTo(lexiHorizonLift(preview, 1), 5);
    expect(lexiGlow(presented, 1)).toBeCloseTo(lexiGlow(preview, 1), 5);
    expect(lexiHorizonBody(presented, 1)).toBeCloseTo(lexiHorizonBody(preview, 1), 5);
    expect(lexiTerrainSpread(presented, 1)).toBeCloseTo(lexiTerrainSpread(preview, 1), 5);
    expect(lexiFormShift(presented, 1)).toBeCloseTo(lexiFormShift(preview, 1), 5);
    expect(lexiPressureWave(presented)).toBeCloseTo(lexiPressureWave(preview), 5);
    expect(lexiAmbientExpand(presented, 1)).toBeCloseTo(lexiAmbientExpand(preview, 1), 5);
    expect(lexiRibbonWidth(presented, 1)).toBeCloseTo(lexiRibbonWidth(preview, 1), 5);
    expect(lexiTransientFlash(presented)).toBeCloseTo(lexiTransientFlash(preview), 5);
    expect(exported.tempoBpm).toBe(120);
    expect(lexiAccent(presented)).toBeGreaterThan(0);
  });

  it("does not grow allocations across a long-form burst of frames on either scene", () => {
    for (const scene of [lexiScene, lexiMinimalScene]) {
      const ctx = paint(scene.id as (typeof VISUALIZER_SCENE_IDS)[number], QUIET).ctx;
      scene.onEnter?.({ width: 96, height: 54, ctx }, scene.defaultParams);
      for (let i = 0; i < 180; i++) {
        const t = i * (1000 / 30);
        const features: AudioFeatures = {
          ...QUIET,
          timeMs: t,
          rms: 0.2 + 0.2 * Math.sin(i / 8),
          bass: 0.15 + 0.1 * Math.sin(i / 5),
          mid: 0.12 + 0.18 * Math.sin(i / 6),
          beatPulse: i % 16 === 0 ? 0.8 : 0.05,
          onset: i % 16 === 0,
        };
        expect(() => {
          scene.render({ width: 96, height: 54, ctx }, features, scene.defaultParams, 1 / 30);
        }).not.toThrow();
      }
      scene.onExit?.();
    }
  });
});
