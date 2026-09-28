import { describe, expect, it } from "vitest";
import {
  createExportFeatureSession,
  visFeaturesForExport,
  visFeaturesForPreview,
  type MixPcm,
} from "../../src/core/visualizer";
import {
  ANALYSER_FFT_SIZE,
  ANALYSER_MAX_DECIBELS,
  ANALYSER_MIN_DECIBELS,
  ANALYSER_SMOOTHING,
  BEAT_PULSE_DECAY_MS,
  ONSET_DELTA,
  ONSET_REFRACTORY_MS,
  SILENCE_BASS,
  SILENCE_RMS,
  bandsFromSpectrum,
  createOfflineFeatureExtractor,
  isSilentEnergy,
  rmsFromTimeDomain,
} from "../../src/core/visualz/feature-extractor";
import { analyserSpectrumFromWindow, binFrequencyHz } from "../../src/core/visualz/fft";
import { applyVisResponse } from "../../src/core/visualz/vis-response";
import { jobFromProject } from "../../src/core/exporter/job";
import { createEmptyProject } from "../../src/core/project";
import { asset, clip, projectWith } from "../helpers";

const SR = 44100;

function pcm(data: Float32Array, sampleRate = SR): MixPcm {
  return {
    sampleRate,
    length: data.length,
    numberOfChannels: 1,
    getChannelData: () => data,
  } as MixPcm;
}

function silence(durationMs: number, sampleRate = SR): Float32Array {
  return new Float32Array(Math.round((sampleRate * durationMs) / 1000));
}

function sineAt(freqHz: number, durationMs: number, amp = 0.45, sampleRate = SR): Float32Array {
  const n = Math.round((sampleRate * durationMs) / 1000);
  const data = new Float32Array(n);
  for (let i = 0; i < n; i++) data[i] = amp * Math.sin((2 * Math.PI * freqHz * i) / sampleRate);
  return data;
}

function kickAt(data: Float32Array, timeMs: number, sampleRate = SR): void {
  const start = Math.round((timeMs / 1000) * sampleRate);
  const clickN = Math.round(sampleRate * 0.012);
  for (let i = 0; i < clickN && start + i < data.length; i++) {
    const env = 1 - i / clickN;
    const t = i / sampleRate;
    data[start + i] =
      env * (0.95 * Math.sin(2 * Math.PI * 70 * t) + 0.3 * Math.sin(2 * Math.PI * 160 * t));
  }
}

function snareAt(data: Float32Array, timeMs: number, sampleRate = SR): void {
  const start = Math.round((timeMs / 1000) * sampleRate);
  const clickN = Math.round(sampleRate * 0.008);
  let seed = 1;
  for (let i = 0; i < clickN && start + i < data.length; i++) {
    seed = (seed * 16807) % 2147483647;
    const noise = (seed / 2147483647) * 2 - 1;
    const env = 1 - i / clickN;
    const t = i / sampleRate;
    data[start + i] = env * (0.55 * noise + 0.35 * Math.sin(2 * Math.PI * 220 * t));
  }
}

function scaleAmp(data: Float32Array, gain: number): Float32Array {
  const out = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = (data[i] ?? 0) * gain;
  return out;
}

function firstOnset(buf: MixPcm, untilMs: number, hop = 10): number | null {
  const ex = createOfflineFeatureExtractor(buf);
  for (let t = 0; t <= untilMs; t += hop) {
    if (ex.sample(t).onset) return t;
  }
  return null;
}

type Snapshot = {
  timeMs: number;
  rms: number;
  bass: number;
  mid: number;
  treble: number;
  energy: number;
  onset: boolean;
  beatPulse: number;
  spectrumBins: number;
  spec0: number;
  specBass: number;
  specMid: number;
  specTreble: number;
};

function snapOf(timeMs: number, f: {
  rms: number;
  bass: number;
  mid: number;
  treble: number;
  energy?: number;
  onset: boolean;
  beatPulse: number;
  spectrum: ArrayLike<number>;
}): Snapshot {
  const n = f.spectrum.length;
  const energy = f.energy ?? f.rms * 0.5 + f.bass * 0.5;
  return {
    timeMs,
    rms: f.rms,
    bass: f.bass,
    mid: f.mid,
    treble: f.treble,
    energy,
    onset: f.onset,
    beatPulse: f.beatPulse,
    spectrumBins: n,
    spec0: f.spectrum[0] ?? 0,
    specBass: f.spectrum[Math.min(8, n - 1)] ?? 0,
    specMid: f.spectrum[Math.floor(n / 2)] ?? 0,
    specTreble: f.spectrum[Math.max(0, n - 8)] ?? 0,
  };
}

/**
 * LEGACY export path (VIS-SYNC-01 pre-fix). Kept only so Phase 1 can prove the
 * first semantic divergence with numbers. Production no longer calls this.
 */
function legacyMixEnergyAt(buf: MixPcm, timeMs: number) {
  const sr = buf.sampleRate > 0 ? buf.sampleRate : 44100;
  const chans = Math.max(1, buf.numberOfChannels);
  const win = Math.min(buf.length, Math.max(64, Math.round(sr * 0.023)));
  const center = Math.round((Math.max(0, timeMs) / 1000) * sr);
  const start = Math.max(0, Math.min(Math.max(0, buf.length - win), center - Math.floor(win / 2)));
  const channels = Array.from({ length: chans }, (_, i) => buf.getChannelData(i));
  let sumSq = 0;
  let lowSq = 0;
  let highSq = 0;
  let prev = 0;
  let lp = 0;
  for (let i = 0; i < win; i++) {
    let s = 0;
    for (const ch of channels) s += ch[start + i] ?? 0;
    s /= chans;
    sumSq += s * s;
    lp = lp * 0.9 + s * 0.1;
    lowSq += lp * lp;
    const d = s - prev;
    highSq += d * d;
    prev = s;
  }
  const n = Math.max(1, win);
  const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
  const rms = clamp01(Math.sqrt(sumSq / n) * 2);
  const bass = clamp01(Math.sqrt(lowSq / n) * 2.4);
  const treble = clamp01(Math.sqrt(highSq / n) * 2);
  const mid = clamp01(rms * 0.55 + treble * 0.45);
  const energy = clamp01(rms * 0.5 + bass * 0.5);
  return { rms, bass, mid, treble, energy };
}

function legacySyntheticSpectrum(bass: number, mid: number, high: number, timeMs: number, energy: number) {
  const bins = 64;
  const spec = new Float32Array(bins);
  for (let i = 0; i < bins; i++) {
    const t = i / (bins - 1);
    const band = t < 1 / 3 ? bass : t < 2 / 3 ? mid : high;
    const wobble = 0.12 * Math.abs(Math.sin(timeMs / 130 + i * 0.45));
    spec[i] = Math.min(1, Math.max(0, band * 0.88 + wobble * energy));
  }
  return spec;
}

function legacyFeaturesFromMix(buf: MixPcm, timeMs: number) {
  const cur = legacyMixEnergyAt(buf, timeMs);
  const spec = legacySyntheticSpectrum(cur.bass, cur.mid, cur.treble, timeMs, cur.energy);
  return snapOf(timeMs, { ...cur, onset: false, beatPulse: cur.energy, spectrum: spec });
}

function knownSong(): { buf: MixPcm; marks: Record<string, number> } {
  const durationMs = 2000;
  const data = silence(durationMs);
  const marks = { quiet: 80, kick: 400, snare: 720, sustained: 1200 };
  kickAt(data, marks.kick);
  snareAt(data, marks.snare);
  const sus0 = Math.round((1000 / 1000) * SR);
  const susN = Math.round((0.5 * SR));
  for (let i = 0; i < susN && sus0 + i < data.length; i++) {
    data[sus0 + i] = 0.35 * Math.sin((2 * Math.PI * 220 * i) / SR);
  }
  return { buf: pcm(data), marks };
}

describe("VIS-SYNC-01 phase 1 — proven preview vs legacy-export divergence", () => {
  const { buf, marks } = knownSong();
  /** Causal analyser window ends at t — sample a few ms after the transient. */
  const hear = {
    quiet: marks.quiet,
    kick: marks.kick + 20,
    snare: marks.snare + 16,
    sustained: marks.sustained,
  };

  it("documents analyser constants that export must match", () => {
    expect(ANALYSER_FFT_SIZE).toBe(2048);
    expect(ANALYSER_SMOOTHING).toBe(0.75);
    expect(ANALYSER_MIN_DECIBELS).toBe(-100);
    expect(ANALYSER_MAX_DECIBELS).toBe(-30);
    expect(ONSET_DELTA).toBe(0.12);
    expect(ONSET_REFRACTORY_MS).toBe(120);
    expect(BEAT_PULSE_DECAY_MS).toBe(360);
    expect(SILENCE_RMS).toBe(0.02);
    expect(SILENCE_BASS).toBe(0.03);
    const third = Math.floor(1024 / 6);
    expect(third).toBe(170);
    expect(binFrequencyHz(third, SR)).toBeCloseTo(170 * SR / ANALYSER_FFT_SIZE, 5);
    expect(binFrequencyHz(third * 3, SR)).toBeCloseTo(510 * SR / ANALYSER_FFT_SIZE, 5);
  });

  it("FIRST semantic divergence: legacy export has no real FFT (64 synthetic bins vs 1024)", () => {
    const preview = createOfflineFeatureExtractor(buf);
    const rows: { name: string; preview: Snapshot; legacy: Snapshot }[] = [];
    for (const [name, t] of Object.entries(hear)) {
      rows.push({
        name,
        preview: snapOf(t, preview.sample(t)),
        legacy: legacyFeaturesFromMix(buf, t),
      });
    }

    for (const row of rows) {
      expect(row.preview.spectrumBins, `${row.name} preview bins`).toBe(1024);
      expect(row.legacy.spectrumBins, `${row.name} legacy bins`).toBe(64);
    }

    const kick = rows.find((r) => r.name === "kick")!;
    const quiet = rows.find((r) => r.name === "quiet")!;
    const snare = rows.find((r) => r.name === "snare")!;
    const sustained = rows.find((r) => r.name === "sustained")!;

    // Spectrum content: real FFT has a low-bin structure; synthetic is a 3-band
    // ramp + time wobble and cannot represent a kick vs a 220 Hz pad.
    const previewKickShape = kick.preview.specBass - kick.preview.specTreble;
    const legacyKickShape = kick.legacy.specBass - kick.legacy.specTreble;
    expect(kick.preview.specBass).toBeGreaterThan(kick.preview.specTreble);
    expect(Math.abs(previewKickShape - legacyKickShape)).toBeGreaterThan(0.05);

    const deltas = rows.map((r) => ({
      name: r.name,
      dRms: r.preview.rms - r.legacy.rms,
      dBass: r.preview.bass - r.legacy.bass,
      dMid: r.preview.mid - r.legacy.mid,
      dTreble: r.preview.treble - r.legacy.treble,
      dEnergy: r.preview.energy - r.legacy.energy,
      dBins: r.preview.spectrumBins - r.legacy.spectrumBins,
    }));

    // Proven first divergence that explains "unsynced" export: spectrum is
    // fabricated (64 bins, time-wobble) and bands are LPF/diff, not FFT.
    expect(deltas.every((d) => d.dBins === 1024 - 64)).toBe(true);
    expect(Math.abs(deltas.find((d) => d.name === "snare")!.dTreble)).toBeGreaterThan(0.02);
    expect(Math.abs(deltas.find((d) => d.name === "kick")!.dBass) + Math.abs(deltas.find((d) => d.name === "kick")!.dMid)).toBeGreaterThan(0.02);

    expect(quiet.preview.rms).toBeLessThan(0.05);
    expect(kick.preview.rms).toBeGreaterThan(quiet.preview.rms);
    expect(sustained.preview.rms).toBeGreaterThan(0.1);
    expect(snare.preview.spectrumBins).toBe(1024);

    // Expose the table to the test name / assertion message for the PR.
    expect(deltas, `phase1 deltas ${JSON.stringify(deltas)}`).toHaveLength(4);
  });
});

describe("VIS-SYNC-01 shared engine", () => {
  it("1 impulse/kick: preview-equivalent and offline onset share the timestamp", () => {
    const data = silence(800);
    kickAt(data, 240);
    const buf = pcm(data);
    const preview = firstOnset(buf, 600);
    const exported = firstOnset(pcm(data), 600);
    expect(preview).not.toBeNull();
    expect(exported).toBe(preview);
    expect(preview!).toBeGreaterThanOrEqual(240);
    expect(preview!).toBeLessThan(240 + 80);
  });

  it("2 sine/bass: 80 Hz is a bass-dominant FFT band", () => {
    const buf = pcm(sineAt(80, 600, 0.4));
    const f = createOfflineFeatureExtractor(buf).sample(250);
    expect(f.bass).toBeGreaterThan(f.treble);
    expect(f.bass).toBeGreaterThan(f.mid);
    expect(f.rms).toBeGreaterThan(0.15);
    const preview = visFeaturesForPreview({
      timeMs: 250,
      durationMs: 600,
      mix: buf,
      audioLoaded: true,
      hasClipAtPlayhead: true,
    });
    const exported = visFeaturesForExport(250, 600, buf);
    expect(preview.rms).toBe(0);
    expect(preview.beatPulse).toBe(0);
    expect(preview.tempoBpm).toBeNull();
    expect(exported.bass).toBeGreaterThan(exported.treble);
  });

  it("3 HF tone: 12 kHz is a treble-dominant FFT band", () => {
    const buf = pcm(sineAt(12_000, 600, 0.4));
    const f = createOfflineFeatureExtractor(buf).sample(250);
    expect(f.treble).toBeGreaterThan(f.bass);
    expect(f.treble).toBeGreaterThan(f.mid);
    const exported = visFeaturesForExport(250, 600, buf);
    expect(exported.treble).toBeGreaterThan(exported.bass);
    expect(exported.spectrum.length).toBe(1024);
  });

  it("4 silence: both paths are gated", () => {
    const buf = pcm(silence(500));
    const preview = visFeaturesForPreview({
      timeMs: 200,
      durationMs: 500,
      mix: buf,
      audioLoaded: true,
      hasClipAtPlayhead: true,
    });
    const exported = visFeaturesForExport(200, 500, buf);
    expect(isSilentEnergy(preview.rms, preview.bass) || preview.rms === 0).toBe(true);
    expect(preview.energy).toBeCloseTo(0, 5);
    expect(preview.onset).toBe(false);
    expect(preview.beatPulse).toBeCloseTo(0, 5);
    expect(exported.energy).toBeCloseTo(0, 5);
    expect(exported.onset).toBe(false);
    expect(exported.beatPulse).toBeCloseTo(0, 5);
  });

  it("5 volume 1.0 vs 0.5: export response decreases (no normalization)", () => {
    const tone = sineAt(110, 600, 0.4);
    const full = visFeaturesForExport(250, 600, pcm(tone));
    const half = visFeaturesForExport(250, 600, pcm(scaleAmp(tone, 0.5)));
    expect(half.rms).toBeLessThan(full.rms * 0.85);
    expect(half.energy).toBeLessThan(full.energy);
    expect(full.rms).toBeGreaterThan(0.1);
  });

  it("6 automation: features follow the mixed level", () => {
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
  });

  it("7 non-zero export IN: feature time, mix time, and remapped VIS share the export-range clock", () => {
    const data = silence(1000);
    kickAt(data, 120);
    const mix = pcm(data);
    const p = projectWith(
      [clip({ id: "a1", assetId: "song", trackId: "A1", startMs: 0, durationMs: 8000 })],
      [asset({ id: "song", kind: "audio", durationMs: 8000 })],
    );
    p.inPointMs = 2500;
    p.outPointMs = 3500;
    p.visualizer = {
      ...p.visualizer,
      enabled: true,
      muted: false,
      startMs: 0,
      durationMs: 0,
      events: [{ id: "ve1", sceneId: "spectrum-bars", startMs: 2620, durationMs: 400 }],
    };
    const job = jobFromProject(p);
    expect(job.startMs).toBe(2500);
    expect(job.durationMs).toBe(1000);
    expect(job.visualizer.events?.[0]?.startMs).toBe(120);
    const session = createExportFeatureSession(mix, {
      hopMs: 1000 / 30,
      durationMs: job.durationMs,
      timelineOriginMs: job.startMs,
    });
    const atKick = session.sample(140);
    const atZero = visFeaturesForExport(0, job.durationMs, mix, { timelineOriginMs: job.startMs });
    expect(atKick.timeMs).toBe(140);
    expect(atKick.rms).toBeGreaterThan(atZero.rms);
    expect(atKick.onset || atKick.energy > atZero.energy).toBe(true);
    const originIgnoredWhenMix = visFeaturesForExport(140, job.durationMs, mix, {
      timelineOriginMs: job.startMs,
    });
    expect(originIgnoredWhenMix.timeMs).toBe(140);
    expect(originIgnoredWhenMix.spectrum.length).toBe(1024);
  });

  it("8 sequential 30 fps: onset / beatPulse are deterministic", () => {
    const data = silence(2000);
    kickAt(data, 400);
    kickAt(data, 900);
    const buf = pcm(data);
    const run = () => {
      const session = createExportFeatureSession(buf, { hopMs: 1000 / 30 });
      const rows = [];
      for (let i = 0; i < 60; i++) {
        const t = (i / 30) * 1000;
        const f = session.sample(t);
        rows.push({ t, onset: f.onset, beatPulse: Number(f.beatPulse.toFixed(6)), energy: Number(f.energy.toFixed(6)) });
      }
      return rows;
    };
    const a = run();
    const b = run();
    expect(a).toEqual(b);
    const onsets = a.filter((r) => r.onset).map((r) => r.t);
    expect(onsets.length).toBeGreaterThanOrEqual(2);
    const afterKick = a.find((r) => r.t > 400 && r.t < 520);
    expect(afterKick?.beatPulse).toBeGreaterThan(0);
  });

  it("same-time re-sample does not double-step onset (export paints VIS twice)", () => {
    const data = silence(800);
    kickAt(data, 200);
    const session = createExportFeatureSession(pcm(data), { hopMs: 1000 / 30 });
    const first = session.sample(240);
    const again = session.sample(240);
    expect(again).toEqual(first);
  });

  it("export FFT of an 441 Hz sine peaks near bin 20, not a synthetic 64-bin wobble", () => {
    const buf = pcm(sineAt(441, 400, 0.5));
    const window = new Float32Array(ANALYSER_FFT_SIZE);
    const sr = buf.sampleRate;
    const end = Math.round((0.25 * sr));
    const src = buf.getChannelData(0);
    for (let i = 0; i < ANALYSER_FFT_SIZE; i++) {
      const idx = end - ANALYSER_FFT_SIZE + i;
      window[i] = idx >= 0 ? (src[idx] ?? 0) : 0;
    }
    const { spectrum } = analyserSpectrumFromWindow(window, null);
    let peak = 0;
    let peakK = 0;
    for (let k = 1; k < spectrum.length; k++) {
      if ((spectrum[k] ?? 0) > peak) {
        peak = spectrum[k] ?? 0;
        peakK = k;
      }
    }
    expect(peakK).toBeGreaterThanOrEqual(18);
    expect(peakK).toBeLessThanOrEqual(23);
    expect(spectrum.length).toBe(1024);
    const bands = bandsFromSpectrum(spectrum);
    expect(bands.bass).toBeGreaterThan(bands.treble);
    expect(rmsFromTimeDomain(window)).toBeGreaterThan(0.2);
  });
});

describe("VIS-SYNC-01 host routing", () => {
  it("playing live tap wins over mix PCM when a clip is under the playhead", () => {
    const mix = pcm(sineAt(80, 400, 0.4));
    const live = {
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
    expect(preview.onset).toBe(true);
    expect(preview.bass).toBeCloseTo(presented.bass, 5);
  });

  it("gap at playhead still ignores leftover live energy", () => {
    const leftover = {
      timeMs: 0,
      rms: 0.5,
      bass: 0.4,
      mid: 0.2,
      treble: 0.1,
      spectrum: new Float32Array(8),
      onset: true,
      beatPulse: 1,
      tempoBpm: null,
    };
    const gap = visFeaturesForPreview({
      timeMs: 0,
      durationMs: 10_000,
      mix: null,
      live: leftover,
      audioLoaded: true,
      hasClipAtPlayhead: false,
    });
    expect(gap.energy).toBeCloseTo(0, 5);
    expect(gap.onset).toBe(false);
  });

  it("empty project preview is a zero vector, not the 120 BPM fallback", () => {
    const p = createEmptyProject("Empty");
    expect(p.clips.length).toBe(0);
    const empty = visFeaturesForPreview({
      timeMs: 0,
      durationMs: 10_000,
      audioLoaded: false,
      hasClipAtPlayhead: false,
    });
    expect(empty.tempoBpm).toBeNull();
    expect(empty.beatPulse).toBe(0);
    expect(empty.energy).toBe(0);
  });
});
