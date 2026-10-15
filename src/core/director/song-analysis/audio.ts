/**
 * Deterministic local audio analysis from decoded PCM.
 *
 * Reuses createOfflineFeatureExtractor / assembleAudioFeatures (onset step,
 * silence gate, bass/mid/treble split). This is the detector. There is no
 * second onset detector.
 *
 * The live flux vector (kick / snare / hat / vocal / buildup / drop) is
 * stepLiveAnalyser on unmerged draft PR #22. It is not on this HEAD and is
 * not copied here: wiring it into the extractor would change VIS, and running
 * it beside the offline walk would be a second detector. Kick observations
 * are offline onsets whose same-frame bass band dominates. Build / drop / break
 * segments are runs of that same energy curve.
 */
import {
  createOfflineFeatureExtractor,
  type MixPcm,
} from "../../visualz/feature-extractor";
import { createObservation, type IdFactory } from "./seal";
import type {
  ObservationStatement,
  SegmentLabel,
  SegmentObservation,
  SongAnalysisReport,
} from "./types";

export const SONG_ANALYSIS_HOP_MS = 20;
export const ENERGY_BUCKET_MS = 100;
/** Quiet holes shorter than this stay inside the surrounding active run. */
const MIN_BREAK_MS = 300;
const MIN_TEMPO_INTERVAL_MS = 250;
const MAX_TEMPO_INTERVAL_MS = 1500;
const MIN_TEMPO_INTERVALS = 4;
const TEMPO_AGREEMENT = 0.12;
const MIN_TEMPO_CONFIDENCE = 0.75;

export interface AnalysisFrame {
  timeMs: number;
  rms: number;
  bass: number;
  mid: number;
  treble: number;
  energy: number;
  onset: boolean;
}

interface EnergyBucket {
  startMs: number;
  endMs: number;
  energy: number;
  onsetCount: number;
}

export interface PcmAnalysis {
  statements: ObservationStatement[];
  segments: SegmentObservation[];
  tempo: SongAnalysisReport["tempo"];
  audio: SongAnalysisReport["audio"];
}

export function pcmIsUsable(pcm: MixPcm | null | undefined): pcm is MixPcm {
  return Boolean(pcm && pcm.length >= 8 && pcm.sampleRate > 0 && pcm.numberOfChannels > 0);
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

function ms(n: number): number {
  return Math.round(n);
}

function average(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

/** Same energy mix as assembleAudioFeatures: rms and bass, equal weight. */
function frameEnergy(rms: number, bass: number): number {
  return rms * 0.5 + bass * 0.5;
}

export function walkOfflineFrames(pcm: MixPcm): { frames: AnalysisFrame[]; durationMs: number } {
  const durationMs = ms((pcm.length / pcm.sampleRate) * 1000);
  const extractor = createOfflineFeatureExtractor(pcm, { hopMs: SONG_ANALYSIS_HOP_MS });
  const frames: AnalysisFrame[] = [];
  for (let timeMs = 0; timeMs <= durationMs; timeMs += SONG_ANALYSIS_HOP_MS) {
    const features = extractor.sample(timeMs);
    frames.push({
      timeMs,
      rms: round6(features.rms),
      bass: round6(features.bass),
      mid: round6(features.mid),
      treble: round6(features.treble),
      energy: round6(frameEnergy(features.rms, features.bass)),
      onset: features.onset,
    });
  }
  const last = frames[frames.length - 1];
  if (!last || last.timeMs !== durationMs) {
    const features = extractor.sample(durationMs);
    frames.push({
      timeMs: durationMs,
      rms: round6(features.rms),
      bass: round6(features.bass),
      mid: round6(features.mid),
      treble: round6(features.treble),
      energy: round6(frameEnergy(features.rms, features.bass)),
      onset: features.onset,
    });
  }
  return { frames, durationMs };
}

function bucketize(frames: readonly AnalysisFrame[], durationMs: number): EnergyBucket[] {
  if (durationMs <= 0) return [];
  const count = Math.ceil(durationMs / ENERGY_BUCKET_MS);
  const buckets: EnergyBucket[] = [];
  for (let index = 0; index < count; index += 1) {
    const startMs = index * ENERGY_BUCKET_MS;
    const endMs = Math.min(durationMs, startMs + ENERGY_BUCKET_MS);
    const last = index === count - 1;
    const inside = frames.filter((frame) => frame.timeMs >= startMs && (last ? frame.timeMs <= endMs : frame.timeMs < endMs));
    buckets.push({
      startMs,
      endMs,
      energy: round6(average(inside.map((frame) => frame.energy))),
      onsetCount: inside.reduce((sum, frame) => sum + (frame.onset ? 1 : 0), 0),
    });
  }
  return buckets;
}

function closeShortHoles(active: readonly boolean[]): boolean[] {
  const closed = active.slice();
  let index = 0;
  while (index < closed.length) {
    if (closed[index]) {
      index += 1;
      continue;
    }
    let end = index;
    while (end < closed.length && !closed[end]) end += 1;
    const bounded = index > 0 && end < closed.length;
    if (bounded && (end - index) * ENERGY_BUCKET_MS < MIN_BREAK_MS) {
      for (let cursor = index; cursor < end; cursor += 1) closed[cursor] = true;
    }
    index = end;
  }
  return closed;
}

function activityOf(buckets: readonly EnergyBucket[]): boolean[] {
  const peak = Math.max(0, ...buckets.map((bucket) => bucket.energy));
  const threshold = Math.max(0.02, peak * 0.3);
  const raw = buckets.map((bucket) => bucket.onsetCount > 0 || bucket.energy >= threshold);
  return closeShortHoles(raw);
}

interface LabeledRun {
  label: SegmentLabel;
  start: number;
  end: number;
}

function labelBuckets(buckets: readonly EnergyBucket[], active: readonly boolean[]): LabeledRun[] {
  if (buckets.length === 0) return [];
  if (!active.some(Boolean)) {
    return [{ label: "break", start: 0, end: buckets.length }];
  }
  const runs: LabeledRun[] = [];
  let index = 0;
  while (index < buckets.length) {
    const flag = active[index];
    let end = index + 1;
    while (end < buckets.length && active[end] === flag) end += 1;
    if (!flag) {
      const seenActive = active.slice(0, index).some(Boolean);
      runs.push({ label: seenActive ? "break" : "intro", start: index, end });
    } else {
      runs.push(...splitActiveRun(buckets, index, end));
    }
    index = end;
  }
  return mergeLabels(runs);
}

function splitActiveRun(buckets: readonly EnergyBucket[], start: number, end: number): LabeledRun[] {
  let peakIndex = start;
  for (let index = start + 1; index < end; index += 1) {
    if (buckets[index]!.energy >= buckets[peakIndex]!.energy) peakIndex = index;
  }
  const peak = buckets[peakIndex]!.energy;
  const labels: SegmentLabel[] = [];
  for (let index = start; index < end; index += 1) {
    const energy = buckets[index]!.energy;
    if (index < peakIndex && peak > 0 && energy < peak * 0.85) labels.push("build");
    else labels.push("drop");
  }
  const runs: LabeledRun[] = [];
  let cursor = 0;
  while (cursor < labels.length) {
    let next = cursor + 1;
    while (next < labels.length && labels[next] === labels[cursor]) next += 1;
    runs.push({ label: labels[cursor]!, start: start + cursor, end: start + next });
    cursor = next;
  }
  return runs;
}

function mergeLabels(runs: readonly LabeledRun[]): LabeledRun[] {
  const merged: LabeledRun[] = [];
  for (const run of runs) {
    const prev = merged[merged.length - 1];
    if (prev && prev.label === run.label && prev.end === run.start) prev.end = run.end;
    else merged.push({ ...run });
  }
  return merged;
}

function meanEnergy(buckets: readonly EnergyBucket[], start: number, end: number): number {
  return round6(average(buckets.slice(start, end).map((bucket) => bucket.energy)));
}

function quietConfidence(mean: number, peak: number): number | null {
  const scale = Math.max(peak, 0.02);
  const score = 1 - mean / scale;
  if (!Number.isFinite(score) || score < 0.5) return null;
  return round6(Math.min(1, score));
}

/**
 * Inter-onset intervals. Tempo stays null unless at least four intervals
 * agree with the median. A 120 BPM grid is never assumed.
 */
export function estimateTempo(onsetTimesMs: readonly number[]): { bpm: number | null; confidence: number | null } {
  const intervals: number[] = [];
  for (let index = 1; index < onsetTimesMs.length; index += 1) {
    const dt = onsetTimesMs[index]! - onsetTimesMs[index - 1]!;
    if (dt >= MIN_TEMPO_INTERVAL_MS && dt <= MAX_TEMPO_INTERVAL_MS) intervals.push(dt);
  }
  if (intervals.length < MIN_TEMPO_INTERVALS) return { bpm: null, confidence: null };
  const sorted = [...intervals].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  if (!(median > 0)) return { bpm: null, confidence: null };
  const close = intervals.filter((dt) => Math.abs(dt - median) / median <= TEMPO_AGREEMENT).length;
  const confidence = close / intervals.length;
  if (confidence < MIN_TEMPO_CONFIDENCE) return { bpm: null, confidence: null };
  return { bpm: Math.round((60_000 / median) * 10) / 10, confidence: round6(confidence) };
}

export function analyzePcm(pcm: MixPcm, timelineOriginMs: number, ids: IdFactory): PcmAnalysis {
  const { frames, durationMs } = walkOfflineFrames(pcm);
  const buckets = bucketize(frames, durationMs);
  const active = activityOf(buckets);
  const peak = round6(Math.max(0, ...buckets.map((bucket) => bucket.energy)));
  const at = (localMs: number) => ms(localMs + timelineOriginMs);
  const statements: ObservationStatement[] = [];
  const energyIdsByBucket: string[] = [];

  for (const bucket of buckets) {
    const observation = createObservation({
      id: ids("obs"),
      signalSource: "pcm.offline_extractor",
      kind: "energy",
      timeMs: at(bucket.startMs),
      range: { startMs: at(bucket.startMs), endMs: at(bucket.endMs) },
      value: bucket.energy,
      unit: "energy",
      confidence: null,
      text: `energy ${bucket.energy} at ${at(bucket.startMs)} ms`,
    });
    energyIdsByBucket.push(observation.id);
    statements.push(observation);
  }

  const onsetIds: string[] = [];
  const onsetTimes: number[] = [];
  for (const frame of frames) {
    if (!frame.onset) continue;
    const onset = createObservation({
      id: ids("obs"),
      signalSource: "pcm.offline_extractor",
      kind: "onset",
      timeMs: at(frame.timeMs),
      range: null,
      value: frame.energy,
      unit: "energy",
      confidence: null,
      text: `onset at ${at(frame.timeMs)} ms, energy ${frame.energy}`,
    });
    statements.push(onset);
    onsetIds.push(onset.id);
    onsetTimes.push(frame.timeMs);
    const dominance = frame.bass > 0 ? (frame.bass - Math.max(frame.mid, frame.treble)) / frame.bass : 0;
    if (frame.bass >= frame.mid && frame.bass >= frame.treble && dominance > 0) {
      statements.push(
        createObservation({
          id: ids("obs"),
          signalSource: "pcm.offline_extractor",
          kind: "kick",
          timeMs: at(frame.timeMs),
          range: null,
          value: frame.bass,
          unit: "bass",
          confidence: round6(Math.min(1, dominance)),
          evidenceRefs: [onset.id],
          text: `kick at ${at(frame.timeMs)} ms from the same offline onset; bass ${frame.bass}, mid ${frame.mid}, treble ${frame.treble}`,
        }),
      );
    }
  }

  const tempo = estimateTempo(onsetTimes);
  if (tempo.bpm != null && tempo.confidence != null) {
    statements.push(
      createObservation({
        id: ids("obs"),
        signalSource: "pcm.offline_extractor",
        kind: "tempo",
        timeMs: at(onsetTimes[0] ?? 0),
        range: { startMs: at(0), endMs: at(durationMs) },
        value: tempo.bpm,
        unit: "bpm",
        confidence: tempo.confidence,
        evidenceRefs: onsetIds,
        text: `tempo ${tempo.bpm} bpm from ${onsetIds.length} onset events`,
      }),
    );
  }

  const segments: SegmentObservation[] = [];
  const segmentIds: string[] = [];
  for (const run of labelBuckets(buckets, active)) {
    const startMs = at(buckets[run.start]!.startMs);
    const endMs = at(buckets[run.end - 1]!.endMs);
    const mean = meanEnergy(buckets, run.start, run.end);
    const evidenceRefs = energyIdsByBucket.slice(run.start, run.end);
    let confidence: number | null = null;
    if (run.label === "intro" || run.label === "break") confidence = quietConfidence(mean, peak);
    else if (run.label === "drop") confidence = peak > 0 ? round6(Math.min(1, mean / peak)) : null;
    else if (run.label === "build") {
      const first = buckets[run.start]!.energy;
      const last = buckets[run.end - 1]!.energy;
      const slope = last - first;
      confidence = peak > 0 && slope > 0 ? round6(Math.min(1, slope / peak)) : null;
    }
    const observation = createObservation({
      id: ids("obs"),
      signalSource: "pcm.offline_extractor",
      kind: "segment",
      timeMs: startMs,
      range: { startMs, endMs },
      value: run.label,
      unit: null,
      confidence,
      evidenceRefs,
      text: `segment ${run.label} ${startMs}–${endMs} ms, mean energy ${mean}`,
    });
    statements.push(observation);
    segmentIds.push(observation.id);
    segments.push({
      id: observation.id,
      label: run.label,
      startMs,
      endMs,
      confidence,
    });
    if (run.label === "break" && run.start > 0) {
      statements.push(
        createObservation({
          id: ids("obs"),
          signalSource: "pcm.offline_extractor",
          kind: "energy_dip",
          timeMs: startMs,
          range: { startMs, endMs },
          value: mean,
          unit: "energy",
          confidence,
          evidenceRefs: [observation.id],
          text: `energy dip at ${startMs} ms, mean energy ${mean}`,
        }),
      );
    }
  }

  for (let index = 1; index < segments.length; index += 1) {
    const prev = segments[index - 1]!;
    const next = segments[index]!;
    statements.push(
      createObservation({
        id: ids("obs"),
        signalSource: "pcm.offline_extractor",
        kind: "segment_boundary",
        timeMs: next.startMs,
        range: null,
        value: `${prev.label}->${next.label}`,
        unit: null,
        confidence: null,
        evidenceRefs: [segmentIds[index - 1]!, segmentIds[index]!],
        text: `segment boundary at ${next.startMs} ms, ${prev.label} to ${next.label}`,
      }),
    );
  }

  return {
    statements,
    segments,
    tempo: {
      bpm: tempo.bpm,
      confidence: tempo.confidence,
      onsetCount: onsetIds.length,
    },
    audio: {
      status: "OK",
      reason: null,
      sampleRate: pcm.sampleRate,
      channels: pcm.numberOfChannels,
      durationMs,
      hopMs: SONG_ANALYSIS_HOP_MS,
      extractor: "createOfflineFeatureExtractor",
    },
  };
}
