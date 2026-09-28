/**
 * Lightweight Web Audio feature extractor.
 * Live Preview AnalyserNode uses the visualz flux vector (kick/snare/hat/vocal/
 * buildup/drop). Export / mix-PCM stays on assembleAudioFeatures — do not point
 * the live path at that weaker onset detector.
 * Presentation shaping lives in vis-response.ts — this file stays raw.
 */

import type { AudioAnalyserConfig, AudioFeatures } from "./types";
import {
  ANALYSER_FFT_SIZE,
  ANALYSER_MAX_DECIBELS,
  ANALYSER_MIN_DECIBELS,
  ANALYSER_SMOOTHING,
  analyserSpectrumFromWindow,
} from "./fft";

export {
  ANALYSER_FFT_SIZE,
  ANALYSER_MAX_DECIBELS,
  ANALYSER_MIN_DECIBELS,
  ANALYSER_SMOOTHING,
} from "./fft";

export interface FeatureExtractor {
  sample(timeMs?: number): AudioFeatures;
  disconnect(): void;
}

/** Standalone Visualz onset: energy delta + refractory. Not a BPM grid. */
export const ONSET_DELTA = 0.12;
export const ONSET_REFRACTORY_MS = 120;
/** ~0.045 per 60 Hz frame → pulse fades in ~360ms. */
export const BEAT_PULSE_DECAY_MS = 360;

/**
 * Silence gate from standalone Visualz (`src/audio/feature-extractor.ts`).
 * When RMS/bass sit below these floors, kick/onset/`beatPulse` stay 0.
 */
export const SILENCE_RMS = 0.02;
export const SILENCE_BASS = 0.03;

/** Preview-like hop when the caller jumps (seek / first sample / VIS after VIDEO). */
export const ANALYSIS_HOP_MS = 1000 / 60;
/** Enough history for beatPulse decay + refractory + a bit of energy smoothing. */
export const ANALYSIS_WARMUP_MS = 500;

export type MixPcm = Pick<AudioBuffer, "sampleRate" | "length" | "numberOfChannels" | "getChannelData">;

export type FeatureState = {
  prevEnergy: number;
  lastOnsetTime: number;
};

export function createFeatureState(): FeatureState {
  return { prevEnergy: 0, lastOnsetTime: Number.NEGATIVE_INFINITY };
}

export function isSilentEnergy(rms: number, bass: number): boolean {
  return rms < SILENCE_RMS && bass < SILENCE_BASS;
}

/** Zero musical bands when the Visualz silence gate trips. Spectrum is left as-is. */
export function applySilenceGate(features: AudioFeatures): AudioFeatures {
  if (!isSilentEnergy(features.rms, features.bass)) return features;
  return {
    ...features,
    rms: 0,
    bass: 0,
    mid: 0,
    treble: 0,
    onset: false,
    beatPulse: 0,
    kick: 0,
    snare: 0,
    hat: 0,
    vocal: 0,
    buildup: 0,
    drop: 0,
  };
}

export function stepOnset(opts: {
  energy: number;
  prevEnergy: number;
  timeMs: number;
  lastOnsetTime: number;
}): { onset: boolean; beatPulse: number; lastOnsetTime: number; prevEnergy: number } {
  const delta = opts.energy - opts.prevEnergy;
  const onset = delta > ONSET_DELTA && opts.timeMs - opts.lastOnsetTime > ONSET_REFRACTORY_MS;
  const lastOnsetTime = onset ? opts.timeMs : opts.lastOnsetTime;
  const since = Number.isFinite(lastOnsetTime) ? opts.timeMs - lastOnsetTime : BEAT_PULSE_DECAY_MS;
  const beatPulse = onset ? 1 : Math.max(0, 1 - since / BEAT_PULSE_DECAY_MS);
  return {
    onset,
    beatPulse: Number.isFinite(lastOnsetTime) ? beatPulse : 0,
    lastOnsetTime,
    prevEnergy: opts.energy * 0.85 + opts.prevEnergy * 0.15,
  };
}

/**
 * Preview band split: `third = floor(frequencyBinCount / 6)`.
 * At fftSize 2048 / 44.1 kHz that is bass 0–~3.66 kHz, mid ~3.66–11.0 kHz,
 * treble ~11.0–22.05 kHz — not musical octaves. Export must use the same edges.
 */
export function bandsFromSpectrum(spectrum: ArrayLike<number>): { bass: number; mid: number; treble: number } {
  const freqBinCount = spectrum.length;
  const third = Math.floor(freqBinCount / 6);
  const avg = (start: number, end: number) => {
    let s = 0;
    const n = Math.max(1, end - start);
    for (let i = start; i < end; i++) s += spectrum[i] ?? 0;
    return s / n;
  };
  return {
    bass: avg(0, third),
    mid: avg(third, third * 3),
    treble: avg(third * 3, freqBinCount),
  };
}

/** Same RMS as Preview `getByteTimeDomainData` after mapping bytes back to ±1. */
export function rmsFromTimeDomain(samples: ArrayLike<number>): number {
  const n = samples.length;
  if (n <= 0) return 0;
  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    const v = samples[i] ?? 0;
    sumSq += v * v;
  }
  return Math.min(1, Math.sqrt(sumSq / n) * 2);
}

export function assembleAudioFeatures(opts: {
  timeMs: number;
  rms: number;
  bass: number;
  mid: number;
  treble: number;
  spectrum: Float32Array;
  state: FeatureState;
}): AudioFeatures {
  const silent = isSilentEnergy(opts.rms, opts.bass);
  const energy = opts.rms * 0.5 + opts.bass * 0.5;
  const stepped = stepOnset({
    energy,
    prevEnergy: opts.state.prevEnergy,
    timeMs: opts.timeMs,
    lastOnsetTime: opts.state.lastOnsetTime,
  });
  opts.state.prevEnergy = stepped.prevEnergy;
  opts.state.lastOnsetTime = stepped.lastOnsetTime;
  return {
    timeMs: opts.timeMs,
    rms: silent ? 0 : opts.rms,
    bass: silent ? 0 : opts.bass,
    mid: silent ? 0 : opts.mid,
    treble: silent ? 0 : opts.treble,
    spectrum: opts.spectrum,
    onset: silent ? false : stepped.onset,
    beatPulse: silent ? 0 : stepped.beatPulse,
    tempoBpm: null,
  };
}

/**
 * Byte adapter for the export-equivalent band split (n/6) and energy onset.
 * Not the live VIS vector. Live frames use stepLiveAnalyser.
 */
export function featuresFromAnalyserBytes(
  freqData: ArrayLike<number>,
  timeData: ArrayLike<number>,
  timeMs: number,
  state: FeatureState,
): AudioFeatures {
  const spectrum = new Float32Array(freqData.length);
  for (let i = 0; i < freqData.length; i++) spectrum[i] = (freqData[i] ?? 0) / 255;
  const floats = new Float32Array(timeData.length);
  for (let i = 0; i < timeData.length; i++) {
    floats[i] = ((timeData[i] ?? 128) - 128) / 128;
  }
  const rms = rmsFromTimeDomain(floats);
  const { bass, mid, treble } = bandsFromSpectrum(spectrum);
  return assembleAudioFeatures({ timeMs, rms, bass, mid, treble, spectrum, state });
}

/**
 * Live visualz flux state. One vector per frame: kick is an impulse, not bass mass.
 * Thresholds match ailexsi-visualz src/audio/feature-extractor.ts.
 */
export type LiveFeatureState = {
  kick: number;
  snare: number;
  hat: number;
  vocal: number;
  rise: number;
  prevE: number;
  lastKick: number;
  prev: Float32Array;
};

/** Visualz AnalyserNode smoothing. Offline export stays at ANALYSER_SMOOTHING (0.75). */
export const LIVE_ANALYSER_SMOOTHING = 0.55;

export function createLiveFeatureState(binCount: number): LiveFeatureState {
  return {
    kick: 0,
    snare: 0,
    hat: 0,
    vocal: 0,
    rise: 0,
    prevE: 0,
    lastKick: 0,
    prev: new Float32Array(Math.max(0, binCount)),
  };
}

/**
 * Pure live step. `freqData` / `timeData` are AnalyserNode bytes (0–255).
 * Silence (rms < 0.02 && bass < 0.03) zeros kick, snare, hat, vocal, buildup,
 * drop, onset, and beatPulse on the returned packet.
 */
export function stepLiveAnalyser(opts: {
  freqData: ArrayLike<number>;
  timeData: ArrayLike<number>;
  timeMs: number;
  state: LiveFeatureState;
}): AudioFeatures {
  const { freqData, timeData, timeMs, state } = opts;
  const n = freqData.length;
  if (state.prev.length !== n) state.prev = new Float32Array(n);
  const spectrum = new Float32Array(n);
  let ss = 0;
  const timeN = timeData.length;
  for (let i = 0; i < timeN; i++) {
    const v = ((timeData[i] ?? 128) - 128) / 128;
    ss += v * v;
  }
  const rms = Math.min(1, Math.sqrt(ss / Math.max(1, timeN)) * 2.2);
  let fluxB = 0;
  let fluxM = 0;
  let fluxH = 0;
  for (let i = 0; i < n; i++) {
    spectrum[i] = (freqData[i] ?? 0) / 255;
    const d = Math.max(0, spectrum[i] - (state.prev[i] ?? 0));
    if (i < n * 0.06) fluxB += d;
    else if (i < n * 0.28) fluxM += d;
    else fluxH += d;
    state.prev[i] = spectrum[i] ?? 0;
  }
  const avg = (a: number, b: number) => {
    let s = 0;
    const end = Math.min(n, b);
    for (let i = a; i < end; i++) s += spectrum[i] ?? 0;
    return s / Math.max(1, end - a);
  };
  const bass = avg(0, Math.floor(n * 0.06));
  const mid = avg(Math.floor(n * 0.06), Math.floor(n * 0.28));
  const treble = avg(Math.floor(n * 0.28), n);
  const silent = rms < SILENCE_RMS && bass < SILENCE_BASS;
  const kickHit = !silent && fluxB > 0.35 && bass > 0.16 && timeMs - state.lastKick > 100;
  const snareHit = !silent && fluxM > 0.4 && mid > 0.14 && bass < 0.55;
  const hatHit = !silent && (fluxH > 0.25 || treble > 0.22);
  if (kickHit) {
    state.lastKick = timeMs;
    state.kick = 1;
  } else state.kick = Math.max(0, state.kick - 0.08);
  state.snare = snareHit ? 1 : Math.max(0, state.snare - 0.12);
  state.hat = Math.min(1, state.hat * 0.72 + (hatHit ? 0.5 : 0));
  state.vocal = state.vocal * 0.88 + mid * 0.12 * (1 - bass * 0.35);
  const energy = rms * 0.45 + bass * 0.4 + mid * 0.15;
  const de = energy - state.prevE;
  state.rise = Math.max(0, state.rise * 0.92 + de * 4);
  const buildup = state.rise > 0.12 ? Math.min(1, state.rise * 1.2) : 0;
  const drop = state.rise > 0.25 && de > 0.08 && bass > 0.28 ? 1 : 0;
  state.prevE = energy * 0.5 + state.prevE * 0.5;
  return {
    timeMs,
    rms: silent ? 0 : rms,
    bass: silent ? 0 : bass,
    mid: silent ? 0 : mid,
    treble: silent ? 0 : treble,
    spectrum: spectrum.slice(),
    onset: kickHit,
    beatPulse: silent ? 0 : state.kick,
    tempoBpm: null,
    kick: silent ? 0 : state.kick,
    snare: silent ? 0 : state.snare,
    hat: silent ? 0 : state.hat,
    vocal: silent ? 0 : Math.min(1, state.vocal * 1.6),
    buildup: silent ? 0 : buildup,
    drop: silent ? 0 : drop,
  };
}

export function createFeatureExtractor(
  audioContext: AudioContext,
  sourceNode: AudioNode,
  config: AudioAnalyserConfig = {},
): FeatureExtractor {
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = config.fftSize ?? ANALYSER_FFT_SIZE;
  analyser.smoothingTimeConstant = config.smoothingTimeConstant ?? LIVE_ANALYSER_SMOOTHING;
  if (config.minDecibels != null) analyser.minDecibels = config.minDecibels;
  if (config.maxDecibels != null) analyser.maxDecibels = config.maxDecibels;

  sourceNode.connect(analyser);

  const freqBinCount = analyser.frequencyBinCount;
  const freqData = new Uint8Array(freqBinCount);
  const timeData = new Uint8Array(analyser.fftSize);
  const state = createLiveFeatureState(freqBinCount);

  return {
    sample(timeMs = performance.now()) {
      analyser.getByteFrequencyData(freqData);
      analyser.getByteTimeDomainData(timeData);
      return stepLiveAnalyser({ freqData, timeData, timeMs, state });
    },

    disconnect() {
      try {
        sourceNode.disconnect(analyser);
      } catch {
        // already disconnected
      }
    },
  };
}

export type OfflineFeatureExtractor = FeatureExtractor & {
  reset(): void;
  lastTimeMs(): number;
};

function monoSample(buf: MixPcm, index: number): number {
  if (index < 0 || index >= buf.length) return 0;
  const chans = Math.max(1, buf.numberOfChannels);
  let s = 0;
  for (let c = 0; c < chans; c++) s += buf.getChannelData(c)[index] ?? 0;
  return s / chans;
}

/** Causal fftSize window ending at `timeMs` (live AnalyserNode = most recent samples). */
export function pcmWindowAt(buf: MixPcm, timeMs: number, fftSize = ANALYSER_FFT_SIZE): Float32Array {
  const sr = buf.sampleRate > 0 ? buf.sampleRate : 44100;
  const end = Math.round((Math.max(0, timeMs) / 1000) * sr);
  const start = end - fftSize;
  const window = new Float32Array(fftSize);
  for (let i = 0; i < fftSize; i++) window[i] = monoSample(buf, start + i);
  return window;
}

export type OfflineExtractorOptions = {
  hopMs?: number;
  fftSize?: number;
  smoothingTimeConstant?: number;
  minDecibels?: number;
  maxDecibels?: number;
};

/**
 * Adapter B — AudioBuffer / mixed OfflineAudioContext PCM.
 * Sequential sample(tN+1) advances smoothed spectrum, prevEnergy, lastOnsetTime
 * from sample(tN). Same-time re-sample is cached (export paints VIS twice).
 * Backward seek resets and warms up. Long forward jumps hop-fill.
 */
export function createOfflineFeatureExtractor(
  buf: MixPcm,
  opts: OfflineExtractorOptions = {},
): OfflineFeatureExtractor {
  const hopMs = opts.hopMs && opts.hopMs > 0 ? opts.hopMs : ANALYSIS_HOP_MS;
  const fftSize = opts.fftSize ?? ANALYSER_FFT_SIZE;
  const smoothing = opts.smoothingTimeConstant ?? ANALYSER_SMOOTHING;
  const minDecibels = opts.minDecibels ?? ANALYSER_MIN_DECIBELS;
  const maxDecibels = opts.maxDecibels ?? ANALYSER_MAX_DECIBELS;

  let state = createFeatureState();
  let smoothedDb: Float32Array | null = null;
  let lastTimeMs = Number.NEGATIVE_INFINITY;
  let lastFeatures: AudioFeatures | null = null;

  const analyzeAt = (timeMs: number): AudioFeatures => {
    const window = pcmWindowAt(buf, timeMs, fftSize);
    const spec = analyserSpectrumFromWindow(window, smoothedDb, {
      smoothing,
      minDecibels,
      maxDecibels,
    });
    smoothedDb = spec.smoothedDb;
    const rms = rmsFromTimeDomain(window);
    const { bass, mid, treble } = bandsFromSpectrum(spec.spectrum);
    lastFeatures = assembleAudioFeatures({
      timeMs,
      rms,
      bass,
      mid,
      treble,
      spectrum: spec.spectrum,
      state,
    });
    lastTimeMs = timeMs;
    return lastFeatures;
  };

  const warmupTo = (timeMs: number) => {
    const from = Math.max(0, timeMs - ANALYSIS_WARMUP_MS);
    if (timeMs - from <= hopMs) {
      analyzeAt(timeMs);
      return;
    }
    for (let t = from; t < timeMs - 1e-6; t += hopMs) analyzeAt(t);
    analyzeAt(timeMs);
  };

  const reset = () => {
    state = createFeatureState();
    smoothedDb = null;
    lastTimeMs = Number.NEGATIVE_INFINITY;
    lastFeatures = null;
  };

  return {
    sample(timeMs = 0) {
      if (lastFeatures && Math.abs(timeMs - lastTimeMs) < 1e-6) return lastFeatures;
      if (!Number.isFinite(lastTimeMs) || timeMs < lastTimeMs - 1e-6) {
        reset();
        warmupTo(timeMs);
        return lastFeatures!;
      }
      const dt = timeMs - lastTimeMs;
      if (dt > hopMs * 1.5) {
        for (let t = lastTimeMs + hopMs; t < timeMs - 1e-6; t += hopMs) analyzeAt(t);
      }
      return analyzeAt(timeMs);
    },
    reset,
    lastTimeMs: () => lastTimeMs,
    disconnect() {
      reset();
    },
  };
}

const extractorCache = new WeakMap<object, OfflineFeatureExtractor>();

/** One extractor per PCM object so sequential preview/export calls keep state. */
export function offlineExtractorFor(buf: MixPcm, opts?: OfflineExtractorOptions): OfflineFeatureExtractor {
  const key = buf as object;
  const existing = extractorCache.get(key);
  if (existing) return existing;
  const created = createOfflineFeatureExtractor(buf, opts);
  extractorCache.set(key, created);
  return created;
}
