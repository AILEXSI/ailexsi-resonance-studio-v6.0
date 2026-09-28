import { describe, expect, it } from "vitest";
import {
  createExportFeatureSession,
  featuresFromMix,
  presentVisualizerFeatures,
  visFeaturesForExport,
  visFeaturesForPreview,
  type MixPcm,
} from "../../src/core/visualizer";
import {
  ANALYSER_FFT_SIZE,
  ANALYSER_MAX_DECIBELS,
  ANALYSER_MIN_DECIBELS,
  ANALYSER_SMOOTHING,
  createOfflineFeatureExtractor,
} from "../../src/core/visualz/feature-extractor";
import {
  latticeWarp,
  resonanceCoreRadius,
  resonanceRingPulse,
} from "../../src/core/visualz/scene-impact";
import {
  applyVisResponse,
  DEFAULT_VIS_RESPONSE,
  shapeVisLevel,
  VIS_RESPONSE_01,
  type RawAudioFeatures,
} from "../../src/core/visualz/vis-response";

const SR = 44100;

function pcm(data: Float32Array, sampleRate = SR): MixPcm {
  return {
    sampleRate,
    length: data.length,
    numberOfChannels: 1,
    getChannelData: () => data,
  } as MixPcm;
}

function silence(durationMs: number): Float32Array {
  return new Float32Array(Math.round((SR * durationMs) / 1000));
}

function sineAt(freqHz: number, durationMs: number, amp: number): Float32Array {
  const n = Math.round((SR * durationMs) / 1000);
  const data = new Float32Array(n);
  for (let i = 0; i < n; i++) data[i] = amp * Math.sin((2 * Math.PI * freqHz * i) / SR);
  return data;
}

function kickAt(data: Float32Array, timeMs: number, amp = 0.95): void {
  const start = Math.round((timeMs / 1000) * SR);
  const clickN = Math.round(SR * 0.012);
  for (let i = 0; i < clickN && start + i < data.length; i++) {
    const env = 1 - i / clickN;
    const t = i / SR;
    data[start + i] =
      env * amp * (0.95 * Math.sin(2 * Math.PI * 70 * t) + 0.3 * Math.sin(2 * Math.PI * 160 * t));
  }
}

function snareAt(data: Float32Array, timeMs: number, amp = 1): void {
  const start = Math.round((timeMs / 1000) * SR);
  const clickN = Math.round(SR * 0.008);
  let seed = 1;
  for (let i = 0; i < clickN && start + i < data.length; i++) {
    seed = (seed * 16807) % 2147483647;
    const noise = (seed / 2147483647) * 2 - 1;
    const env = 1 - i / clickN;
    const t = i / SR;
    data[start + i] = env * amp * (0.55 * noise + 0.35 * Math.sin(2 * Math.PI * 220 * t));
  }
}

function scaleAmp(data: Float32Array, gain: number): Float32Array {
  const out = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = (data[i] ?? 0) * gain;
  return out;
}

function rawAt(buf: MixPcm, timeMs: number): RawAudioFeatures {
  return createOfflineFeatureExtractor(buf).sample(timeMs);
}

function visAt(buf: MixPcm, timeMs: number) {
  return visFeaturesForExport(timeMs, 4000, buf);
}

function orbBreath(bass: number): number {
  return 1 + bass * 0.55;
}

function specPeak(spec: ArrayLike<number>): number {
  let p = 0;
  for (let i = 0; i < spec.length; i++) if ((spec[i] ?? 0) > p) p = spec[i] ?? 0;
  return p;
}

function specMean(spec: ArrayLike<number>): number {
  if (spec.length === 0) return 0;
  let s = 0;
  for (let i = 0; i < spec.length; i++) s += spec[i] ?? 0;
  return s / spec.length;
}

function barsPeakPow(spec: ArrayLike<number>, barCount = 48): number {
  let peak = 0;
  for (let i = 0; i < barCount; i++) {
    const t = i / (barCount - 1);
    const idx = Math.floor(t * Math.max(0, spec.length - 1));
    const v = Math.pow(spec[idx] ?? 0, 0.85);
    if (v > peak) peak = v;
  }
  return peak;
}

describe("VIS-RESPONSE-01 phase 1 — measured cause (raw analyser, 3b16a09 semantics)", () => {
  it("keeps the VIS-SYNC-01 analyser core untouched", () => {
    expect(ANALYSER_FFT_SIZE).toBe(2048);
    expect(ANALYSER_SMOOTHING).toBe(0.75);
    expect(ANALYSER_MIN_DECIBELS).toBe(-100);
    expect(ANALYSER_MAX_DECIBELS).toBe(-30);
    expect(VIS_RESPONSE_01.gain).toBe(1.2);
    expect(VIS_RESPONSE_01.gamma).toBe(0.75);
    expect(VIS_RESPONSE_01.spectrumSpreadBins).toBe(12);
    expect(VIS_RESPONSE_01.transientBoost).toBe(0.24);
    expect(DEFAULT_VIS_RESPONSE.gain).toBe(1.25);
    expect(DEFAULT_VIS_RESPONSE.gamma).toBe(0.68);
    expect(DEFAULT_VIS_RESPONSE.spectrumSpreadBins).toBe(18);
    expect(DEFAULT_VIS_RESPONSE.transientBoost).toBe(0.38);
  });

  it("B+A+C+E: loud tones have useful RMS but diluted bass / missed bars / tiny orb breath", () => {
    const quiet = rawAt(pcm(sineAt(220, 800, 0.06)), 400);
    const pad = rawAt(pcm(sineAt(220, 800, 0.35)), 400);
    const bass = rawAt(pcm(sineAt(55, 800, 0.55)), 400);
    const kickData = silence(800);
    kickAt(kickData, 240);
    const kick = rawAt(pcm(kickData), 260);

    // RMS is amplitude-true. Bass is occupancy of a 170-bin dB-sat average.
    expect(pad.rms).toBeGreaterThan(0.4);
    expect(pad.bass).toBeLessThan(0.08);
    expect(bass.rms).toBeGreaterThan(0.7);
    expect(bass.bass).toBeLessThan(0.08);
    expect(Math.abs(pad.bass - bass.bass)).toBeLessThan(0.02);

    expect(orbBreath(pad.bass)).toBeLessThan(1.05);
    expect(orbBreath(kick.bass)).toBeLessThan(1.12);
    expect(orbBreath(quiet.bass)).toBeLessThan(1.03);

    expect(specPeak(pad.spectrum)).toBeGreaterThan(0.9);
    expect(specMean(pad.spectrum)).toBeLessThan(0.02);
    expect(barsPeakPow(pad.spectrum)).toBeLessThan(0.15);

    expect(kick.rms * 0.5 + kick.bass * 0.5).toBeLessThan(0.35);
  });

  it("110 Hz amp sweep: raw bass barely moves while RMS tracks amplitude (no AGC in analyser)", () => {
    const bassAt: number[] = [];
    const rmsAt: number[] = [];
    for (const amp of [0.1, 0.5, 1.0]) {
      const f = rawAt(pcm(sineAt(110, 600, amp)), 250);
      bassAt.push(f.bass);
      rmsAt.push(f.rms);
    }
    expect(bassAt[2]! - bassAt[0]!).toBeLessThan(0.03);
    expect(rmsAt[1]!).toBeGreaterThan(rmsAt[0]! * 1.8);
    expect(rmsAt[2]!).toBeGreaterThan(rmsAt[1]!);
  });
});

describe("VIS-RESPONSE-01 applyVisResponse", () => {
  it("1 silence → zero / near-zero", () => {
    const vis = visAt(pcm(silence(500)), 200);
    expect(vis.rms).toBeCloseTo(0, 5);
    expect(vis.bass).toBeCloseTo(0, 5);
    expect(vis.energy).toBeCloseTo(0, 5);
    expect(vis.beatPulse).toBeCloseTo(0, 5);
    expect(vis.onset).toBe(false);
    expect(specPeak(vis.spectrum)).toBeCloseTo(0, 5);
  });

  it("2 amplitude 0.25 < 0.50 < 1.00 on major channels", () => {
    const a25 = visAt(pcm(sineAt(110, 600, 0.25)), 250);
    const a50 = visAt(pcm(sineAt(110, 600, 0.5)), 250);
    const a100 = visAt(pcm(sineAt(110, 600, 1)), 250);
    for (const key of ["rms", "bass", "energy"] as const) {
      expect(a25[key], key).toBeLessThan(a50[key]);
      expect(a50[key], key).toBeLessThan(a100[key]);
    }
    expect(specPeak(a25.spectrum)).toBeLessThan(specPeak(a50.spectrum) + 1e-9);
    expect(specPeak(a50.spectrum)).toBeLessThanOrEqual(specPeak(a100.spectrum) + 1e-9);
  });

  it("3 muted (zero PCM) → zero", () => {
    const tone = sineAt(180, 600, 0.4);
    const muted = visAt(pcm(scaleAmp(tone, 0)), 250);
    expect(muted.rms).toBeCloseTo(0, 5);
    expect(muted.energy).toBeCloseTo(0, 5);
    expect(muted.beatPulse).toBeCloseTo(0, 5);
    expect(applyVisResponse(rawAt(pcm(scaleAmp(tone, 0)), 250)).bass).toBeCloseTo(0, 5);
  });

  it("4 automation reduction lowers response", () => {
    const n = Math.round(SR * 1.0);
    const data = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const env = t < 0.45 ? 0.08 : 0.45;
      data[i] = env * Math.sin(2 * Math.PI * 180 * t);
    }
    const session = createExportFeatureSession(pcm(data), { hopMs: 1000 / 30 });
    const quiet = session.sample(200);
    const loud = session.sample(700);
    expect(loud.rms).toBeGreaterThan(quiet.rms * 1.4);
    expect(loud.energy).toBeGreaterThan(quiet.energy);
    expect(loud.bass).toBeGreaterThan(quiet.bass);
  });

  it("5 kick transient is stronger than the same kick's later tail and a pad's continuous energy", () => {
    const kickData = silence(1200);
    kickAt(kickData, 240);
    const session = createExportFeatureSession(pcm(kickData), { hopMs: 1000 / 30 });
    let atOnset = session.sample(0);
    for (let t = 1000 / 30; t <= 280; t += 1000 / 30) {
      const f = session.sample(t);
      if (f.onset || f.energy > atOnset.energy) atOnset = f;
    }
    const tail = session.sample(700);
    const pad = visAt(pcm(sineAt(220, 800, 0.35)), 400);
    expect(atOnset.beatPulse).toBeGreaterThan(0.7);
    expect(atOnset.energy).toBeGreaterThan(tail.energy);
    expect(atOnset.energy).toBeGreaterThan(pad.energy * 0.85);
    expect(atOnset.onset || atOnset.beatPulse > 0.8).toBe(true);
    // Continuous RMS/bands are not onset-inflated: pad bass stays below 1.
    expect(pad.bass).toBeLessThan(0.95);
    expect(pad.rms).toBeLessThan(0.95);
  });

  it("6 sustained pad does not permanently max out", () => {
    const pad = visAt(pcm(sineAt(220, 1200, 0.35)), 800);
    expect(pad.rms).toBeGreaterThan(0.4);
    expect(pad.rms).toBeLessThan(0.95);
    expect(pad.bass).toBeGreaterThan(0.35);
    expect(pad.bass).toBeLessThan(0.95);
    expect(pad.energy).toBeLessThan(0.95);
    expect(pad.onset).toBe(false);
  });

  it("7 spectrum response is bounded 0..1", () => {
    for (const buf of [
      pcm(silence(400)),
      pcm(sineAt(220, 400, 0.35)),
      pcm(sineAt(55, 400, 1)),
    ]) {
      const vis = visAt(buf, 200);
      expect(vis.spectrum.length).toBe(1024);
      for (let i = 0; i < vis.spectrum.length; i++) {
        expect(vis.spectrum[i]!).toBeGreaterThanOrEqual(0);
        expect(vis.spectrum[i]!).toBeLessThanOrEqual(1);
      }
    }
    const kickData = silence(800);
    kickAt(kickData, 200);
    snareAt(kickData, 400);
    const vis = visAt(pcm(kickData), 420);
    for (let i = 0; i < vis.spectrum.length; i++) {
      expect(vis.spectrum[i]!).toBeGreaterThanOrEqual(0);
      expect(vis.spectrum[i]!).toBeLessThanOrEqual(1);
    }
  });

  it("8 Export and mix PCM share one transform; preview without a live packet stays zero", () => {
    const buf = pcm(sineAt(80, 600, 0.4));
    const preview = visFeaturesForPreview({
      timeMs: 250,
      durationMs: 600,
      mix: buf,
      audioLoaded: true,
      hasClipAtPlayhead: true,
    });
    const exported = visFeaturesForExport(250, 600, buf);
    const fromMix = featuresFromMix(pcm(sineAt(80, 600, 0.4)), 250);
    expect(preview.rms).toBe(0);
    expect(preview.beatPulse).toBe(0);
    expect(preview.kick).toBe(0);
    expect(preview.tempoBpm).toBeNull();
    expect(fromMix.rms).toBeCloseTo(exported.rms, 5);
    const raw = rawAt(buf, 250);
    const once = applyVisResponse(raw);
    expect(presentVisualizerFeatures(raw).rms).toBeCloseTo(once.rms, 5);
    expect(exported.rms).toBeCloseTo(once.rms, 5);
  });

  it("does not mutate raw FFT state", () => {
    const raw = rawAt(pcm(sineAt(220, 600, 0.35)), 250);
    const peakBefore = specPeak(raw.spectrum);
    const presented = applyVisResponse(raw);
    expect(specPeak(raw.spectrum)).toBeCloseTo(peakBefore, 8);
    expect(presented.spectrum).not.toBe(raw.spectrum);
    expect(raw.bass).toBeLessThan(0.08);
    expect(presented.bass).toBeGreaterThan(0.35);
  });

  it("monotonicity sweep 0.0..1.0 step 0.1 — no downward inversion", () => {
    const rows = [];
    for (let a = 0; a <= 1.001; a += 0.1) {
      const amp = +a.toFixed(1);
      const vis = visAt(pcm(sineAt(110, 600, amp)), 250);
      rows.push({
        amp,
        rms: vis.rms,
        bass: vis.bass,
        mid: vis.mid,
        treble: vis.treble,
        energy: vis.energy,
        specPeak: specPeak(vis.spectrum),
      });
    }
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1]!;
      const cur = rows[i]!;
      expect(cur.rms, `rms ${prev.amp}→${cur.amp}`).toBeGreaterThanOrEqual(prev.rms - 1e-9);
      expect(cur.bass, `bass ${prev.amp}→${cur.amp}`).toBeGreaterThanOrEqual(prev.bass - 1e-9);
      expect(cur.energy, `energy ${prev.amp}→${cur.amp}`).toBeGreaterThanOrEqual(prev.energy - 1e-9);
      expect(cur.specPeak, `spec ${prev.amp}→${cur.amp}`).toBeGreaterThanOrEqual(prev.specPeak - 1e-9);
    }
  });

  it("shapeVisLevel is monotonic and mute-safe", () => {
    const { gain, gamma } = DEFAULT_VIS_RESPONSE;
    expect(shapeVisLevel(0, gain, gamma)).toBe(0);
    expect(shapeVisLevel(1, gain, gamma)).toBe(1);
    let prev = 0;
    for (let x = 0; x <= 1.001; x += 0.05) {
      const y = shapeVisLevel(x, gain, gamma);
      expect(y).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = y;
    }
  });

  it("live tap uses the same response as mix (no preview-only boost)", () => {
    const mix = pcm(sineAt(80, 400, 0.4));
    const live: RawAudioFeatures = {
      timeMs: 100,
      rms: 0.55,
      bass: 0.4,
      mid: 0.2,
      treble: 0.1,
      spectrum: new Float32Array(1024),
      onset: true,
      beatPulse: 1,
      tempoBpm: null,
    };
    const preview = visFeaturesForPreview({
      timeMs: 100,
      durationMs: 400,
      mix,
      live,
      audioLoaded: true,
      hasClipAtPlayhead: true,
    });
    const presented = applyVisResponse(live);
    expect(preview.rms).toBeCloseTo(presented.rms, 5);
    expect(preview.energy).toBeCloseTo(presented.energy, 5);
    expect(preview.onset).toBe(true);
  });
});

describe("VIS-RESPONSE-02 retune vs 01", () => {
  it("pad 0.35 stays below hard clip; quiet stays well below pad", () => {
    const pad = visAt(pcm(sineAt(220, 800, 0.35)), 400);
    const quiet = visAt(pcm(sineAt(220, 800, 0.06)), 400);
    const rawPad = rawAt(pcm(sineAt(220, 800, 0.35)), 400);
    expect(rawPad.rms).toBeGreaterThan(0.45);
    expect(rawPad.rms).toBeLessThan(0.55);
    expect(pad.rms).toBeGreaterThan(0.55);
    expect(pad.rms).toBeLessThan(0.9);
    expect(pad.bass).toBeLessThan(0.9);
    expect(quiet.rms).toBeLessThan(pad.rms * 0.5);
    expect(quiet.bass).toBeLessThan(pad.bass * 0.5);
  });

  it("02 lifts kick energy / mid vs 01 without AGC", () => {
    const kickData = silence(800);
    kickAt(kickData, 240);
    const rawKick = rawAt(pcm(kickData), 260);
    const v01 = applyVisResponse(rawKick, VIS_RESPONSE_01);
    const v02 = applyVisResponse(rawKick, DEFAULT_VIS_RESPONSE);
    expect(v02.energy).toBeGreaterThan(v01.energy);
    expect(v02.rms).toBeGreaterThan(v01.rms);

    const snareData = silence(800);
    snareAt(snareData, 240);
    const rawSnare = rawAt(pcm(snareData), 256);
    const s01 = applyVisResponse(rawSnare, VIS_RESPONSE_01);
    const s02 = applyVisResponse(rawSnare, DEFAULT_VIS_RESPONSE);
    expect(s02.mid).toBeGreaterThan(s01.mid);
    expect(s02.mid).toBeLessThan(1);

    const rawPad = rawAt(pcm(sineAt(220, 800, 0.35)), 400);
    const p01 = applyVisResponse(rawPad, VIS_RESPONSE_01);
    const p02 = applyVisResponse(rawPad, DEFAULT_VIS_RESPONSE);
    expect(p02.rms).toBeGreaterThan(p01.rms);
    expect(p02.rms).toBeLessThan(0.9);
  });

  it("Lattice / Wave kick geometry is stronger than a pad, quiet stays small", () => {
    const pad = visAt(pcm(sineAt(220, 800, 0.35)), 400);
    const quiet = visAt(pcm(sineAt(220, 800, 0.06)), 400);
    const kickData = silence(800);
    kickAt(kickData, 240);
    const session = createExportFeatureSession(pcm(kickData), { hopMs: 1000 / 30 });
    let kick = session.sample(0);
    for (let t = 1000 / 30; t <= 280; t += 1000 / 30) {
      const f = session.sample(t);
      if (f.onset || f.beatPulse > kick.beatPulse) kick = f;
    }
    const int = 0.85;
    expect(resonanceRingPulse(kick, int)).toBeGreaterThan(resonanceRingPulse(pad, int));
    expect(resonanceRingPulse(quiet, int)).toBeLessThan(resonanceRingPulse(pad, int));
    expect(resonanceCoreRadius(kick, int)).toBeGreaterThan(resonanceCoreRadius(pad, int));
    expect(latticeWarp(kick, int)).toBeGreaterThan(latticeWarp(pad, int));
    expect(latticeWarp(quiet, int)).toBeLessThan(latticeWarp(pad, int) * 0.55);
    // 01 lattice was bass-only: a loud pad warped more than a kick. 02 must flip that.
    const oldKickWarp = kick.bass * 0.42 * int;
    expect(latticeWarp(kick, int)).toBeGreaterThan(oldKickWarp + 0.15);
  });
});

describe("VIS-RESPONSE scene-useful ranges", () => {
  it("pad breathes and kick flashes without retuning scenes", () => {
    const pad = visAt(pcm(sineAt(220, 800, 0.35)), 400);
    const quiet = visAt(pcm(sineAt(220, 800, 0.06)), 400);
    const kickData = silence(800);
    kickAt(kickData, 240);
    const kick = visAt(pcm(kickData), 260);

    expect(orbBreath(pad.bass)).toBeGreaterThan(1.25);
    expect(orbBreath(quiet.bass)).toBeLessThan(orbBreath(pad.bass) - 0.1);
    expect(orbBreath(quiet.bass)).toBeGreaterThan(1.05);
    expect(kick.beatPulse).toBeGreaterThan(0.7);
    expect(barsPeakPow(pad.spectrum)).toBeGreaterThan(0.25);
    expect(barsPeakPow(quiet.spectrum)).toBeLessThan(barsPeakPow(pad.spectrum));
  });

  it("before/after table: presentation lifts diluted bands, not raw FFT", () => {
    const cases: { name: string; buf: MixPcm; t: number }[] = [
      { name: "silence", buf: pcm(silence(500)), t: 200 },
      { name: "quiet", buf: pcm(sineAt(220, 800, 0.06)), t: 400 },
      { name: "pad", buf: pcm(sineAt(220, 800, 0.35)), t: 400 },
      { name: "bass", buf: pcm(sineAt(55, 800, 0.55)), t: 400 },
    ];
    const kickData = silence(800);
    kickAt(kickData, 240);
    cases.push({ name: "kick", buf: pcm(kickData), t: 260 });
    const table = cases.map(({ name, buf, t }) => {
      const raw = rawAt(buf, t);
      const vis = visAt(buf, t);
      return {
        name,
        rawBass: +raw.bass.toFixed(4),
        visBass: +vis.bass.toFixed(4),
        rawRms: +raw.rms.toFixed(4),
        visRms: +vis.rms.toFixed(4),
        rawEnergy: +(raw.rms * 0.5 + raw.bass * 0.5).toFixed(4),
        visEnergy: +vis.energy.toFixed(4),
      };
    });
    const pad = table.find((r) => r.name === "pad")!;
    const quiet = table.find((r) => r.name === "quiet")!;
    const kick = table.find((r) => r.name === "kick")!;
    expect(pad.visBass).toBeGreaterThan(pad.rawBass * 5);
    expect(quiet.visBass).toBeLessThan(pad.visBass);
    expect(kick.visEnergy).toBeGreaterThan(kick.rawEnergy);
    expect(table.find((r) => r.name === "silence")!.visEnergy).toBe(0);
    expect(table, `before/after ${JSON.stringify(table)}`).toHaveLength(5);
  });
});
