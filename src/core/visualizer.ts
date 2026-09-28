import { createId } from "./ids";
import {
  FRAME_MS,
  VISUALIZER_SCENE_IDS,
  projectDurationMs,
  type Project,
  type VisualizerCue,
  type VisualizerEvent,
  type VisualizerSceneId,
  type VisualizerState,
} from "./models";
import { contextFromProject, resolvePictureSource } from "./transition";
import { getRegisteredScene } from "./visualz";
import type { AudioFeatures } from "./visualz";
import { sceneShortNameFromCatalog } from "./visualz/scene-catalog";
import {
  createOfflineFeatureExtractor,
  isSilentEnergy,
  offlineExtractorFor,
  type MixPcm as ExtractorMixPcm,
  type OfflineFeatureExtractor,
} from "./visualz/feature-extractor";
import { applyVisResponse } from "./visualz/vis-response";

export const DEFAULT_VIS_EVENT_MS = 4000;

export type VisEventClipboard = {
  sceneId: VisualizerSceneId;
  durationMs: number;
};

export function roundVisMs(ms: number): number {
  if (!Number.isFinite(ms)) return 0;
  return Math.round(ms);
}

export function minVisEventDurationMs(): number {
  return Math.max(1, Math.round(FRAME_MS));
}

export function visEventEndMs(event: VisualizerEvent): number {
  return event.startMs + event.durationMs;
}

export function formatVisEventLabel(event: Pick<VisualizerEvent, "sceneId" | "startMs" | "durationMs">): string {
  const start = roundVisMs(event.startMs);
  const end = roundVisMs(event.startMs + event.durationMs);
  return `${sceneShortName(event.sceneId)} ${start}–${end}ms`;
}

export const BEAT_WINDOW_MS = 90;
export const DEFAULT_VISUALIZER_BPM = 120;

/**
 * Host feature packet. Extends Visualz AudioFeatures.
 * `energy` / `high` stay as aliases so existing V5 tests keep reading the 120 BPM grid.
 */
export interface VisualizerFeatures extends AudioFeatures {
  energy: number;
  high: number;
}

/** 120 BPM grid (or `bpm`) from 0 inclusive to duration exclusive. */
export function beatGrid(durationMs: number, bpm = DEFAULT_VISUALIZER_BPM): number[] {
  if (durationMs <= 0 || bpm <= 0) return [];
  const interval = 60_000 / bpm;
  const beats: number[] = [];
  for (let t = 0; t < durationMs; t += interval) beats.push(t);
  return beats;
}

/** 0..1 pulse: 1 on a beat, 0 when the nearest beat is >= 90ms away. */
export function energyAt(timeMs: number, beatsMs: number[]): number {
  if (beatsMs.length === 0) return 0;
  let nearest = Infinity;
  for (const beat of beatsMs) {
    const dist = Math.abs(timeMs - beat);
    if (dist < nearest) nearest = dist;
  }
  if (nearest >= BEAT_WINDOW_MS) return 0;
  return 1 - nearest / BEAT_WINDOW_MS;
}

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/**
 * SYNTHETIC fallback AudioFeatures from a 120 BPM beat grid (and its 2× hats).
 * This is not an FFT of A1/A2. Used only when no mix PCM exists (empty project).
 * Preview prefers a live AnalyserNode tap; export uses the shared offline FFT.
 */
export function featuresAt(timeMs: number, durationMs: number): VisualizerFeatures {
  const span = Math.max(0, durationMs);
  const beats = beatGrid(span);
  const energy = energyAt(timeMs, beats);
  const eighths = beatGrid(span, DEFAULT_VISUALIZER_BPM * 2);
  const hats = energyAt(timeMs, eighths);
  const bass = energy;
  const mid = clamp01(energy * 0.55 + hats * 0.45);
  const high = clamp01(hats * (0.35 + 0.65 * (1 - energy)));
  const spectrum = syntheticSpectrum(bass, mid, high, timeMs, energy);
  const onset = energy > 0.92;
  return presentVisualizerFeatures({
    timeMs,
    rms: energy,
    bass,
    mid,
    treble: high,
    spectrum,
    onset,
    beatPulse: energy,
    tempoBpm: DEFAULT_VISUALIZER_BPM,
  });
}

/** Fake 64-bin spectrum so Visualz scenes that read `spectrum` still move. */
function syntheticSpectrum(
  bass: number,
  mid: number,
  high: number,
  timeMs: number,
  energy: number,
): Float32Array {
  const bins = 64;
  const spec = new Float32Array(bins);
  for (let i = 0; i < bins; i++) {
    const t = i / (bins - 1);
    const band = t < 1 / 3 ? bass : t < 2 / 3 ? mid : high;
    const wobble = 0.12 * Math.abs(Math.sin(timeMs / 130 + i * 0.45));
    spec[i] = clamp01(band * 0.88 + wobble * energy);
  }
  return spec;
}

export type MixPcm = ExtractorMixPcm;

/**
 * Single Preview/Export presentation hook. Analysis stays in the extractor;
 * scenes only see this packet. Same raw + DEFAULT_VIS_RESPONSE ⇒ same result.
 */
export function presentVisualizerFeatures(raw: AudioFeatures): VisualizerFeatures {
  return applyVisResponse(raw);
}

/**
 * Feature packet from mixed / A1 PCM using the shared Preview analyser core
 * (fftSize 2048, Blackman, dB [-100,-30], smoothing 0.75, same band split
 * and onset step). Never invents a 120 BPM grid — tempoBpm stays null.
 * Sequential calls on the same buffer keep prevEnergy / lastOnset / smoothing.
 */
export function featuresFromMix(buf: MixPcm, timeMs: number): VisualizerFeatures {
  return presentVisualizerFeatures(offlineExtractorFor(buf).sample(timeMs));
}

export function quietVisualizerFeatures(timeMs: number): VisualizerFeatures {
  return {
    timeMs,
    energy: 0,
    rms: 0,
    bass: 0,
    mid: 0,
    high: 0,
    treble: 0,
    spectrum: new Float32Array(64),
    onset: false,
    beatPulse: 0,
    tempoBpm: null,
  };
}

export type ExportFeatureSession = {
  sample(timeMs: number): VisualizerFeatures;
  reset(): void;
  /** Session sample() already ran applyVisResponse — do not shape again. */
  readonly presented: true;
};

/**
 * Sequential export analysis. Frame N+1 advances smoothing / prevEnergy /
 * lastOnset from frame N. Same-time re-sample is cached (VIS is painted twice
 * per canvas encode). `timeMs` is export-range local (same clock as the mixed
 * AudioBuffer and remapped VIS events). `timelineOriginMs` is only for the
 * no-audio 120 BPM fallback.
 */
export function createExportFeatureSession(
  mix: MixPcm | null | undefined,
  opts?: { hopMs?: number; durationMs?: number; timelineOriginMs?: number },
): ExportFeatureSession {
  const extractor: OfflineFeatureExtractor | null =
    mix && mix.length >= 8 ? createOfflineFeatureExtractor(mix, { hopMs: opts?.hopMs }) : null;
  const origin = opts?.timelineOriginMs ?? 0;
  const durationMs = opts?.durationMs ?? 0;
  return {
    presented: true,
    sample(timeMs: number) {
      if (extractor) return presentVisualizerFeatures(extractor.sample(timeMs));
      return featuresAt(origin + timeMs, origin + durationMs);
    },
    reset() {
      extractor?.reset();
    },
  };
}

/** Preview=export: loaded mix PCM is the clock. No-audio only falls back to 120 BPM. */
export function visFeaturesForExport(
  timeMs: number,
  durationMs: number,
  mix?: MixPcm | null,
  opts?: { timelineOriginMs?: number; extractor?: OfflineFeatureExtractor | ExportFeatureSession },
): VisualizerFeatures {
  const origin = opts?.timelineOriginMs ?? 0;
  if (opts?.extractor) {
    if ("presented" in opts.extractor && opts.extractor.presented) {
      return opts.extractor.sample(timeMs);
    }
    return presentVisualizerFeatures(opts.extractor.sample(timeMs));
  }
  if (mix && mix.length >= 8) return featuresFromMix(mix, timeMs);
  return featuresAt(origin + timeMs, origin + durationMs);
}

/**
 * Zero vector for Preview. No tempo, no beatPulse, no mix-PCM substitute.
 * Spectrum length matches the live packet when one exists.
 */
function zeroPreviewFeatures(timeMs: number, spectrumLength: number): VisualizerFeatures {
  return {
    timeMs,
    energy: 0,
    rms: 0,
    bass: 0,
    mid: 0,
    high: 0,
    treble: 0,
    spectrum: new Float32Array(Math.max(0, spectrumLength)),
    onset: false,
    beatPulse: 0,
    tempoBpm: null,
    kick: 0,
    snare: 0,
    hat: 0,
    vocal: 0,
    buildup: 0,
    drop: 0,
  };
}

/**
 * Preview clock is the live analyser packet only.
 * A packet below the silence floor (rms < 0.02 && bass < 0.03) stays zero —
 * beatPulse on that packet is not promoted. No mix-PCM substitute and no
 * 120 BPM `featuresAt` grid. Export still uses `visFeaturesForExport`.
 */
export function visFeaturesForPreview(opts: {
  timeMs: number;
  durationMs: number;
  mix?: MixPcm | null;
  live?: AudioFeatures | null;
  audioLoaded: boolean;
  /** False = timeline gap / no clip under the playhead. */
  hasClipAtPlayhead?: boolean;
}): VisualizerFeatures {
  const live = opts.live ?? null;
  const spectrumLength = live?.spectrum.length ?? 0;
  if (opts.hasClipAtPlayhead === false) {
    return zeroPreviewFeatures(live?.timeMs ?? opts.timeMs, spectrumLength);
  }
  if (!live || isSilentEnergy(live.rms, live.bass)) {
    return zeroPreviewFeatures(live?.timeMs ?? opts.timeMs, spectrumLength);
  }
  return presentVisualizerFeatures(live);
}

export function nextSceneId(current: VisualizerSceneId): VisualizerSceneId {
  const i = VISUALIZER_SCENE_IDS.indexOf(current);
  const idx = i < 0 ? 0 : (i + 1) % VISUALIZER_SCENE_IDS.length;
  return VISUALIZER_SCENE_IDS[idx]!;
}

export function sceneShortName(sceneId: VisualizerSceneId): string {
  return sceneShortNameFromCatalog(sceneId);
}

/** durationMs <= 0 means the overlay covers the whole timeline (legacy). */
export function visWindowCovers(
  vis: { startMs?: number; durationMs?: number },
  timeMs: number,
): boolean {
  const dur = vis.durationMs ?? 0;
  if (dur <= 0) return true;
  const start = vis.startMs ?? 0;
  return timeMs >= start && timeMs < start + dur;
}

export function visualizerEventsOf(vis: VisualizerState | Project): VisualizerEvent[] {
  const state = "visualizer" in vis ? vis.visualizer : vis;
  return state.events ?? [];
}

export function visualizerEventCovers(event: VisualizerEvent, timeMs: number): boolean {
  return timeMs >= event.startMs && timeMs < event.startMs + Math.max(0, event.durationMs);
}

export function visualizerEventAt(
  vis: VisualizerState | Project,
  timeMs: number,
): VisualizerEvent | undefined {
  return visualizerEventsOf(vis).find((event) => visualizerEventCovers(event, timeMs));
}

export function cuesOf(vis: VisualizerState | Project): VisualizerCue[] {
  const state = "visualizer" in vis ? vis.visualizer : vis;
  return [...(state.cues ?? [])].sort((a, b) => a.startMs - b.startMs);
}

function lastCueAt(vis: VisualizerState | Project, timeMs: number): VisualizerCue | undefined {
  let hit: VisualizerCue | undefined;
  for (const cue of cuesOf(vis)) {
    if (cue.startMs <= timeMs) hit = cue;
    else break;
  }
  return hit;
}

function upsertCueList(cues: VisualizerCue[], startMs: number, sceneId: VisualizerSceneId): VisualizerCue[] {
  const t = Math.max(0, roundVisMs(startMs));
  const next = cues.filter((c) => c.startMs !== t);
  next.push({ startMs: t, sceneId });
  next.sort((a, b) => a.startMs - b.startMs);
  return next;
}

function visCueSpanMs(project: Project, cues: VisualizerCue[]): number {
  const lastCue = cues[cues.length - 1];
  const lastEventEnd = Math.max(
    0,
    ...visualizerEventsOf(project).map((e) => e.startMs + Math.max(0, e.durationMs)),
  );
  const windowEnd =
    (project.visualizer.durationMs ?? 0) > 0
      ? (project.visualizer.startMs ?? 0) + (project.visualizer.durationMs ?? 0)
      : 0;
  return Math.max(
    DEFAULT_VIS_EVENT_MS,
    10_000,
    projectDurationMs(project),
    windowEnd,
    lastEventEnd,
    lastCue ? lastCue.startMs + DEFAULT_VIS_EVENT_MS : 0,
  );
}

/** Rematerialize abutting VIS events from cues so export's existing event hook paints. */
export function rematerializeEventsFromCues(project: Project, cues: VisualizerCue[]): VisualizerEvent[] {
  const unique: VisualizerCue[] = [];
  for (const cue of [...cues].sort((a, b) => a.startMs - b.startMs)) {
    const last = unique[unique.length - 1];
    if (last && last.startMs === cue.startMs) unique[unique.length - 1] = cue;
    else unique.push(cue);
  }
  if (unique.length === 0) return visualizerEventsOf(project);
  const span = visCueSpanMs(project, unique);
  const existing = visualizerEventsOf(project);
  return unique.map((cue, i) => {
    const next = unique[i + 1];
    const end = next ? next.startMs : span;
    const durationMs = Math.max(1, roundVisMs(end - cue.startMs));
    const reuse = existing.find((e) => e.startMs === cue.startMs && e.sceneId === cue.sceneId);
    return {
      id: reuse?.id ?? createId("ve"),
      sceneId: cue.sceneId,
      startMs: cue.startMs,
      durationMs,
    };
  });
}

/**
 * Covering event, else last cue with startMs <= t, else sceneId when the window covers.
 * Preview and tests use this; export reads rematerialized events[] via the same compositor.
 */
export function sceneAt(
  vis: VisualizerState | Project,
  timeMs: number,
): VisualizerSceneId | undefined {
  const state = "visualizer" in vis ? vis.visualizer : vis;
  const covering = visualizerEventAt(state, timeMs);
  if (covering) return covering.sceneId;
  const cue = lastCueAt(state, timeMs);
  if (cue) {
    if (visualizerEventsOf(state).length > 0) return undefined;
    if (!visWindowCovers(state, timeMs)) return undefined;
    return cue.sceneId;
  }
  if (visualizerEventsOf(state).length > 0) return undefined;
  if (!visWindowCovers(state, timeMs)) return undefined;
  return state.sceneId;
}

export const sceneIdAt = sceneAt;

/** Event / cue / window scene at t. */
export function visualizerSceneAt(
  vis: VisualizerState | Project,
  timeMs: number,
): VisualizerSceneId | undefined {
  return sceneAt(vis, timeMs);
}

/**
 * Set the VIS scene at t using the same cue rematerialize path as cycle,
 * but with an explicit scene id (menu pick). Always rematerializes events
 * so the lane / renderer cannot keep showing a stale covering event.
 */
export function setVisualizerSceneAt(
  project: Project,
  timeMs: number,
  sceneId: VisualizerSceneId,
): { project: Project; event?: VisualizerEvent } {
  const t = Math.max(0, roundVisMs(timeMs));
  const stamp = new Date().toISOString();
  let nextCues = cuesOf(project);
  if (t > 0 && !nextCues.some((c) => c.startMs === 0)) {
    nextCues = [{ startMs: 0, sceneId: project.visualizer.sceneId }, ...nextCues];
  }
  nextCues = upsertCueList(nextCues, t, sceneId);
  const events = rematerializeEventsFromCues(
    { ...project, visualizer: { ...project.visualizer, cues: nextCues } },
    nextCues,
  );
  const nextProject: Project = {
    ...project,
    visualizer: {
      ...project.visualizer,
      sceneId,
      cues: nextCues,
      events,
    },
    updatedAt: stamp,
  };
  return {
    project: nextProject,
    event:
      events.find((e) => e.startMs === t) ??
      events.find((e) => t >= e.startMs && t < e.startMs + e.durationMs),
  };
}

export function insertCueAtPlayhead(
  project: Project,
  timeMs: number,
): { project: Project; event?: VisualizerEvent } {
  const t = Math.max(0, roundVisMs(timeMs));
  const hadCues = cuesOf(project).length > 0;
  const hadEvents = visualizerEventsOf(project).length > 0;
  const stamp = new Date().toISOString();

  if (t === 0) {
    const nextId = nextSceneId(project.visualizer.sceneId);
    const nextCues = upsertCueList(cuesOf(project), 0, nextId);
    const shouldRemat = !hadEvents || hadCues;
    const events = shouldRemat ? rematerializeEventsFromCues(project, nextCues) : visualizerEventsOf(project);
    const nextProject: Project = {
      ...project,
      visualizer: {
        ...project.visualizer,
        sceneId: nextId,
        cues: nextCues,
        events,
      },
      updatedAt: stamp,
    };
    return {
      project: nextProject,
      event: shouldRemat ? events.find((e) => e.startMs === 0) : undefined,
    };
  }

  let nextCues = cuesOf(project);
  if (!nextCues.some((c) => c.startMs === 0)) {
    nextCues = [{ startMs: 0, sceneId: project.visualizer.sceneId }, ...nextCues];
  }
  const left = sceneAt({ ...project.visualizer, cues: nextCues }, Math.max(0, t - 1)) ?? project.visualizer.sceneId;
  const right = nextSceneId(left);
  nextCues = upsertCueList(nextCues, t, right);
  const events = rematerializeEventsFromCues({ ...project, visualizer: { ...project.visualizer, cues: nextCues } }, nextCues);
  const nextProject: Project = {
    ...project,
    visualizer: {
      ...project.visualizer,
      sceneId: right,
      cues: nextCues,
      events,
    },
    updatedAt: stamp,
  };
  return {
    project: nextProject,
    event: events.find((e) => e.startMs === t),
  };
}

/**
 * VIS overlay: an event covering t shows even when video exists.
 * Empty events keep the legacy gap-fill (window + no unmuted V1/V2).
 */
export function shouldShowVisualizer(project: Project, timeMs: number): boolean {
  return resolvePictureSource(contextFromProject(project), timeMs).kind === "vis";
}

export function setVisualizer(
  project: Project,
  patch: Partial<Pick<VisualizerState, "sceneId" | "startMs" | "durationMs" | "enabled" | "muted">>,
): Project {
  const startMs = Math.max(0, roundVisMs(patch.startMs ?? project.visualizer.startMs ?? 0));
  const durationMs = Math.max(0, roundVisMs(patch.durationMs ?? project.visualizer.durationMs ?? 0));
  return {
    ...project,
    visualizer: {
      ...project.visualizer,
      ...patch,
      startMs,
      durationMs,
    },
    updatedAt: new Date().toISOString(),
  };
}

export function toggleVisualizerMute(project: Project): Project {
  return {
    ...project,
    visualizer: { ...project.visualizer, muted: !project.visualizer.muted },
    updatedAt: new Date().toISOString(),
  };
}

export function cycleVisualizerScene(project: Project, eventId?: string | null): Project {
  if (eventId) {
    const event = visualizerEventsOf(project).find((e) => e.id === eventId);
    if (event) {
      return updateVisualizerEvent(project, eventId, { sceneId: nextSceneId(event.sceneId) });
    }
  }
  return {
    ...project,
    visualizer: {
      ...project.visualizer,
      sceneId: nextSceneId(project.visualizer.sceneId),
    },
    updatedAt: new Date().toISOString(),
  };
}

export function insertVisualizerEvent(project: Project, timeMs: number): {
  project: Project;
  event: VisualizerEvent;
  inserted: boolean;
} {
  const t = Math.max(0, roundVisMs(timeMs));
  const covering = visualizerEventAt(project, t);
  if (covering) return { project, event: covering, inserted: false };
  const existing = [...visualizerEventsOf(project)].sort((a, b) => a.startMs - b.startMs);
  const next = existing.find((e) => e.startMs > t);
  const rawDur = next ? next.startMs - t : DEFAULT_VIS_EVENT_MS;
  const durationMs = Math.max(1, roundVisMs(rawDur));
  const event: VisualizerEvent = {
    id: createId("ve"),
    sceneId: project.visualizer.sceneId,
    startMs: t,
    durationMs,
  };
  return {
    project: {
      ...project,
      visualizer: {
        ...project.visualizer,
        events: [...existing, event],
      },
      updatedAt: new Date().toISOString(),
    },
    event,
    inserted: true,
  };
}

export function updateVisualizerEvent(
  project: Project,
  eventId: string,
  patch: Partial<Pick<VisualizerEvent, "sceneId" | "startMs" | "durationMs">>,
): Project {
  const events = visualizerEventsOf(project);
  const index = events.findIndex((e) => e.id === eventId);
  if (index < 0) return project;
  const current = events[index]!;
  const next: VisualizerEvent = {
    ...current,
    sceneId: patch.sceneId ?? current.sceneId,
    startMs: Math.max(0, roundVisMs(patch.startMs ?? current.startMs)),
    durationMs: Math.max(1, roundVisMs(patch.durationMs ?? current.durationMs)),
  };
  if (
    next.sceneId === current.sceneId &&
    next.startMs === current.startMs &&
    next.durationMs === current.durationMs
  ) {
    return project;
  }
  const copy = [...events];
  copy[index] = next;
  return {
    ...project,
    visualizer: { ...project.visualizer, events: copy },
    updatedAt: new Date().toISOString(),
  };
}

export function moveVisualizerEvent(project: Project, eventId: string, startMs: number): Project {
  const event = visualizerEventsOf(project).find((e) => e.id === eventId);
  if (!event) return project;
  return updateVisualizerEvent(project, eventId, {
    startMs,
    durationMs: event.durationMs,
  });
}

export function stretchVisualizerEvent(
  project: Project,
  eventId: string,
  edge: "in" | "out",
  nextEdgeMs: number,
): Project {
  const event = visualizerEventsOf(project).find((e) => e.id === eventId);
  if (!event) return project;
  const min = minVisEventDurationMs();
  const end = visEventEndMs(event);
  if (edge === "in") {
    let start = Math.max(0, roundVisMs(nextEdgeMs));
    if (end - start < min) start = Math.max(0, roundVisMs(end - min));
    return updateVisualizerEvent(project, eventId, {
      startMs: start,
      durationMs: Math.max(min, end - start),
    });
  }
  let out = Math.max(0, roundVisMs(nextEdgeMs));
  const start = Math.max(0, roundVisMs(event.startMs));
  if (out - start < min) out = start + min;
  return updateVisualizerEvent(project, eventId, { startMs: start, durationMs: Math.max(min, out - start) });
}

export function deleteVisualizerEvent(project: Project, eventId: string): Project {
  const events = visualizerEventsOf(project);
  if (!events.some((e) => e.id === eventId)) return project;
  return {
    ...project,
    visualizer: {
      ...project.visualizer,
      events: events.filter((e) => e.id !== eventId),
    },
    updatedAt: new Date().toISOString(),
  };
}

/** Fallback VIS-lane span when events/cues are empty (same paint as the window block). */
export function visLaneSpanMs(project: Project): { startMs: number; durationMs: number } {
  const startMs = Math.max(0, roundVisMs(project.visualizer.startMs ?? 0));
  const rawDur = project.visualizer.durationMs ?? 0;
  const durationMs =
    rawDur > 0 ? Math.max(1, roundVisMs(rawDur)) : Math.max(10_000, roundVisMs(projectDurationMs(project)));
  return { startMs, durationMs };
}

function withVisualizerEvents(project: Project, events: VisualizerEvent[], cues?: VisualizerCue[]): Project {
  return {
    ...project,
    visualizer: {
      ...project.visualizer,
      events,
      ...(cues ? { cues } : {}),
    },
    updatedAt: new Date().toISOString(),
  };
}

/** Cues → events, else the window/fallback span as one event. No-op when events already exist. */
export function materializeVisualizerEvents(project: Project): Project {
  if (visualizerEventsOf(project).length > 0) return project;
  const cues = cuesOf(project);
  if (cues.length > 0) {
    return withVisualizerEvents(project, rematerializeEventsFromCues(project, cues), cues);
  }
  const span = visLaneSpanMs(project);
  if (span.durationMs < minVisEventDurationMs()) return project;
  return withVisualizerEvents(project, [
    {
      id: createId("ve"),
      sceneId: project.visualizer.sceneId,
      startMs: span.startMs,
      durationMs: span.durationMs,
    },
  ]);
}

export function splitVisualizerEventAt(
  project: Project,
  eventId: string,
  timeMs: number,
  edgeGuardMs = minVisEventDurationMs(),
): { project: Project; leftId?: string; rightId?: string; error?: string } {
  const event = visualizerEventsOf(project).find((e) => e.id === eventId);
  if (!event) return { project, error: "VIS event not found" };
  const t = Math.max(0, roundVisMs(timeMs));
  const offset = t - event.startMs;
  const min = Math.max(minVisEventDurationMs(), Math.round(edgeGuardMs));
  if (offset < min || event.durationMs - offset < min) {
    return { project, error: "Split too close to VIS event edge" };
  }
  const left: VisualizerEvent = { ...event, durationMs: offset };
  const right: VisualizerEvent = {
    ...event,
    id: createId("ve"),
    startMs: t,
    durationMs: event.durationMs - offset,
  };
  const events = visualizerEventsOf(project).flatMap((e) => (e.id === eventId ? [left, right] : [e]));
  const cues = cuesOf(project);
  return {
    project: withVisualizerEvents(
      project,
      events,
      cues.length > 0 ? upsertCueList(cues, t, event.sceneId) : undefined,
    ),
    leftId: left.id,
    rightId: right.id,
  };
}

/** Split every VIS event covering the playhead. Materializes cues/window first. */
export function splitVisualizerAtPlayhead(
  project: Project,
  edgeGuardMs = minVisEventDurationMs(),
): { project: Project; error?: string } {
  const prepared = materializeVisualizerEvents(project);
  const t = Math.max(0, roundVisMs(prepared.playheadMs));
  const hits = visualizerEventsOf(prepared).filter((event) => visualizerEventCovers(event, t));
  if (hits.length === 0) {
    return { project, error: "No VIS event under playhead" };
  }
  let next = prepared;
  let splitAny = false;
  let lastError: string | undefined;
  for (const event of hits) {
    const current = visualizerEventsOf(next).find((e) => e.id === event.id);
    if (!current) continue;
    const result = splitVisualizerEventAt(next, current.id, t, edgeGuardMs);
    if (result.error) lastError = result.error;
    else {
      next = result.project;
      splitAny = true;
    }
  }
  if (!splitAny) return { project, error: lastError ?? "Split rejected" };
  return { project: next };
}

export function visEventClipboardOf(event: VisualizerEvent): VisEventClipboard {
  return { sceneId: event.sceneId, durationMs: Math.max(1, roundVisMs(event.durationMs)) };
}

export function pasteVisualizerEvent(
  project: Project,
  snap: VisEventClipboard,
  timeMs: number,
): { project: Project; event: VisualizerEvent } {
  const event: VisualizerEvent = {
    id: createId("ve"),
    sceneId: snap.sceneId,
    startMs: Math.max(0, roundVisMs(timeMs)),
    durationMs: Math.max(minVisEventDurationMs(), roundVisMs(snap.durationMs)),
  };
  return {
    project: {
      ...project,
      visualizer: {
        ...project.visualizer,
        events: [...visualizerEventsOf(project), event],
      },
      updatedAt: new Date().toISOString(),
    },
    event,
  };
}

export function renderVisualizerScene(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  sceneId: VisualizerSceneId,
  features: AudioFeatures,
  dt: number,
): void {
  if (w <= 0 || h <= 0) return;
  const scene = getRegisteredScene(sceneId);
  if (!scene) return;
  const params = scene.defaultParams;
  ctx.fillStyle = (params.colorSecondary as string) || "#0a0a12";
  ctx.fillRect(0, 0, w, h);
  scene.render({ width: w, height: h, ctx }, features, params, dt);
}
