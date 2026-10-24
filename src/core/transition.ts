import { createId } from "./ids";
import { livingLinkedMate } from "./link";
import {
  TRACK_IDS,
  audioTrackIdsOf,
  clipById,
  clipEndMs,
  clipIsEnabled,
  clipIsLocked,
  clipOnTrackAt,
  isTrackAudible,
  kindOfTrack,
  type Clip,
  type FrontVideoTrackId,
  type Project,
  type TrackId,
} from "./models";

/** Same-track crossfade length for the Edit menu, T, and the default command. */
export const DEFAULT_CROSSFADE_MS = 500;

const SAME_TRACK_ABUT_MS = 2;

export const TRANSITION_TYPES = ["cut", "crossfade", "fadeBlack", "fadeWhite"] as const;
export type TransitionType = (typeof TRANSITION_TYPES)[number];

export const TRANSITION_AUDIO_MODES = ["cut", "crossfade", "keepA", "keepB"] as const;
export type TransitionAudioMode = (typeof TRANSITION_AUDIO_MODES)[number];

export const TRANSITION_SOURCES = ["auto", "vis", "V1", "V2", "black"] as const;
export type TransitionSource = (typeof TRANSITION_SOURCES)[number];

export interface Transition {
  id: string;
  type: TransitionType;
  startMs: number;
  durationMs: number;
  sourceAClipId: string;
  sourceBClipId: string;
  /** Canonical audio mode. Missing = cut. */
  audio?: TransitionAudioMode;
  /** Legacy alias of `audio`. Sanitize writes both. */
  audioMode: TransitionAudioMode;
  /** Independent of video `durationMs`. 0 + cut = today's mix. */
  audioDurationMs: number;
  /** Picture override for this edit window. Missing = auto. */
  source?: TransitionSource;
}

export interface EditPair {
  sourceA: Clip;
  sourceB: Clip;
  overlapStartMs: number;
  overlapDurationMs: number;
}

export interface CompositeLayer {
  clipId: string;
  alpha: number;
}

export interface VideoComposite {
  layers: CompositeLayer[];
  plate?: { color: "#000000" | "#ffffff"; alpha: number };
}

export interface CompositeClip {
  id: string;
  trackId: TrackId;
  startMs: number;
  endMs: number;
}

export interface CompositeVis {
  enabled: boolean;
  muted: boolean;
  events: { startMs: number; durationMs: number }[];
  startMs: number;
  durationMs: number;
}

export interface CompositeContext {
  clips: CompositeClip[];
  transitions: Transition[];
  /** Which video track covers on overlap / cut. Default V2. */
  frontVideoTrackId?: FrontVideoTrackId;
  mutedTrackIds?: TrackId[];
  vis?: CompositeVis;
}

export type PictureKind = "vis" | "V1" | "V2" | "black";

export interface ResolvedPicture {
  /** Configured override, or auto when none. */
  source: TransitionSource;
  /** AUTO-resolved or explicit result. */
  kind: PictureKind;
  clipId?: string;
}

export function isTransitionType(value: unknown): value is TransitionType {
  return typeof value === "string" && (TRANSITION_TYPES as readonly string[]).includes(value);
}

export function isTransitionAudioMode(value: unknown): value is TransitionAudioMode {
  return typeof value === "string" && (TRANSITION_AUDIO_MODES as readonly string[]).includes(value);
}

export function isTransitionSource(value: unknown): value is TransitionSource {
  return typeof value === "string" && (TRANSITION_SOURCES as readonly string[]).includes(value);
}

export function transitionSourceOf(t: Transition | undefined): TransitionSource {
  return t?.source && isTransitionSource(t.source) ? t.source : "auto";
}

export function transitionAudioOf(t: Transition | undefined): TransitionAudioMode {
  if (t?.audio && isTransitionAudioMode(t.audio)) return t.audio;
  if (t?.audioMode && isTransitionAudioMode(t.audioMode)) return t.audioMode;
  return "cut";
}

export function transitionAudioDurationMs(t: Transition | undefined): number {
  const n = t?.audioDurationMs;
  if (n == null || !Number.isFinite(n)) return 0;
  return Math.max(0, n);
}

/** cut/crossfade with duration 0 (or missing) = identity mix. keepA/keepB still apply. */
export function isIdentityAudio(t: Transition): boolean {
  const audio = transitionAudioOf(t);
  const dur = transitionAudioDurationMs(t);
  if (audio === "cut" && dur <= 0) return true;
  if (audio === "crossfade" && dur <= 0) return true;
  return false;
}

export function formatResolvedSource(picture: ResolvedPicture): string {
  const name = picture.kind === "vis" ? "VIS" : picture.kind === "black" ? "BLACK" : picture.kind;
  if (picture.source === "auto") return `AUTO→${name}`;
  return name;
}

export function clipsOverlapMs(a: { startMs: number; durationMs?: number; endMs?: number }, b: {
  startMs: number;
  durationMs?: number;
  endMs?: number;
}): { startMs: number; durationMs: number } | undefined {
  const aEnd = a.endMs ?? a.startMs + (a.durationMs ?? 0);
  const bEnd = b.endMs ?? b.startMs + (b.durationMs ?? 0);
  const start = Math.max(a.startMs, b.startMs);
  const end = Math.min(aEnd, bEnd);
  if (end <= start) return undefined;
  return { startMs: start, durationMs: end - start };
}

/** Outgoing A ends first; tie uses lower→higher TRACK_IDS order. Any two video tracks. */
export function orderOutgoingIncoming(x: Clip, y: Clip): { sourceA: Clip; sourceB: Clip } {
  const endX = clipEndMs(x);
  const endY = clipEndMs(y);
  if (endX < endY) return { sourceA: x, sourceB: y };
  if (endY < endX) return { sourceA: y, sourceB: x };
  const ix = TRACK_IDS.indexOf(x.trackId);
  const iy = TRACK_IDS.indexOf(y.trackId);
  return ix <= iy ? { sourceA: x, sourceB: y } : { sourceA: y, sourceB: x };
}

/**
 * Selected clip(s) → overlapping pair on two video tracks.
 * One selected video clip looks for an overlapping video clip on another track.
 * V1→V2 and V2↑V1 both resolve to the same outgoing/incoming order.
 */
export function resolveEditPair(
  project: Project,
  selectedIds: readonly string[],
): EditPair | undefined {
  const selected = selectedIds
    .map((id) => clipById(project, id))
    .filter((c): c is Clip => c != null)
    .filter((c) => clipIsEnabled(c) && kindOfTrack(c.trackId) === "video");

  const tryPair = (x: Clip, y: Clip): EditPair | undefined => {
    if (x.trackId === y.trackId) return undefined;
    if (kindOfTrack(y.trackId) !== "video") return undefined;
    const overlap = clipsOverlapMs(x, y);
    if (!overlap) return undefined;
    const ordered = orderOutgoingIncoming(x, y);
    return { ...ordered, overlapStartMs: overlap.startMs, overlapDurationMs: overlap.durationMs };
  };

  if (selected.length >= 2) {
    for (let i = 0; i < selected.length; i++) {
      for (let j = i + 1; j < selected.length; j++) {
        const pair = tryPair(selected[i]!, selected[j]!);
        if (pair) return pair;
      }
    }
    return undefined;
  }

  if (selected.length === 1) {
    const one = selected[0]!;
    for (const other of project.clips) {
      if (other.id === one.id) continue;
      if (!clipIsEnabled(other)) continue;
      if (kindOfTrack(other.trackId) !== "video") continue;
      const pair = tryPair(one, other);
      if (pair) return pair;
    }
  }
  return undefined;
}

export interface StackedOverlapMark {
  sourceA: Clip;
  sourceB: Clip;
  overlapStartMs: number;
  overlapDurationMs: number;
  type: TransitionType;
  durationMs: number;
  startMs: number;
  audio: TransitionAudioMode;
  audioDurationMs: number;
}

/** Every stacked video overlap (any two video tracks). Implicit = cut. */
export function listStackedEditPairs(project: Project): StackedOverlapMark[] {
  const videos = project.clips.filter((c) => clipIsEnabled(c) && kindOfTrack(c.trackId) === "video");
  const out: StackedOverlapMark[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < videos.length; i++) {
    for (let j = i + 1; j < videos.length; j++) {
      const x = videos[i]!;
      const y = videos[j]!;
      if (x.trackId === y.trackId) continue;
      const overlap = clipsOverlapMs(x, y);
      if (!overlap) continue;
      const { sourceA, sourceB } = orderOutgoingIncoming(x, y);
      const key = `${sourceA.id}\0${sourceB.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const stored = findTransitionForPair(project.transitions ?? [], sourceA.id, sourceB.id);
      out.push({
        sourceA,
        sourceB,
        overlapStartMs: overlap.startMs,
        overlapDurationMs: overlap.durationMs,
        type: stored?.type ?? "cut",
        durationMs: stored?.durationMs ?? Math.max(1, overlap.durationMs),
        startMs: stored?.startMs ?? overlap.startMs,
        audio: transitionAudioOf(stored),
        audioDurationMs: transitionAudioDurationMs(stored),
      });
    }
  }
  return out;
}

export function findTransitionForPair(
  transitions: readonly Transition[],
  sourceAClipId: string,
  sourceBClipId: string,
): Transition | undefined {
  return transitions.find(
    (t) => t.sourceAClipId === sourceAClipId && t.sourceBClipId === sourceBClipId,
  );
}

export function transitionCovers(t: Transition, timeMs: number): boolean {
  return timeMs >= t.startMs && timeMs < t.startMs + Math.max(0, t.durationMs);
}

export function transitionAt(transitions: readonly Transition[], timeMs: number): Transition | undefined {
  return transitions.find((t) => transitionCovers(t, timeMs));
}

function visEventCoversIn(vis: CompositeVis, timeMs: number): boolean {
  return vis.events.some(
    (event) => timeMs >= event.startMs && timeMs < event.startMs + Math.max(0, event.durationMs),
  );
}

function visWindowCoversIn(vis: CompositeVis, timeMs: number): boolean {
  const dur = vis.durationMs ?? 0;
  if (dur <= 0) return true;
  const start = vis.startMs ?? 0;
  return timeMs >= start && timeMs < start + dur;
}

function coveringVideoOnTrack(
  clips: readonly CompositeClip[],
  timeMs: number,
  trackId: "V1" | "V2",
  _muted?: ReadonlySet<string>,
): CompositeClip | undefined {
  return clips.find(
    (c) =>
      c.trackId === trackId &&
      kindOfTrack(c.trackId) === "video" &&
      timeMs >= c.startMs &&
      timeMs < c.endMs,
  );
}

function mutedSetOf(ctx: CompositeContext): Set<string> {
  return new Set(ctx.mutedTrackIds ?? []);
}

export function topVideoClipId(
  clips: readonly CompositeClip[],
  timeMs: number,
  front: FrontVideoTrackId = "V2",
  _mutedTrackIds: readonly TrackId[] = [],
): string | undefined {
  const hits = clips.filter(
    (c) => kindOfTrack(c.trackId) === "video" && timeMs >= c.startMs && timeMs < c.endMs,
  );
  if (hits.length === 0) return undefined;
  const preferred = hits.find((c) => c.trackId === front);
  if (preferred) return preferred.id;
  hits.sort((a, b) => TRACK_IDS.indexOf(b.trackId) - TRACK_IDS.indexOf(a.trackId));
  return hits[0]!.id;
}

/** Both pair clips must be present (disabled / out-of-range clips drop the window). */
export function transitionSourcesIn(
  t: Pick<Transition, "sourceAClipId" | "sourceBClipId">,
  clipIds: ReadonlySet<string>,
): boolean {
  return clipIds.has(t.sourceAClipId) && clipIds.has(t.sourceBClipId);
}

function coveringTransition(ctx: CompositeContext, timeMs: number): Transition | undefined {
  const t = transitionAt(ctx.transitions, timeMs);
  if (!t || t.durationMs <= 0) return undefined;
  const ids = new Set(ctx.clips.map((c) => c.id));
  if (!transitionSourcesIn(t, ids)) return undefined;
  return t;
}

function visLive(vis: CompositeVis | undefined): boolean {
  return Boolean(vis && vis.enabled && !vis.muted);
}

/**
 * AUTO + explicit source at t. Preview and export must call this (via the same
 * composite context) so picture matches.
 */
export function resolvePictureSource(ctx: CompositeContext, timeMs: number): ResolvedPicture {
  const t = coveringTransition(ctx, timeMs);
  const source = transitionSourceOf(t);
  const vis = ctx.vis;
  const front: FrontVideoTrackId = ctx.frontVideoTrackId === "V1" ? "V1" : "V2";
  const other: FrontVideoTrackId = front === "V1" ? "V2" : "V1";

  const visIfEvent = (): ResolvedPicture | undefined => {
    if (visLive(vis) && vis && visEventCoversIn(vis, timeMs)) return { source, kind: "vis" };
    return undefined;
  };
  const videoOn = (trackId: "V1" | "V2"): ResolvedPicture | undefined => {
    const clip = coveringVideoOnTrack(ctx.clips, timeMs, trackId);
    return clip ? { source, kind: trackId, clipId: clip.id } : undefined;
  };
  const legacyVis = (): ResolvedPicture | undefined => {
    if (!visLive(vis) || !vis) return undefined;
    if (vis.events.length > 0) return undefined;
    if (!visWindowCoversIn(vis, timeMs)) return undefined;
    return { source, kind: "vis" };
  };

  if (source === "black") return { source, kind: "black" };
  if (source === "vis") return visIfEvent() ?? { source, kind: "black" };
  if (source === "V1" || source === "V2") return videoOn(source) ?? { source, kind: "black" };

  return videoOn(front) ?? videoOn(other) ?? visIfEvent() ?? legacyVis() ?? { source: "auto", kind: "black" };
}

export function editPairAt(project: Project, timeMs: number): EditPair | undefined {
  for (const mark of listStackedEditPairs(project)) {
    if (timeMs >= mark.overlapStartMs && timeMs < mark.overlapStartMs + mark.overlapDurationMs) {
      return {
        sourceA: mark.sourceA,
        sourceB: mark.sourceB,
        overlapStartMs: mark.overlapStartMs,
        overlapDurationMs: mark.overlapDurationMs,
      };
    }
  }
  return undefined;
}

/**
 * Probe after snapPlayheadSeek. Half-open overlap/window: a snap to the
 * exclusive end still counts as this edit. Does not move the playhead.
 */
export function editPairAtProbe(project: Project, timeMs: number): EditPair | undefined {
  return editPairAt(project, timeMs) ?? editPairAt(project, Math.max(0, timeMs - 1));
}

export function transitionAtProbe(
  transitions: readonly Transition[],
  timeMs: number,
): Transition | undefined {
  return transitionAt(transitions, timeMs) ?? transitionAt(transitions, Math.max(0, timeMs - 1));
}

function mixEndsOf(t: Transition, ctx: CompositeContext, timeMs: number): { a: string; b: string } {
  const src = transitionSourceOf(t);
  if (src !== "V1" && src !== "V2") return { a: t.sourceAClipId, b: t.sourceBClipId };
  const chosen = coveringVideoOnTrack(ctx.clips, timeMs, src, mutedSetOf(ctx));
  if (!chosen) return { a: t.sourceAClipId, b: t.sourceBClipId };
  const otherId = chosen.id === t.sourceAClipId ? t.sourceBClipId : t.sourceAClipId;
  return { a: otherId, b: chosen.id };
}

/**
 * Shared preview/export compositor. Transition types at t in the window;
 * outside the window, existing stack order (later video track on top).
 * Explicit vis/black hide video layers. AUTO vis is an overlay (P34) and
 * does not clear the video stack.
 */
export function compositeVideoAt(ctx: CompositeContext, timeMs: number): VideoComposite {
  const front = ctx.frontVideoTrackId === "V1" ? "V1" : "V2";
  const muted = ctx.mutedTrackIds ?? [];
  const t = coveringTransition(ctx, timeMs);
  const source = transitionSourceOf(t);
  if (source === "black") {
    return { layers: [], plate: { color: "#000000", alpha: 1 } };
  }
  if (source === "vis") {
    return { layers: [] };
  }
  const cutFront: FrontVideoTrackId = source === "V1" || source === "V2" ? source : front;
  if (!t) {
    const id = topVideoClipId(ctx.clips, timeMs, cutFront, muted);
    return id ? { layers: [{ clipId: id, alpha: 1 }] } : { layers: [] };
  }
  const u = Math.max(0, Math.min(1, (timeMs - t.startMs) / t.durationMs));
  if (t.type === "cut") {
    const covering = topVideoClipId(ctx.clips, timeMs, cutFront, muted) ?? t.sourceBClipId;
    return { layers: [{ clipId: covering, alpha: 1 }] };
  }
  const ends = mixEndsOf(t, ctx, timeMs);
  if (t.type === "crossfade") {
    return {
      layers: [
        { clipId: ends.a, alpha: 1 - u },
        { clipId: ends.b, alpha: u },
      ],
    };
  }
  const plateColor = t.type === "fadeWhite" ? "#ffffff" : "#000000";
  if (u < 0.5) {
    const p = u * 2;
    return {
      layers: [{ clipId: ends.a, alpha: 1 - p }],
      plate: { color: plateColor, alpha: p },
    };
  }
  const p = (u - 0.5) * 2;
  return {
    layers: [{ clipId: ends.b, alpha: p }],
    plate: { color: plateColor, alpha: 1 - p },
  };
}

function visFromProject(project: Project): CompositeVis {
  return {
    enabled: project.visualizer.enabled,
    muted: project.visualizer.muted,
    events: (project.visualizer.events ?? []).map((e) => ({
      startMs: e.startMs,
      durationMs: e.durationMs,
    })),
    startMs: project.visualizer.startMs ?? 0,
    durationMs: project.visualizer.durationMs ?? 0,
  };
}

export function contextFromProject(project: Project): CompositeContext {
  const mutedTrackIds = audioTrackIdsOf(project).filter((id) => !isTrackAudible(project, id));
  return {
    clips: project.clips
      .filter((c) => c.enabled !== false)
      .map((c) => ({
        id: c.id,
        trackId: c.trackId,
        startMs: c.startMs,
        endMs: clipEndMs(c),
      })),
    transitions: project.transitions ?? [],
    frontVideoTrackId: project.frontVideoTrackId === "V1" ? "V1" : "V2",
    mutedTrackIds,
    vis: visFromProject(project),
  };
}

export function contextFromExportClips(
  clips: readonly { id: string; trackId: TrackId; startMs: number; endMs: number }[],
  transitions: readonly Transition[] = [],
  frontVideoTrackId: FrontVideoTrackId = "V2",
  vis?: CompositeVis,
): CompositeContext {
  return {
    clips: clips.map((c) => ({ ...c })),
    transitions: [...transitions],
    frontVideoTrackId: frontVideoTrackId === "V1" ? "V1" : "V2",
    vis,
  };
}

export function primaryLayer(composite: VideoComposite): CompositeLayer | undefined {
  if (composite.layers.length === 0) return undefined;
  return [...composite.layers].sort((a, b) => b.alpha - a.alpha)[0];
}

export function layerAlpha(composite: VideoComposite, clipId: string): number {
  return composite.layers.find((l) => l.clipId === clipId)?.alpha ?? 0;
}

/** Extra mix multiplier over a clip span. Does not write clip fades. */
export function scheduleTransitionAudioGain(
  param: {
    setValueAtTime(value: number, time: number): unknown;
    linearRampToValueAtTime(value: number, time: number): unknown;
  },
  transitions: readonly Transition[],
  clipId: string,
  clipStartMs: number,
  clipEndMs: number,
  project?: Project,
  peers?: readonly TransitionPeer[],
): void {
  if (transitions.length === 0) {
    param.setValueAtTime(1, Math.max(0, clipStartMs) / 1000);
    return;
  }
  const times = new Set<number>([clipStartMs, clipEndMs]);
  for (const t of transitions) {
    times.add(t.startMs);
    times.add(t.startMs + Math.max(0, t.durationMs));
    const audioDur = transitionAudioDurationMs(t);
    times.add(t.startMs + audioDur);
    if (audioDur > 0) {
      for (let step = 1; step < 4; step++) {
        times.add(t.startMs + (audioDur * step) / 4);
      }
    }
  }
  const sorted = [...times]
    .filter((t) => t >= clipStartMs && t <= clipEndMs)
    .sort((a, b) => a - b);
  sorted.forEach((tMs, i) => {
    const g = transitionAudioGain(transitions, clipId, tMs, project, peers);
    const t = tMs / 1000;
    if (i === 0) param.setValueAtTime(g, t);
    else param.linearRampToValueAtTime(g, t);
  });
}

/** Equal-power A→B (same law as pan). u=0 → A=1 B=0; u=1 → A=0 B=1. */
export function equalPowerCrossfade(u: number): { a: number; b: number } {
  const t = Math.max(0, Math.min(1, u));
  return { a: Math.cos((t * Math.PI) / 2), b: Math.sin((t * Math.PI) / 2) };
}

export interface TransitionPeer {
  id: string;
  linkId?: string;
}

function clipIdsForSource(
  clipId: string,
  project?: Project,
  peers?: readonly TransitionPeer[],
): Set<string> {
  const ids = new Set<string>([clipId]);
  if (project) {
    const mate = livingLinkedMate(project, clipId);
    if (mate) ids.add(mate.id);
  }
  if (peers) {
    const self = peers.find((c) => c.id === clipId);
    if (self?.linkId) {
      for (const p of peers) {
        if (p.linkId === self.linkId) ids.add(p.id);
      }
    }
  }
  return ids;
}

/**
 * Extra mix multiplier for V-audio (pair A/B + linked soundtrack).
 * A1/A2 that are not the pair's linked mates stay at 1 (today's mix).
 * Picture `source` is ignored. cut+duration0 / missing = identity.
 */
export function transitionAudioGain(
  transitions: readonly Transition[],
  clipId: string,
  timeMs: number,
  project?: Project,
  peers?: readonly TransitionPeer[],
): number {
  let gain = 1;
  for (const t of transitions) {
    if (isIdentityAudio(t)) continue;
    if (project) {
      const a = clipById(project, t.sourceAClipId);
      const b = clipById(project, t.sourceBClipId);
      if (!a || !b || !clipIsEnabled(a) || !clipIsEnabled(b)) continue;
    }
    const aIds = clipIdsForSource(t.sourceAClipId, project, peers);
    const bIds = clipIdsForSource(t.sourceBClipId, project, peers);
    const inA = aIds.has(clipId);
    const inB = bIds.has(clipId);
    if (!inA && !inB) continue;
    const audio = transitionAudioOf(t);
    if (audio === "cut") {
      if (timeMs < t.startMs) {
        if (inB) gain *= 0;
      } else if (inA) {
        gain *= 0;
      }
      continue;
    }
    if (audio === "keepA" || audio === "keepB") {
      if (!transitionCovers(t, timeMs)) continue;
      if (audio === "keepA" && inB) gain *= 0;
      if (audio === "keepB" && inA) gain *= 0;
      continue;
    }
    const audioDur = transitionAudioDurationMs(t);
    if (audioDur <= 0) continue;
    if (timeMs < t.startMs) {
      if (inB) gain *= 0;
      continue;
    }
    if (timeMs >= t.startMs + audioDur) {
      if (inA) gain *= 0;
      continue;
    }
    const u = (timeMs - t.startMs) / audioDur;
    const xf = equalPowerCrossfade(u);
    if (inA) gain *= xf.a;
    if (inB) gain *= xf.b;
  }
  return gain;
}

export function upsertTransition(
  project: Project,
  pair: EditPair,
  patch: Partial<Pick<Transition, "type" | "durationMs" | "audioMode" | "audio" | "audioDurationMs" | "startMs" | "source">>,
): { project: Project; transition: Transition } {
  const existing = findTransitionForPair(
    project.transitions ?? [],
    pair.sourceA.id,
    pair.sourceB.id,
  );
  const rawDur = patch.durationMs ?? existing?.durationMs ?? Math.max(1, Math.min(1000, pair.overlapDurationMs));
  const durationMs = Math.max(0, rawDur);
  const audio = transitionAudioOf({
    audio: patch.audio ?? existing?.audio,
    audioMode: patch.audioMode ?? existing?.audioMode ?? "cut",
  } as Transition);
  const audioDurationMs = Math.max(
    0,
    patch.audioDurationMs ?? existing?.audioDurationMs ?? 0,
  );
  const next: Transition = {
    id: existing?.id ?? createId("tr"),
    type: patch.type ?? existing?.type ?? "cut",
    startMs: patch.startMs ?? existing?.startMs ?? pair.overlapStartMs,
    durationMs,
    sourceAClipId: pair.sourceA.id,
    sourceBClipId: pair.sourceB.id,
    audio,
    audioMode: audio,
    audioDurationMs,
    source: patch.source ?? existing?.source ?? "auto",
  };
  const rest = (project.transitions ?? []).filter((t) => t.id !== next.id);
  return {
    project: {
      ...project,
      transitions: [...rest, next],
      updatedAt: new Date().toISOString(),
    },
    transition: next,
  };
}

export function setTransitionSource(
  project: Project,
  transitionId: string,
  source: TransitionSource,
): Project {
  const transitions = project.transitions ?? [];
  const index = transitions.findIndex((t) => t.id === transitionId);
  if (index < 0) return project;
  const current = transitions[index]!;
  if (transitionSourceOf(current) === source && current.source === source) return project;
  const copy = [...transitions];
  copy[index] = { ...current, source };
  return {
    ...project,
    transitions: copy,
    updatedAt: new Date().toISOString(),
  };
}

export function sanitizeTransitions(raw: unknown): Transition[] {
  if (!Array.isArray(raw)) return [];
  const out: Transition[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    if (typeof r.id !== "string" || !r.id) continue;
    if (typeof r.sourceAClipId !== "string" || typeof r.sourceBClipId !== "string") continue;
    if (!isTransitionType(r.type)) continue;
    const durationMs = r.durationMs == null ? 1 : Math.max(0, Number(r.durationMs) || 0);
    const audio = isTransitionAudioMode(r.audio)
      ? r.audio
      : isTransitionAudioMode(r.audioMode)
        ? r.audioMode
        : "cut";
    const rawAudioDur = r.audioDurationMs;
    const audioDurationMs =
      rawAudioDur == null || rawAudioDur === ""
        ? 0
        : Math.max(0, Number(rawAudioDur) || 0);
    out.push({
      id: r.id,
      type: r.type,
      startMs: Math.max(0, Number(r.startMs) || 0),
      durationMs,
      sourceAClipId: r.sourceAClipId,
      sourceBClipId: r.sourceBClipId,
      audio,
      audioMode: audio,
      audioDurationMs,
      source: isTransitionSource(r.source) ? r.source : "auto",
    });
  }
  return out;
}

function enabledOnTrack(project: Project, trackId: TrackId): Clip[] {
  return project.clips
    .filter((c) => c.trackId === trackId && clipIsEnabled(c))
    .sort((a, b) => a.startMs - b.startMs || a.id.localeCompare(b.id));
}

function abuttingNext(project: Project, clip: Clip): Clip | undefined {
  const end = clipEndMs(clip);
  return enabledOnTrack(project, clip.trackId).find(
    (c) => c.id !== clip.id && Math.abs(c.startMs - end) <= SAME_TRACK_ABUT_MS,
  );
}

function abuttingPrev(project: Project, clip: Clip): Clip | undefined {
  return enabledOnTrack(project, clip.trackId).find(
    (c) => c.id !== clip.id && Math.abs(clipEndMs(c) - clip.startMs) <= SAME_TRACK_ABUT_MS,
  );
}

/** Touching pair on one track. Two selected clips must be that pair. One selected clip uses its neighbor. */
export function resolveSameTrackPair(
  project: Project,
  clipIds: readonly string[],
): { left: Clip; right: Clip } | { error: string } {
  const found = clipIds
    .map((id) => clipById(project, id))
    .filter((c): c is Clip => c != null && clipIsEnabled(c));
  if (found.length === 0) return { error: "No clip selected" };
  if (found.length >= 2) {
    const sorted = [...found].sort((a, b) => a.startMs - b.startMs || a.id.localeCompare(b.id));
    for (let i = 0; i < sorted.length - 1; i++) {
      const left = sorted[i]!;
      const right = sorted[i + 1]!;
      if (left.trackId !== right.trackId) continue;
      if (Math.abs(clipEndMs(left) - right.startMs) <= SAME_TRACK_ABUT_MS) return { left, right };
    }
    return { error: "Clips must touch on the same track" };
  }
  const one = found[0]!;
  const next = abuttingNext(project, one);
  if (next) return { left: one, right: next };
  const prev = abuttingPrev(project, one);
  if (prev) return { left: prev, right: one };
  return { error: "No touching clip on this track" };
}

/**
 * Overlap two touching clips on the same track and store a crossfade/dissolve.
 * Later clips on that track, and linked mates plus later clips on their tracks,
 * pull left by the overlap so the program shortens by the crossfade length.
 * One returned project. Callers commit a single undo step.
 */
export function addSameTrackCrossfade(
  project: Project,
  clipIds: readonly string[],
  durationMs = DEFAULT_CROSSFADE_MS,
): { project: Project; error?: string } {
  const pair = resolveSameTrackPair(project, clipIds);
  if ("error" in pair) return { project, error: pair.error };
  const { left, right } = pair;
  if (clipIsLocked(left) || clipIsLocked(right)) return { project, error: "Clip is locked" };
  const requested = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
  const dur = Math.min(requested, Math.floor(Math.min(left.durationMs, right.durationMs) / 2));
  if (dur < 1) return { project, error: "Crossfade does not fit" };

  const pull = new Set<string>();
  const absorbTrack = (trackId: TrackId, floorMs: number) => {
    for (const clip of project.clips) {
      if (clip.trackId === trackId && clip.startMs >= floorMs - SAME_TRACK_ABUT_MS) pull.add(clip.id);
    }
  };
  absorbTrack(right.trackId, right.startMs);
  let grew = true;
  while (grew) {
    grew = false;
    for (const clip of project.clips) {
      if (!pull.has(clip.id) || !clip.linkId) continue;
      for (const other of project.clips) {
        if (other.linkId !== clip.linkId || pull.has(other.id)) continue;
        pull.add(other.id);
        grew = true;
        const before = pull.size;
        absorbTrack(other.trackId, other.startMs);
        if (pull.size !== before) grew = true;
      }
    }
  }
  pull.delete(left.id);
  const moving = project.clips.filter((c) => pull.has(c.id));
  if (moving.some((c) => clipIsLocked(c))) return { project, error: "Clip is locked" };
  if (moving.some((c) => c.startMs - dur < 0)) return { project, error: "Crossfade would start before 0" };

  const startMs = right.startMs - dur;
  const existing = findTransitionForPair(project.transitions ?? [], left.id, right.id);
  const transition: Transition = {
    id: existing?.id ?? createId("tr"),
    type: "crossfade",
    startMs,
    durationMs: dur,
    sourceAClipId: left.id,
    sourceBClipId: right.id,
    audio: "crossfade",
    audioMode: "crossfade",
    audioDurationMs: dur,
    source: existing?.source ?? "auto",
  };
  return {
    project: {
      ...project,
      clips: project.clips.map((c) => (pull.has(c.id) ? { ...c, startMs: c.startMs - dur } : c)),
      transitions: [...(project.transitions ?? []).filter((t) => t.id !== transition.id), transition],
      updatedAt: new Date().toISOString(),
    },
  };
}

/** The other same-track clip while a crossfade covers timeMs. Cross-track pairs stay on their own elements. */
export function crossfadePartnerClip(project: Project, timeMs: number): Clip | undefined {
  const t = transitionAt(project.transitions ?? [], timeMs);
  if (!t || t.type !== "crossfade" || t.durationMs <= 0) return undefined;
  const a = clipById(project, t.sourceAClipId);
  const b = clipById(project, t.sourceBClipId);
  if (!a || !b || !clipIsEnabled(a) || !clipIsEnabled(b)) return undefined;
  if (a.trackId !== b.trackId) return undefined;
  const covers = (c: Clip) => timeMs >= c.startMs && timeMs < clipEndMs(c);
  if (!covers(a) || !covers(b)) return undefined;
  const primary = clipOnTrackAt(project, a.trackId, timeMs);
  return primary?.id === a.id ? b : a;
}
