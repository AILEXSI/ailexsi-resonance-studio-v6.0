import { describe, expect, it } from "vitest";
import {
  DEFAULT_VISUALIZER_SCENE_ID,
  VISUALIZER_SCENE_IDS,
  isVisualizerSceneId,
  type VisualizerSceneId,
} from "../../src/core/models";
import { createEmptyProject, deserializeProject, serializeProject } from "../../src/core/project";
import {
  beatGrid,
  energyAt,
  featuresAt,
  featuresFromMix,
  visFeaturesForExport,
  visFeaturesForPreview,
  nextSceneId,
  renderVisualizerScene,
  shouldShowVisualizer,
} from "../../src/core/visualizer";
import { builtinScenes, createVisualEngine, getRegisteredScene } from "../../src/core/visualz";
import { isSilentEnergy, SILENCE_BASS, SILENCE_RMS } from "../../src/core/visualz/feature-extractor";
import { preferLiveFeatures } from "../../src/core/visualz/playback-tap";
import type { AudioFeatures } from "../../src/core/visualz";
import { asset, clip, projectWith } from "../helpers";
import { projectHasMixAudio, mixClipsAt } from "../../src/core/models";
import { createPixelCanvas } from "../helpers/pixel-canvas";

function stubCtx(): CanvasRenderingContext2D {
  const noop = () => undefined;
  const gradient = { addColorStop: noop };
  return {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    globalAlpha: 1,
    font: "",
    fillRect: noop,
    strokeRect: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    arc: noop,
    fill: noop,
    stroke: noop,
    quadraticCurveTo: noop,
    fillText: noop,
    createRadialGradient: () => gradient,
    createLinearGradient: () => gradient,
  } as unknown as CanvasRenderingContext2D;
}

function stubCanvas(): HTMLCanvasElement {
  const ctx = stubCtx();
  return {
    width: 320,
    height: 180,
    getContext: (id: string) => (id === "2d" ? ctx : null),
    toBlob: (cb: (blob: Blob | null) => void) => cb(new Blob(["x"], { type: "image/png" })),
  } as unknown as HTMLCanvasElement;
}

const QUIET: AudioFeatures = {
  timeMs: 0,
  rms: 0,
  bass: 0,
  mid: 0,
  treble: 0,
  spectrum: new Float32Array(8),
  onset: false,
  beatPulse: 0,
};

describe("visualizer energy", () => {
  it("beatGrid 10s @120bpm has expected count", () => {
    const beats = beatGrid(10_000, 120);
    expect(beats).toHaveLength(20);
    expect(beats[0]).toBe(0);
    expect(beats[1]).toBe(500);
    expect(beats[19]).toBe(9500);
  });

  it("energyAt on a beat is ~1 and far from a beat is ~0", () => {
    const beats = beatGrid(10_000, 120);
    expect(energyAt(0, beats)).toBeCloseTo(1, 5);
    expect(energyAt(500, beats)).toBeCloseTo(1, 5);
    expect(energyAt(250, beats)).toBeCloseTo(0, 5);
    expect(energyAt(45, beats)).toBeCloseTo(0.5, 5);
  });

  it("featuresAt is a synthetic 120 BPM AudioFeatures fallback (not file FFT)", () => {
    const onBeat = featuresAt(0, 10_000);
    expect(onBeat.energy).toBeCloseTo(1, 5);
    expect(onBeat.rms).toBeCloseTo(1, 5);
    expect(onBeat.bass).toBeCloseTo(1, 5);
    expect(onBeat.treble).toBe(onBeat.high);
    expect(onBeat.timeMs).toBe(0);
    expect(onBeat.spectrum).toHaveLength(64);
    expect(onBeat.onset).toBe(true);
    expect(onBeat.beatPulse).toBeCloseTo(1, 5);
    const offBeat = featuresAt(250, 10_000);
    expect(offBeat.energy).toBeCloseTo(0, 5);
    expect(offBeat.bass).toBeCloseTo(0, 5);
    expect(offBeat.onset).toBe(false);
    // 250ms is a 240 BPM hat: treble/mid still feed the fake spectrum so bars move.
    expect(offBeat.treble).toBeGreaterThan(0);
    expect(offBeat.spectrum.some((v) => v > 0)).toBe(true);
  });

  it("visFeaturesForExport prefers loud mix PCM over the 120 BPM grid (P56)", () => {
    const loud = new Float32Array(Math.round(44100 * 0.5));
    for (let i = 0; i < loud.length; i++) loud[i] = Math.sin((i / 44100) * 220 * Math.PI * 2);
    const mix = {
      sampleRate: 44100,
      length: loud.length,
      numberOfChannels: 1,
      getChannelData: () => loud,
    };
    const fromMix = featuresFromMix(mix, 250);
    expect(fromMix.rms).toBeGreaterThan(0.15);
    expect(fromMix.spectrum).toHaveLength(1024);
    const exported = visFeaturesForExport(250, 10_000, mix);
    expect(exported.rms).toBeGreaterThan(0.15);
    expect(exported.tempoBpm).not.toBe(120);
    const silent = visFeaturesForExport(250, 10_000, {
      sampleRate: 44100,
      length: 2048,
      numberOfChannels: 1,
      getChannelData: () => new Float32Array(2048),
    });
    expect(silent.tempoBpm).toBeNull();
    expect(silent.energy).toBeCloseTo(0, 5);
    expect(silent.onset).toBe(false);
  });

  it("no-mix fallback uses project time so IN does not restart the 120 BPM grid (P100)", () => {
    const inMs = 2250;
    const durationMs = 1750;
    const preview = featuresAt(inMs, inMs + durationMs);
    const restarted = visFeaturesForExport(0, durationMs);
    const shifted = visFeaturesForExport(0, durationMs, null, { timelineOriginMs: inMs });
    expect(restarted.energy).toBeCloseTo(1, 5);
    expect(shifted.energy).toBeCloseTo(preview.energy, 5);
    expect(shifted.energy).toBeCloseTo(0, 5);
    expect(shifted.timeMs).toBe(inMs);
    expect(shifted.tempoBpm).toBe(120);
  });
});

describe("visualizer fallback rules", () => {
  it("muted or disabled → shouldShowVisualizer is false", () => {
    const p = createEmptyProject("Viz");
    expect(shouldShowVisualizer(p, 0)).toBe(true);
    expect(shouldShowVisualizer({ ...p, visualizer: { ...p.visualizer, muted: true } }, 0)).toBe(false);
    expect(shouldShowVisualizer({ ...p, visualizer: { ...p.visualizer, enabled: false } }, 0)).toBe(false);
  });

  it("unmuted video under playhead → shouldShowVisualizer is false", () => {
    const p = projectWith([
      clip({ id: "v1", assetId: "a", trackId: "V1", startMs: 0, durationMs: 2000 }),
    ]);
    expect(shouldShowVisualizer(p, 100)).toBe(false);
    expect(shouldShowVisualizer(p, 3000)).toBe(true);
  });

  it("no video + enabled → shouldShowVisualizer is true", () => {
    const p = createEmptyProject("Empty");
    expect(p.visualizer.enabled).toBe(true);
    expect(p.visualizer.muted).toBe(false);
    expect(shouldShowVisualizer(p, 0)).toBe(true);
  });

  it("VIS from-to window hides the overlay outside the span", () => {
    const p = createEmptyProject("Window");
    p.visualizer = { ...p.visualizer, startMs: 1000, durationMs: 500 };
    expect(shouldShowVisualizer(p, 999)).toBe(false);
    expect(shouldShowVisualizer(p, 1000)).toBe(true);
    expect(shouldShowVisualizer(p, 1499)).toBe(true);
    expect(shouldShowVisualizer(p, 1500)).toBe(false);
  });

  it("muted V1 still counts as user video (mute is audio-only)", () => {
    const p = projectWith([
      clip({ id: "v1", assetId: "a", trackId: "V1", startMs: 0, durationMs: 2000 }),
    ]);
    p.tracks = p.tracks.map((t) => (t.id === "V1" ? { ...t, muted: true } : t));
    expect(shouldShowVisualizer(p, 100)).toBe(false);
  });
});

describe("visualizer project persist", () => {
  it("loads old projects missing visualizer as the default", () => {
    const p = createEmptyProject("Legacy");
    const raw = JSON.parse(serializeProject(p)) as Record<string, unknown>;
    delete raw.visualizer;
    const loaded = deserializeProject(JSON.stringify(raw));
    expect(loaded.visualizer).toEqual({
      enabled: true,
      muted: false,
      sceneId: DEFAULT_VISUALIZER_SCENE_ID,
      startMs: 0,
      durationMs: 0,
      events: [],
      cues: [],
    });
    expect(loaded.visualizer.sceneId).toBe("resonance-wave");
  });

  it("round-trips visualizer scene and mute", () => {
    const p = createEmptyProject("Viz");
    p.visualizer = { enabled: true, muted: true, sceneId: "pulse-orb" };
    const loaded = deserializeProject(serializeProject(p));
    expect(loaded.visualizer).toEqual({
      enabled: true,
      muted: true,
      sceneId: "pulse-orb",
      startMs: 0,
      durationMs: 0,
      events: [],
      cues: [],
    });
  });

  it("round-trips every Visualz scene id", () => {
    for (const sceneId of VISUALIZER_SCENE_IDS) {
      const p = createEmptyProject("Viz");
      p.visualizer = { enabled: true, muted: false, sceneId };
      expect(deserializeProject(serializeProject(p)).visualizer.sceneId).toBe(sceneId);
    }
  });
});

describe("Visualz scene registry", () => {
  it("registers all catalog Visualz ids and isVisualizerSceneId accepts each", () => {
    expect(VISUALIZER_SCENE_IDS).toEqual([
      "spectrum-bars",
      "pulse-orb",
      "aurora-veil",
      "star-bloom",
      "liquid-gold",
      "kaleido-hex",
      "sun-core",
      "ember-rain",
      "particle-field",
      "resonance-wave",
      "resonance-dunes",
      "tunnel-spiral",
      "lita-bloom",
      "void-lattice",
      "nebula-helix",
      "accretion-disk",
      "crystal-storm",
      "lexi",
      "lexi-ref",
      "lexi-2036",
      "lexi-v3",
      "lexi-v2",
      "lexi-minimal",
      "lexi-v1",
    ]);
    expect(new Set(VISUALIZER_SCENE_IDS).size).toBe(VISUALIZER_SCENE_IDS.length);
    expect(builtinScenes.map((s) => s.id)).toEqual([...VISUALIZER_SCENE_IDS]);
    for (const id of VISUALIZER_SCENE_IDS) {
      expect(isVisualizerSceneId(id)).toBe(true);
      expect(getRegisteredScene(id)?.id).toBe(id);
    }
    expect(isVisualizerSceneId("milkdrop")).toBe(false);
    expect(isVisualizerSceneId("silk-ribbons")).toBe(false);
    expect(isVisualizerSceneId("")).toBe(false);
  });

  it("nextSceneId cycles all catalog ids without repeats until wrap", () => {
    const seen: string[] = [];
    let current: VisualizerSceneId = VISUALIZER_SCENE_IDS[0]!;
    for (let i = 0; i < VISUALIZER_SCENE_IDS.length; i++) {
      expect(seen).not.toContain(current);
      seen.push(current);
      current = nextSceneId(current);
    }
    expect(seen).toEqual([...VISUALIZER_SCENE_IDS]);
    expect(current).toBe(VISUALIZER_SCENE_IDS[0]);
    expect(nextSceneId("lita-bloom")).toBe("void-lattice");
    expect(nextSceneId("crystal-storm")).toBe("lexi");
    expect(nextSceneId("lexi")).toBe("lexi-ref");
    expect(nextSceneId("lexi-v1")).toBe("spectrum-bars");
  });

  it("each Visualz scene paints non-empty pixels and the catalog frames differ", () => {
    const features = featuresAt(0, 10_000);
    const prints = new Map<string, string>();
    for (const id of VISUALIZER_SCENE_IDS) {
      const buf = createPixelCanvas(96, 54);
      renderVisualizerScene(buf.ctx, 96, 54, id, features, 1 / 30);
      const painted = buf.nonemptyCount();
      expect(painted, `${id} painted ${painted} pixels`).toBeGreaterThan(20);
      prints.set(id, buf.fingerprint());
    }
    const unique = new Set(prints.values());
    // lexi-v2 and lexi-minimal share the V2 paint (kept as two named library entries).
    expect(prints.get("lexi-v2")).toBe(prints.get("lexi-minimal"));
    expect(unique.size, `fingerprints ${JSON.stringify(Object.fromEntries(prints))}`).toBe(
      VISUALIZER_SCENE_IDS.length - 1,
    );
  });

  it("each scene render function can be called without throwing", () => {
    const ctx = stubCtx();
    const features = featuresAt(0, 10_000);
    for (const scene of builtinScenes) {
      expect(() => {
        scene.onEnter?.({ width: 320, height: 180, ctx }, scene.defaultParams);
        scene.render({ width: 320, height: 180, ctx }, features, scene.defaultParams, 1 / 30);
        scene.onExit?.();
      }).not.toThrow();
      expect(() => {
        renderVisualizerScene(ctx, 320, 180, scene.id as (typeof VISUALIZER_SCENE_IDS)[number], features, 1 / 30);
      }).not.toThrow();
    }
  });

  it("createVisualEngine lists the catalog builtins and setScene switches", () => {
    const engine = createVisualEngine({ canvas: stubCanvas(), initialSceneId: "resonance-wave" });
    const ids = engine.listScenes().map((s) => s.id);
    expect(ids).toEqual([...VISUALIZER_SCENE_IDS]);
    expect(engine.getState().currentSceneId).toBe("resonance-wave");
    engine.setScene("tunnel-spiral");
    expect(engine.getState().currentSceneId).toBe("tunnel-spiral");
    engine.setFeatures(featuresAt(0, 1000));
    engine.destroy();
  });
});

describe("live vs synthetic feature prefer", () => {
  it("keeps the synthetic fallback when the analyser is quiet", () => {
    const fallback = featuresAt(0, 10_000);
    expect(preferLiveFeatures(null, fallback)).toBe(fallback);
    expect(preferLiveFeatures(QUIET, fallback)).toBe(fallback);
  });

  it("uses live analyser features when they have energy", () => {
    const fallback = featuresAt(250, 10_000);
    const live: AudioFeatures = { ...QUIET, rms: 0.4, bass: 0.3 };
    expect(preferLiveFeatures(live, fallback)).toBe(live);
  });

  it("loaded audio does not fall back to the 120 BPM grid when the tap is quiet", () => {
    const metronome = featuresAt(0, 10_000);
    expect(metronome.tempoBpm).toBe(120);
    expect(metronome.energy).toBeCloseTo(1, 5);
    const preview = visFeaturesForPreview({
      timeMs: 0,
      durationMs: 10_000,
      live: QUIET,
      audioLoaded: true,
    });
    expect(preview.tempoBpm).toBeNull();
    expect(preview.energy).toBeCloseTo(0, 5);
    expect(preview.onset).toBe(false);
  });

  it("Visualz silence floors trip below rms 0.02 and bass 0.03", () => {
    expect(SILENCE_RMS).toBe(0.02);
    expect(SILENCE_BASS).toBe(0.03);
    expect(isSilentEnergy(0.019, 0.029)).toBe(true);
    expect(isSilentEnergy(0.02, 0.029)).toBe(false);
    expect(isSilentEnergy(0.019, 0.03)).toBe(false);
  });
});

function clickMix(bpm: number, durationMs = 4000, sampleRate = 44100) {
  const n = Math.round((sampleRate * durationMs) / 1000);
  const data = new Float32Array(n);
  const intervalSec = 60 / bpm;
  const clickN = Math.round(sampleRate * 0.012);
  for (let beat = 0; beat * intervalSec * 1000 < durationMs - 1; beat++) {
    const start = Math.round(beat * intervalSec * sampleRate);
    for (let i = 0; i < clickN && start + i < n; i++) {
      const env = 1 - i / clickN;
      const t = i / sampleRate;
      data[start + i] =
        env * (0.95 * Math.sin(2 * Math.PI * 70 * t) + 0.3 * Math.sin(2 * Math.PI * 160 * t));
    }
  }
  return {
    sampleRate,
    length: n,
    numberOfChannels: 1,
    getChannelData: () => data,
  };
}

function onsetTimes(buf: ReturnType<typeof clickMix>, durationMs: number, hop = 10): number[] {
  const hits: number[] = [];
  for (let t = 0; t < durationMs; t += hop) {
    if (featuresFromMix(buf, t).onset) hits.push(t);
  }
  return hits;
}

function medianGap(times: number[]): number {
  const gaps = [];
  for (let i = 1; i < times.length; i++) gaps.push(times[i]! - times[i - 1]!);
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)] ?? NaN;
}

describe("visualizer timing from loaded audio (not 120 BPM metronome)", () => {
  it("click tracks at 90/120/143/174 BPM produce matching onset intervals, not a stuck 500ms grid", () => {
    const cases = [
      { bpm: 90, interval: 60_000 / 90 },
      { bpm: 120, interval: 500 },
      { bpm: 143, interval: 60_000 / 143 },
      { bpm: 174, interval: 60_000 / 174 },
    ];
    const measured: Record<number, number> = {};
    for (const { bpm, interval } of cases) {
      const buf = clickMix(bpm, 4000);
      const hits = onsetTimes(buf, 4000);
      expect(hits.length, `${bpm} BPM onsets`).toBeGreaterThan(3);
      const gap = medianGap(hits);
      measured[bpm] = gap;
      expect(gap, `${bpm} BPM gap ${gap}`).toBeGreaterThan(interval - 40);
      expect(gap, `${bpm} BPM gap ${gap}`).toBeLessThan(interval + 40);
      const at500 = visFeaturesForExport(500, 4000, buf);
      expect(at500.tempoBpm).toBeNull();
      if (bpm !== 120) {
        expect(at500.energy, `${bpm} BPM must not spike at the 120-grid 500ms`).toBeLessThan(0.35);
        expect(featuresAt(500, 4000).energy).toBeCloseTo(1, 5);
      }
    }
    expect(measured[90]).not.toBeCloseTo(500, 0);
    expect(measured[143]).not.toBeCloseTo(500, 0);
    expect(measured[174]).not.toBeCloseTo(500, 0);
    expect(Math.abs(measured[90]! - measured[174]!)).toBeGreaterThan(200);
  });

  it("changing the loaded audio changes derived visual timing", () => {
    const slow = clickMix(90, 3000);
    const fast = clickMix(174, 3000);
    const slowHits = onsetTimes(slow, 3000);
    const fastHits = onsetTimes(fast, 3000);
    expect(medianGap(fastHits)).toBeLessThan(medianGap(slowHits) - 150);
    expect(fastHits.length).toBeGreaterThan(slowHits.length);
    const previewAt500 = visFeaturesForPreview({
      timeMs: 500,
      durationMs: 3000,
      mix: slow,
      audioLoaded: true,
    });
    expect(previewAt500.beatPulse).toBe(0);
    expect(previewAt500.tempoBpm).toBeNull();
    expect(previewAt500.energy).toBe(0);
    expect(featuresAt(500, 3000).tempoBpm).toBe(120);
  });
});

function toneThenSilence(toneMs: number, silenceMs: number, sampleRate = 44100) {
  const n = Math.round((sampleRate * (toneMs + silenceMs)) / 1000);
  const data = new Float32Array(n);
  const toneN = Math.round((sampleRate * toneMs) / 1000);
  for (let i = 0; i < toneN; i++) {
    data[i] = Math.sin((i / sampleRate) * 220 * Math.PI * 2);
  }
  return {
    sampleRate,
    length: n,
    numberOfChannels: 1,
    getChannelData: () => data,
  };
}

describe("VIS silence / gap at playhead (Visualz gate, no metronome)", () => {
  it("true silence in mix PCM zeros energy/onset/beatPulse even after a recent tone", () => {
    const buf = toneThenSilence(200, 800);
    const loud = featuresFromMix(buf, 80);
    expect(loud.energy).toBeGreaterThan(0.15);
    expect(loud.rms).toBeGreaterThan(0.15);
    expect(loud.tempoBpm).toBeNull();
    const gap = featuresFromMix(buf, 600);
    expect(gap.energy).toBeCloseTo(0, 5);
    expect(gap.rms).toBeCloseTo(0, 5);
    expect(gap.onset).toBe(false);
    expect(gap.beatPulse).toBeCloseTo(0, 5);
    expect(gap.tempoBpm).toBeNull();
    expect(featuresAt(600, 2000).energy).toBeCloseTo(0, 5);
    expect(featuresAt(500, 2000).energy).toBeCloseTo(1, 5);
  });

  it("missing clip at playhead is treated as no PCM — quiet, not featuresAt", () => {
    const buf = toneThenSilence(200, 0);
    const fromStaleMix = visFeaturesForPreview({
      timeMs: 80,
      durationMs: 8000,
      mix: buf,
      audioLoaded: true,
      hasClipAtPlayhead: false,
    });
    expect(fromStaleMix.energy).toBeCloseTo(0, 5);
    expect(fromStaleMix.beatPulse).toBeCloseTo(0, 5);
    expect(fromStaleMix.onset).toBe(false);
    expect(fromStaleMix.tempoBpm).toBeNull();
  });

  it("playhead in an A1/mix gap does not let featuresAt or leftover live drive VIS", () => {
    const metronome = featuresAt(0, 10_000);
    expect(metronome.energy).toBeCloseTo(1, 5);
    expect(metronome.beatPulse).toBeCloseTo(1, 5);
    const leftoverLive: AudioFeatures = { ...QUIET, rms: 0.5, bass: 0.4, beatPulse: 1, onset: true };
    const gap = visFeaturesForPreview({
      timeMs: 0,
      durationMs: 10_000,
      mix: null,
      live: leftoverLive,
      audioLoaded: true,
      hasClipAtPlayhead: false,
    });
    expect(gap.energy).toBeCloseTo(0, 5);
    expect(gap.rms).toBeCloseTo(0, 5);
    expect(gap.onset).toBe(false);
    expect(gap.beatPulse).toBeCloseTo(0, 5);
    expect(gap.tempoBpm).toBeNull();
  });

  it("preview without a live packet stays zero while mix PCM still carries the tone", () => {
    const buf = toneThenSilence(400, 400);
    const preview = visFeaturesForPreview({
      timeMs: 80,
      durationMs: 2000,
      mix: buf,
      audioLoaded: true,
      hasClipAtPlayhead: true,
    });
    expect(preview.energy).toBe(0);
    expect(preview.rms).toBe(0);
    expect(preview.beatPulse).toBe(0);
    expect(preview.tempoBpm).toBeNull();
    expect(featuresFromMix(buf, 80).rms).toBeGreaterThan(0.15);
  });

  it("empty project preview is a zero vector, not the 120 BPM grid", () => {
    const empty = visFeaturesForPreview({
      timeMs: 0,
      durationMs: 10_000,
      audioLoaded: false,
      hasClipAtPlayhead: false,
    });
    expect(empty.tempoBpm).toBeNull();
    expect(empty.beatPulse).toBe(0);
    expect(empty.energy).toBe(0);
    expect(featuresAt(0, 10_000).tempoBpm).toBe(120);
  });

  it("projectHasMixAudio is true in an A1 waveform gap so preview stays on the audio path", () => {
    const p = projectWith(
      [
        clip({ id: "left", assetId: "song", trackId: "A1", startMs: 0, durationMs: 137_000 }),
        clip({ id: "right", assetId: "song", trackId: "A1", startMs: 139_000, durationMs: 10_000 }),
      ],
      [asset({ id: "song", kind: "audio", durationMs: 180_000 })],
    );
    expect(projectHasMixAudio(p)).toBe(true);
    expect(mixClipsAt(p, 138_000)).toEqual([]);
    const preview = visFeaturesForPreview({
      timeMs: 138_000,
      durationMs: 180_000,
      mix: null,
      live: QUIET,
      audioLoaded: projectHasMixAudio(p),
      hasClipAtPlayhead: mixClipsAt(p, 138_000).length > 0,
    });
    expect(preview.energy).toBeCloseTo(0, 5);
    expect(preview.beatPulse).toBeCloseTo(0, 5);
    expect(featuresAt(138_000, 180_000).tempoBpm).toBe(120);
  });
});
