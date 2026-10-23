import type { MixPcm } from "../../../core/visualz/feature-extractor";

/** Short-window RMS rise on decoded samples. Not a tempo preset. */
const HOP_MS = 10;
const WINDOW_MS = 20;
const ONSET_DELTA = 0.08;
const REFRACTORY_MS = 140;
const MAX_EVENTS = 64;
const MAX_ANALYZE_MS = 180_000;
/** Gaps in this range can be called beats when they are regular. */
const BEAT_GAP_MIN_MS = 250;
const BEAT_GAP_MAX_MS = 1500;
const REGULAR_RATIO = 0.15;
const BEAT_CONFIDENCE = 0.5;

export interface AnalysisWindow {
  sourceInMs: number;
  sourceOutMs: number;
  timelineStartMs: number;
  rate: number;
}

export interface BeatEvent {
  timeMs: number;
  kind: "beat" | "onset";
  /** Share of onset gaps near the median gap. The same value is on every event. */
  confidence: number;
  /** RMS rise that marked this onset, clamped to 0..1. */
  strength: number;
}

export interface BeatAnalysis {
  events: BeatEvent[];
  confidence: number;
  medianGapMs: number | null;
  onsetCount: number;
  truncated: boolean;
  /** How the times were measured. */
  method: "rms-onset";
}

function empty(onsetCount = 0): BeatAnalysis {
  return {
    events: [],
    confidence: 0,
    medianGapMs: null,
    onsetCount,
    truncated: false,
    method: "rms-onset",
  };
}

function monoAt(pcm: MixPcm, index: number): number {
  if (index < 0 || index >= pcm.length) return 0;
  const channels = Math.max(1, pcm.numberOfChannels);
  let sum = 0;
  for (let channel = 0; channel < channels; channel += 1) {
    sum += pcm.getChannelData(channel)[index] ?? 0;
  }
  return sum / channels;
}

function windowRms(pcm: MixPcm, start: number, length: number): number {
  if (length <= 0) return 0;
  let sum = 0;
  for (let index = 0; index < length; index += 1) {
    const sample = monoAt(pcm, start + index);
    sum += sample * sample;
  }
  return Math.sqrt(sum / length);
}

function peakIndex(pcm: MixPcm, start: number, length: number): number {
  let best = 0;
  let bestAbs = -1;
  for (let index = 0; index < length; index += 1) {
    const abs = Math.abs(monoAt(pcm, start + index));
    if (abs > bestAbs) {
      bestAbs = abs;
      best = index;
    }
  }
  return start + best;
}

/**
 * Onsets from the PCM itself. A steady grid is reported only when the
 * measured gaps agree. Missing audio is the caller's error, not an empty tempo.
 */
export function detectBeatsFromPcm(pcm: MixPcm, window: AnalysisWindow): BeatAnalysis {
  const sampleRate = pcm.sampleRate;
  const rate = window.rate;
  if (!(sampleRate > 0) || !(rate > 0) || pcm.length <= 0) return empty();
  const sourceIn = Math.max(0, window.sourceInMs);
  const sourceOut = Math.max(sourceIn, window.sourceOutMs);
  const limitedOut = Math.min(sourceOut, sourceIn + MAX_ANALYZE_MS);
  const truncatedByLength = limitedOut < sourceOut - 1;
  const hop = Math.max(1, Math.round((HOP_MS / 1000) * sampleRate));
  const win = Math.max(hop, Math.round((WINDOW_MS / 1000) * sampleRate));
  const start = Math.min(pcm.length, Math.round((sourceIn / 1000) * sampleRate));
  const end = Math.min(pcm.length, Math.round((limitedOut / 1000) * sampleRate));
  const rises: { sourceMs: number; strength: number }[] = [];
  let previous = 0;
  let lastOnset = Number.NEGATIVE_INFINITY;
  for (let index = start; index + win <= end; index += hop) {
    const rms = windowRms(pcm, index, win);
    const delta = rms - previous;
    const sourceMs = (peakIndex(pcm, index, win) / sampleRate) * 1000;
    if (delta >= ONSET_DELTA && sourceMs - lastOnset >= REFRACTORY_MS) {
      rises.push({ sourceMs, strength: Math.max(0, Math.min(1, delta)) });
      lastOnset = sourceMs;
    }
    previous = previous * 0.5 + rms * 0.5;
  }
  if (rises.length === 0) return empty();

  const times: number[] = [];
  const strengths: number[] = [];
  for (const rise of rises) {
    const local = (rise.sourceMs - sourceIn) / rate;
    const timeline = Math.round(window.timelineStartMs + local);
    if (times.length > 0 && times[times.length - 1] === timeline) continue;
    times.push(timeline);
    strengths.push(rise.strength);
  }
  const truncated = truncatedByLength || times.length > MAX_EVENTS;
  const keptTimes = times.slice(0, MAX_EVENTS);
  const keptStrength = strengths.slice(0, MAX_EVENTS);
  const gaps: number[] = [];
  for (let index = 1; index < keptTimes.length; index += 1) {
    gaps.push(keptTimes[index]! - keptTimes[index - 1]!);
  }
  let medianGapMs: number | null = null;
  let confidence = keptTimes.length === 1 ? 0.25 : 0;
  if (gaps.length > 0) {
    const sorted = [...gaps].sort((a, b) => a - b);
    medianGapMs = sorted[Math.floor(sorted.length / 2)]!;
    const inliers = gaps.filter((gap) => Math.abs(gap - medianGapMs!) <= medianGapMs! * REGULAR_RATIO).length;
    confidence = inliers / gaps.length;
    if (medianGapMs < BEAT_GAP_MIN_MS || medianGapMs > BEAT_GAP_MAX_MS) {
      confidence = Math.min(confidence, 0.45);
    }
  }
  const kind: BeatEvent["kind"] = confidence >= BEAT_CONFIDENCE && keptTimes.length >= 3 ? "beat" : "onset";
  return {
    events: keptTimes.map((timeMs, index) => ({
      timeMs,
      kind,
      confidence,
      strength: keptStrength[index] ?? 0,
    })),
    confidence,
    medianGapMs,
    onsetCount: rises.length,
    truncated,
    method: "rms-onset",
  };
}
