import { describe, expect, it } from "vitest";
import { createVisualEngine } from "../../src/core/visualz/engine";
import {
  createLiveFeatureState,
  stepLiveAnalyser,
} from "../../src/core/visualz/feature-extractor";
import { musicClock } from "../../src/core/visualz/motion";
import { resonanceDunesMass } from "../../src/core/visualz/scenes/resonance-dunes";
import type { AudioFeatures } from "../../src/core/visualz/types";
import { getRegisteredScene } from "../../src/core/visualz";
import { featuresFromMix, renderVisualizerScene, visFeaturesForPreview } from "../../src/core/visualizer";
import { createPixelCanvas } from "../helpers/pixel-canvas";

const BINS = 256;

function bytes(n: number, fill = 0): Uint8Array {
  const out = new Uint8Array(n);
  out.fill(fill);
  return out;
}

function fillRange(buf: Uint8Array, start: number, end: number, value: number): void {
  buf.fill(value, start, end);
}

/** Modest time-domain level so rms clears the silence floor without being a kick. */
function audibleTime(): Uint8Array {
  return bytes(128, 148);
}

function bassSpectrum(level: number): Uint8Array {
  const freq = bytes(BINS, 0);
  fillRange(freq, 0, Math.floor(BINS * 0.06), level);
  return freq;
}

function hold(
  freq: Uint8Array,
  time: Uint8Array,
  frames: number,
  t0 = 0,
  stepMs = 20,
) {
  const state = createLiveFeatureState(BINS);
  let last = stepLiveAnalyser({ freqData: freq, timeData: time, timeMs: t0, state });
  for (let i = 1; i < frames; i++) {
    last = stepLiveAnalyser({ freqData: freq, timeData: time, timeMs: t0 + i * stepMs, state });
  }
  return { state, last };
}

describe("live VIS analyser", () => {
  it("bass-only fixture keeps kick low while bass stays high", () => {
    const { last } = hold(bassSpectrum(200), audibleTime(), 24);
    expect(last.bass).toBeGreaterThan(0.5);
    expect(last.kick ?? 1).toBeLessThan(0.05);
    expect(last.onset).toBe(false);
    expect(last.beatPulse).toBeLessThan(0.05);
  });

  it("kick transient on bass spikes then decays; bass stays high without a second kick", () => {
    const time = audibleTime();
    const { state, last: settled } = hold(bassSpectrum(60), time, 30);
    expect(settled.kick ?? 1).toBeLessThan(0.05);
    expect(settled.bass).toBeGreaterThan(0.16);

    const loud = bassSpectrum(255);
    const hit = stepLiveAnalyser({ freqData: loud, timeData: time, timeMs: 1000, state });
    expect(hit.kick).toBe(1);
    expect(hit.onset).toBe(true);
    expect(hit.bass).toBeGreaterThan(0.7);

    const trail = [hit.kick ?? 0];
    let bass = hit.bass;
    for (let i = 1; i <= 6; i++) {
      const frame = stepLiveAnalyser({
        freqData: loud,
        timeData: time,
        timeMs: 1000 + i * 20,
        state,
      });
      trail.push(frame.kick ?? 0);
      bass = frame.bass;
      expect(frame.onset).toBe(false);
    }
    expect(bass).toBeGreaterThan(0.7);
    expect(trail[0]).toBe(1);
    expect(trail[trail.length - 1]!).toBeLessThan(0.6);
    for (let i = 1; i < trail.length; i++) expect(trail[i]!).toBeLessThan(trail[i - 1]!);
  });

  it("hats/treble do not raise kick or dune-mass proxies", () => {
    const freq = bytes(BINS, 0);
    fillRange(freq, Math.floor(BINS * 0.28), BINS, 220);
    const frame = stepLiveAnalyser({
      freqData: freq,
      timeData: audibleTime(),
      timeMs: 0,
      state: createLiveFeatureState(BINS),
    });
    expect(frame.kick).toBe(0);
    expect(frame.onset).toBe(false);
    expect(frame.bass).toBeLessThan(0.05);
    expect(frame.hat ?? 0).toBeGreaterThan(0.4);
    const hatMass = resonanceDunesMass(frame, 0.05, 0.4, 0.72, 0);
    const bassMass = resonanceDunesMass(
      { bass: 1, mid: 0, spectrum: new Float32Array(32) },
      0.05,
      0.4,
      0.72,
      0,
    );
    expect(hatMass).toBeLessThan(0.05);
    expect(bassMass).toBeGreaterThan(hatMass + 0.3);
  });

  it("silence zeros kick/hat/vocal/buildup/drop and musicClock delta is 0", () => {
    const state = createLiveFeatureState(BINS);
    stepLiveAnalyser({
      freqData: bassSpectrum(255),
      timeData: audibleTime(),
      timeMs: 0,
      state,
    });
    const silent = stepLiveAnalyser({
      freqData: bytes(BINS, 0),
      timeData: bytes(128, 128),
      timeMs: 200,
      state,
    });
    expect(silent.rms).toBe(0);
    expect(silent.bass).toBe(0);
    expect(silent.kick).toBe(0);
    expect(silent.snare).toBe(0);
    expect(silent.hat).toBe(0);
    expect(silent.vocal).toBe(0);
    expect(silent.buildup).toBe(0);
    expect(silent.drop).toBe(0);
    expect(silent.onset).toBe(false);
    expect(silent.beatPulse).toBe(0);
    const energy = silent.rms * 0.4 + silent.bass * 0.4 + silent.mid * 0.2;
    expect(musicClock(1 / 30, energy, silent.beatPulse, 0.85)).toBe(0);
    expect(musicClock(1 / 30, 0, 0, 1)).toBe(0);
  });
});

function packet(partial: Partial<AudioFeatures> & Pick<AudioFeatures, "bass" | "kick">): AudioFeatures {
  return {
    timeMs: 0,
    rms: 0.4,
    mid: 0,
    treble: 0,
    spectrum: new Float32Array(32),
    onset: false,
    beatPulse: partial.kick ?? 0,
    snare: 0,
    hat: 0,
    vocal: 0,
    buildup: 0,
    drop: 0,
    ...partial,
  };
}

describe("resonance-dunes reads the live vector", () => {
  it("features.kick=1 does not lift heightfield mass the way features.bass=1 does", () => {
    const bass = packet({ bass: 1, kick: 0, beatPulse: 0, onset: false });
    const kick = packet({ bass: 0, kick: 1, beatPulse: 1, onset: true });
    const u = 0.3;
    const v = 0.45;
    const massBass = resonanceDunesMass(bass, u, v, 0.72, 0);
    const massKick = resonanceDunesMass(kick, u, v, 0.72, 0);
    expect(massBass).toBeGreaterThan(massKick + 0.3);
    expect(massKick).toBeCloseTo(0, 5);

    const engine = createVisualEngine({
      canvas: {
        width: 96,
        height: 54,
        getContext() {
          return {
            fillRect() {},
            beginPath() {},
            moveTo() {},
            lineTo() {},
            stroke() {},
            fill() {},
            arc() {},
            closePath() {},
            createLinearGradient: () => ({ addColorStop() {} }),
            createRadialGradient: () => ({ addColorStop() {} }),
          };
        },
      } as unknown as HTMLCanvasElement,
      initialSceneId: "resonance-dunes",
    });
    engine.setFeatures(kick);
    expect(engine.getFeatures().kick).toBe(1);
    expect(engine.getFeatures().bass).toBe(0);
    const scene = getRegisteredScene("resonance-dunes");
    expect(scene?.id).toBe("resonance-dunes");
    const kickPx = createPixelCanvas(96, 54);
    scene?.onEnter?.({ width: 96, height: 54, ctx: kickPx.ctx }, scene.defaultParams);
    renderVisualizerScene(kickPx.ctx, 96, 54, "resonance-dunes", engine.getFeatures(), 1 / 30);
    engine.setFeatures(bass);
    const bassPx = createPixelCanvas(96, 54);
    scene?.onEnter?.({ width: 96, height: 54, ctx: bassPx.ctx }, scene.defaultParams);
    renderVisualizerScene(bassPx.ctx, 96, 54, "resonance-dunes", engine.getFeatures(), 1 / 30);
    expect(kickPx.nonemptyCount()).toBeGreaterThan(20);
    expect(bassPx.nonemptyCount()).toBeGreaterThan(20);
    expect(bassPx.fingerprint()).not.toBe(kickPx.fingerprint());
    engine.destroy();
  });

  it("preview keeps the live kick/snare/hat/vocal/buildup/drop vector", () => {
    const live = packet({
      rms: 0.55,
      bass: 0.4,
      mid: 0.2,
      treble: 0.1,
      kick: 0.8,
      snare: 0.2,
      hat: 0.35,
      vocal: 0.15,
      buildup: 0.4,
      drop: 0,
      onset: true,
      beatPulse: 0.8,
      spectrum: new Float32Array(64),
    });
    const preview = visFeaturesForPreview({
      timeMs: 0,
      durationMs: 1000,
      live,
      audioLoaded: true,
      hasClipAtPlayhead: true,
    });
    expect(preview.kick).toBe(0.8);
    expect(preview.snare).toBe(0.2);
    expect(preview.hat).toBe(0.35);
    expect(preview.vocal).toBe(0.15);
    expect(preview.buildup).toBe(0.4);
    expect(preview.drop).toBe(0);
    expect(preview.bass).not.toBe(preview.kick);
  });

  it("quiet intro below the silence floor stays zero through preview setFeatures", () => {
    const data = new Float32Array(44100);
    for (let i = 0; i < data.length; i++) data[i] = Math.sin((i / 44100) * 80 * Math.PI * 2) * 0.6;
    const mix = {
      sampleRate: 44100,
      length: data.length,
      numberOfChannels: 1,
      getChannelData: () => data,
    };
    const live: AudioFeatures = {
      timeMs: 400,
      rms: 0.01,
      bass: 0.02,
      mid: 0.4,
      treble: 0.3,
      spectrum: new Float32Array(128),
      onset: true,
      beatPulse: 1,
      kick: 1,
      snare: 0.4,
      hat: 0.5,
      vocal: 0.2,
      buildup: 0.7,
      drop: 1,
      tempoBpm: 120,
    };
    const preview = visFeaturesForPreview({
      timeMs: 400,
      durationMs: 8000,
      mix,
      live,
      audioLoaded: true,
      hasClipAtPlayhead: true,
    });
    const engine = createVisualEngine({
      canvas: {
        width: 32,
        height: 32,
        getContext() {
          return { fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {}, arc() {}, closePath() {} };
        },
      } as unknown as HTMLCanvasElement,
      initialSceneId: "resonance-dunes",
    });
    engine.setFeatures(preview);
    const vector = engine.getFeatures();
    expect(vector.timeMs).toBe(400);
    expect(vector.beatPulse).toBe(0);
    expect(vector.kick).toBe(0);
    expect(vector.snare).toBe(0);
    expect(vector.hat).toBe(0);
    expect(vector.vocal).toBe(0);
    expect(vector.buildup).toBe(0);
    expect(vector.drop).toBe(0);
    expect(vector.onset).toBe(false);
    expect(vector.rms).toBe(0);
    expect(vector.bass).toBe(0);
    expect(vector.tempoBpm).toBeNull();
    expect(vector.spectrum.length).toBe(128);
    expect(vector.spectrum.every((v) => v === 0)).toBe(true);
    const energy = vector.rms * 0.4 + vector.bass * 0.4 + vector.mid * 0.2;
    expect(musicClock(1 / 30, energy, vector.beatPulse, 0.85)).toBe(0);
    expect(featuresFromMix(mix, 400).rms).toBeGreaterThan(0.1);
    engine.destroy();
  });

  it("no live packet stays a zero vector across time, not a 120 BPM grid", () => {
    for (let t = 0; t <= 8000; t += 250) {
      const frame = visFeaturesForPreview({
        timeMs: t,
        durationMs: 8000,
        audioLoaded: false,
        hasClipAtPlayhead: false,
      });
      expect(frame.beatPulse).toBe(0);
      expect(frame.kick).toBe(0);
      expect(frame.onset).toBe(false);
      expect(frame.rms).toBe(0);
      expect(frame.bass).toBe(0);
      expect(frame.tempoBpm).toBeNull();
      expect(frame.timeMs).toBe(t);
    }
  });

  it("bass-only live packet does not mint a kick on the preview path", () => {
    const { last } = hold(bassSpectrum(200), audibleTime(), 24);
    expect(last.bass).toBeGreaterThan(0.5);
    expect(last.kick ?? 1).toBeLessThan(0.05);
    const preview = visFeaturesForPreview({
      timeMs: last.timeMs,
      durationMs: 4000,
      live: last,
      audioLoaded: true,
      hasClipAtPlayhead: true,
    });
    expect(preview.kick).toBe(0);
    expect(preview.onset).toBe(false);
    expect(preview.bass).toBeGreaterThan(0.16);
    expect(preview.tempoBpm).toBeNull();
  });
});
