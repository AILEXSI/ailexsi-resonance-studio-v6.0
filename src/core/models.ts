import type { Transition } from "./transition";
import type { VisualizerSceneId } from "./visualz/scene-catalog";

export type MediaKind = "video" | "audio" | "image";
/** Stable track identity. Legacy A1/A2 keep those ids; new audio tracks use `a_*`. */
export type TrackId = string;
export const VIDEO_TRACK_IDS = ["V1", "V2"] as const;
export type VideoTrackId = (typeof VIDEO_TRACK_IDS)[number];
/** Default project lanes. Not a capacity cap — extra audio tracks live on the collection. */
export const DEFAULT_TRACK_IDS: TrackId[] = ["V1", "V2", "A1", "A2"];
/** @deprecated Use trackIdsOf(project). Kept as the empty-project / legacy four-lane list. */
export const TRACK_IDS: TrackId[] = DEFAULT_TRACK_IDS;
export const MAX_AUDIO_TRACKS = 64;
export const MIN_AUDIO_TRACKS = 2;

/**
 * Visualz Canvas-2D builtin scene ids. Cycle order and names come from
 * SCENE_CATALOG — do not maintain a second id list.
 * Unused ids (do not implement): silk-ribbons, orbit-rings, mist-mirror, prismatic-cut, ash-drift, pulse-lattice.
 */
export {
  VISUALIZER_SCENE_IDS,
  isVisualizerSceneId,
} from "./visualz/scene-catalog";
export type { VisualizerSceneId } from "./visualz/scene-catalog";

/** Visualz signature scene. New projects and missing-visualizer loads use this. */
export const DEFAULT_VISUALIZER_SCENE_ID: VisualizerSceneId = "resonance-wave";

export interface VisualizerEvent {
  id: string;
  sceneId: VisualizerSceneId;
  startMs: number;
  durationMs: number;
  /** Clip-local opacity. Missing = fully opaque. */
  opacityKeys?: VolumeAutomation;
}

/** In-song mode change. Last cue with startMs <= t wins until the next cue. */
export interface VisualizerCue {
  startMs: number;
  sceneId: VisualizerSceneId;
}

export interface VisualizerState {
  enabled: boolean;
  muted: boolean;
  sceneId: VisualizerSceneId;
  /** Overlay from-to on the timeline. durationMs <= 0 = whole timeline. Not a TrackId. */
  startMs?: number;
  durationMs?: number;
  /** Scene clips on the VIS lane. Empty = use sceneId + window. Not TrackId clips. */
  events?: VisualizerEvent[];
  /** Playhead VIS-button cues. Empty = sceneId (+ events if present). */
  cues?: VisualizerCue[];
}

export function defaultVisualizer(): VisualizerState {
  return {
    enabled: true,
    muted: false,
    sceneId: DEFAULT_VISUALIZER_SCENE_ID,
    startMs: 0,
    durationMs: 0,
    events: [],
    cues: [],
  };
}

export type FrontVideoTrackId = "V1" | "V2";

export function isFrontVideoTrackId(value: unknown): value is FrontVideoTrackId {
  return value === "V1" || value === "V2";
}

export function isVideoTrackId(value: unknown): value is VideoTrackId {
  return value === "V1" || value === "V2";
}

export function kindOfTrack(id: TrackId): "video" | "audio" {
  return isVideoTrackId(id) ? "video" : "audio";
}

/** Picture assets sit on V1/V2. Images have no audio. */
export function isPictureKind(kind: MediaKind): boolean {
  return kind === "video" || kind === "image";
}

/** VIS is not a TrackId. Accepts V1/V2, legacy A1/A2, A3+, and generated `a_*` ids. */
export function isTrackId(value: string): value is TrackId {
  if (!value || value === "VIS" || value === "master") return false;
  if (isVideoTrackId(value)) return true;
  if (/^A[1-9]\d*$/.test(value)) return true;
  if (/^a_[A-Za-z0-9-]+$/.test(value)) return true;
  return false;
}

export function audioTrackLabel(index: number): string {
  return `A${Math.max(1, index + 1)}`;
}

export function trackIdsOf(project: Pick<Project, "tracks">): TrackId[] {
  return orderedTracks(project).map((t) => t.id);
}

export function orderedTracks(project: Pick<Project, "tracks">): Track[] {
  return [...project.tracks].sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    const ia = TRACK_IDS.indexOf(a.id);
    const ib = TRACK_IDS.indexOf(b.id);
    if (ia >= 0 && ib >= 0) return ia - ib;
    if (ia >= 0) return -1;
    if (ib >= 0) return 1;
    return a.id.localeCompare(b.id);
  });
}

export function videoTracksOf(project: Pick<Project, "tracks">): Track[] {
  return orderedTracks(project).filter((t) => t.kind === "video");
}

export function audioTracksOf(project: Pick<Project, "tracks">): Track[] {
  return orderedTracks(project).filter((t) => t.kind === "audio");
}

export function audioTrackIdsOf(project: Pick<Project, "tracks">): TrackId[] {
  return audioTracksOf(project).map((t) => t.id);
}

export function trackById(project: Pick<Project, "tracks">, id: TrackId): Track | undefined {
  return project.tracks.find((t) => t.id === id);
}

/** First audible audio-lane clip at t, else undefined. Default projects: A1 first. */
export function analysisAudioClipAt(project: Project, timeMs: number): Clip | undefined {
  for (const track of audioTracksOf(project)) {
    if (!isTrackAudible(project, track.id)) continue;
    const clip = clipOnTrackAt(project, track.id, timeMs);
    if (clip) return clip;
  }
  return undefined;
}

export interface MediaAsset {
  id: string;
  name: string;
  kind: MediaKind;
  mimeType: string;
  durationMs: number;
  /** Durable IndexedDB key. Never a blob: URL. */
  blobId: string;
  /** Session-only object URL. Not a durable identity. */
  objectUrl?: string;
  /** Optional disk path (exe). Absent = IDB-only hydrate. */
  sourcePath?: string;
  missing: boolean;
  width?: number;
  height?: number;
  /** True when a video file also has decodable audio. Missing on legacy assets. */
  hasAudio?: boolean;
}

export interface Clip {
  id: string;
  assetId: string;
  trackId: TrackId;
  startMs: number;
  durationMs: number;
  sourceInMs: number;
  sourceOutMs: number;
  gain: number;
  /** Linear fade-in length. 0 = none. Clamped to duration; scaled if fadeIn+fadeOut would overlap. */
  fadeInMs: number;
  /** Linear fade-out length. 0 = none. */
  fadeOutMs: number;
  /** Playback rate. 1 = unity. Source window stays; durationMs = (sourceOut-sourceIn) / rate. */
  rate: number;
  /** Play the source window backward. Missing = forward. */
  reversed?: boolean;
  /** When set, every output frame samples this source time (freeze). Missing = normal playback. */
  holdSourceMs?: number;
  /** Clip-local volume keys. Missing or empty = the static gain. */
  gainKeys?: VolumeAutomation;
  /** Clip-local opacity keys. Missing or empty = the fade only. */
  opacityKeys?: VolumeAutomation;
  /** Shared id for a linked A/V pair. Missing = unlinked (legacy). */
  linkId?: string;
  /** False = skip picture and mix. Missing = enabled. */
  enabled?: boolean;
  /**
   * True = skip move, trim, slip, rate, roll/slide/ripple-trim-of-mate,
   * relocate-duplicate, drag, relink shrink of duration/sourceOut,
   * ripple-delete packing through a locked later clip, G when the next
   * clip that would close the playhead gap is locked, and delete of an
   * unselected locked mate. A selected locked clip still deletes.
   * Missing = unlocked (same pattern as enabled).
   * Independent of linkId — locking one side of an A/V pair does not lock the mate.
   */
  locked?: boolean;
}

export function clipIsEnabled(clip: { enabled?: boolean }): boolean {
  return clip.enabled !== false;
}

export function clipIsLocked(clip: { locked?: boolean }): boolean {
  return clip.locked === true;
}

/** Legacy D stub. G persists `Track.volumeAutomation`; this remains for old JSON. */
export interface AutomationLane {
  id: string;
  kind: "volume";
  points?: { timeMs: number; value: number }[];
}

/** G — track-owned volume envelope. Linear values (1 = 0 dB). Missing = identity. */
export interface VolumeAutomation {
  enabled: boolean;
  points: { timeMs: number; value: number }[];
}

export interface Track {
  id: TrackId;
  kind: "video" | "audio";
  name: string;
  /** Visible/order index. Video V1=0, V2=1; audio follows. */
  order: number;
  muted: boolean;
  /** When any track is soloed, only soloed tracks are audible. Mute still wins. */
  solo: boolean;
  /** Linear / static track fader. 1 = 0 dB unity. 0 = silence. Not clip gain, not automation. */
  volume: number;
  /** Stereo pan. −1 = hard L, 0 = center, +1 = hard R. Master has no pan. */
  pan: number;
  /**
   * Optional chapter/group membership (F). Same id as `Project.groups[].id`.
   * Collapse is UI-only — this field does not change mute/solo/volume/routing.
   */
  groupId?: string;
  /**
   * Optional volume envelope (G). Track-owned, not clip-owned.
   * Missing / disabled / empty points = static volume only (prior behavior).
   */
  volumeAutomation?: VolumeAutomation;
  /** Legacy D stub. Prefer `volumeAutomation`. Kept so old JSON still loads. */
  automationLanes?: AutomationLane[];
}

/** Chapter/track folder. Contains audio tracks via `Track.groupId`. No bus / no DSP. */
export interface TrackGroup {
  id: string;
  name: string;
}

export interface Marker {
  id: string;
  timeMs: number;
  label: string;
}

export interface Project {
  schemaVersion: 5;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  assets: MediaAsset[];
  tracks: Track[];
  /**
   * Chapter/track groups (F). Missing on legacy JSON → `[]`.
   * Membership stays on `Track.groupId` so stem-import prefixes still load.
   */
  groups?: TrackGroup[];
  clips: Clip[];
  markers: Marker[];
  /** Edit-point objects. Missing/empty = hard cuts. Not React state. */
  transitions: Transition[];
  playheadMs: number;
  inPointMs: number | null;
  outPointMs: number | null;
  loop: boolean;
  snap: boolean;
  zoomPxPerSec: number;
  scrollMs: number;
  visualizer: VisualizerState;
  /** Which video track covers on overlap. Default V2 (later-on-top). */
  frontVideoTrackId: FrontVideoTrackId;
  /** Linear master fader. 1 = 0 dB unity. */
  masterVolume: number;
}

export const CLIP_RATE_MIN = 0.25;
export const CLIP_RATE_MAX = 4;

export function clampClipRate(rate: number): number {
  if (!Number.isFinite(rate) || rate <= 0) return 1;
  return Math.max(CLIP_RATE_MIN, Math.min(CLIP_RATE_MAX, rate));
}

export function clipRateOf(clip: { rate?: number }): number {
  return clampClipRate(clip.rate ?? 1);
}

/** Timeline delta → source delta. Rate 1 is identity. */
export function timelineDeltaToSource(clip: { rate?: number }, deltaTimelineMs: number): number {
  return clipRateOf(clip) * deltaTimelineMs;
}

/** Source delta → timeline delta. Rate 1 is identity. */
export function sourceDeltaToTimeline(clip: { rate?: number }, deltaSourceMs: number): number {
  return deltaSourceMs / clipRateOf(clip);
}

export function sourceSpanMs(clip: { sourceInMs: number; sourceOutMs: number }): number {
  return Math.max(1, clip.sourceOutMs - clip.sourceInMs);
}

export function timelineDurationForRate(sourceSpan: number, rate: number): number {
  return Math.max(1, sourceSpan / clampClipRate(rate));
}

export const SPLIT_EDGE_GUARD_MS = 50;
export const SNAP_THRESHOLD_MS = 80;
export const FRAME_MS = 1000 / 30;

/** mm:ss.cc (centiseconds). */
export function formatTimecode(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  const m = Math.floor(s / 60);
  const rem = s - m * 60;
  return `${String(m).padStart(2, "0")}:${rem.toFixed(2).padStart(5, "0")}`;
}

/**
 * Parse a Transport timecode. Accepts the printed `mm:ss.cc` form, `m:ss`,
 * `m:ss.cs`, `h:m:ss` (optional fraction), and a raw integer millisecond value.
 * Invalid → null (caller restores the current playhead display).
 */
export function parseTimecode(raw: string): number | null {
  const text = raw.trim();
  if (!text) return null;
  if (/^\d+$/.test(text)) {
    const ms = Number(text);
    if (!Number.isFinite(ms)) return null;
    return Math.max(0, Math.round(ms));
  }
  const parts = text.split(":");
  if (parts.length !== 2 && parts.length !== 3) return null;
  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => !Number.isFinite(n) || n < 0)) return null;
  if (parts.length === 2) {
    const [minutes, seconds] = nums as [number, number];
    if (seconds >= 60) return null;
    return Math.max(0, Math.round((minutes * 60 + seconds) * 1000));
  }
  const [hours, minutes, seconds] = nums as [number, number, number];
  if (minutes >= 60 || seconds >= 60) return null;
  return Math.max(0, Math.round((hours * 3600 + minutes * 60 + seconds) * 1000));
}

export function isTrackMuted(project: Project, trackId: TrackId): boolean {
  return project.tracks.find((t) => t.id === trackId)?.muted === true;
}

export function isTrackSoloed(project: Project, trackId: TrackId): boolean {
  return project.tracks.find((t) => t.id === trackId)?.solo === true;
}

export function anyTrackSoloed(project: Project): boolean {
  return project.tracks.some((t) => t.solo);
}

/**
 * Shared audible rule for preview and export.
 * Mute always wins. If any track is soloed, only soloed tracks are audible.
 */
export function isTrackAudible(project: Project, trackId: TrackId): boolean {
  const track = project.tracks.find((t) => t.id === trackId);
  if (!track) return false;
  if (track.muted) return false;
  if (anyTrackSoloed(project) && !track.solo) return false;
  return true;
}

export function trackVolumeOf(project: Project, trackId: TrackId): number {
  const v = project.tracks.find((t) => t.id === trackId)?.volume;
  return v == null || !Number.isFinite(v) ? 1 : Math.max(0, v);
}

export function trackPanOf(project: Project, trackId: TrackId): number {
  const p = project.tracks.find((t) => t.id === trackId)?.pan;
  if (p == null || !Number.isFinite(p)) return 0;
  return Math.max(-1, Math.min(1, p));
}

export function clipEndMs(clip: Clip): number {
  return clip.startMs + clip.durationMs;
}

export function projectDurationMs(project: Project): number {
  let max = 0;
  for (const clip of project.clips) {
    max = Math.max(max, clipEndMs(clip));
  }
  for (const marker of project.markers) {
    max = Math.max(max, marker.timeMs);
  }
  if (project.outPointMs != null) max = Math.max(max, project.outPointMs);
  const vis = project.visualizer;
  if (vis) {
    const windowDur = vis.durationMs ?? 0;
    if (windowDur > 0) max = Math.max(max, (vis.startMs ?? 0) + windowDur);
    for (const event of vis.events ?? []) {
      max = Math.max(max, event.startMs + Math.max(0, event.durationMs));
    }
  }
  return max;
}

export function defaultTracks(): Track[] {
  return [
    { id: "V1", kind: "video", name: "V1", order: 0, muted: false, solo: false, volume: 1, pan: 0, automationLanes: [] },
    { id: "V2", kind: "video", name: "V2", order: 1, muted: false, solo: false, volume: 1, pan: 0, automationLanes: [] },
    { id: "A1", kind: "audio", name: "A1", order: 2, muted: false, solo: false, volume: 1, pan: 0, automationLanes: [] },
    { id: "A2", kind: "audio", name: "A2", order: 3, muted: false, solo: false, volume: 1, pan: 0, automationLanes: [] },
  ];
}

export function assetById(project: Project, id: string): MediaAsset | undefined {
  return project.assets.find((a) => a.id === id);
}

export function clipById(project: Project, id: string): Clip | undefined {
  return project.clips.find((c) => c.id === id);
}

export function clipsOnTrack(project: Project, trackId: TrackId): Clip[] {
  return project.clips.filter((c) => c.trackId === trackId);
}

export function topVideoClipAt(project: Project, timeMs: number): Clip | undefined {
  const hits = project.clips.filter(
    (c) =>
      clipIsEnabled(c) &&
      kindOfTrack(c.trackId) === "video" &&
      timeMs >= c.startMs &&
      timeMs < clipEndMs(c),
  );
  const front = project.frontVideoTrackId === "V1" ? "V1" : "V2";
  return hits.find((c) => c.trackId === front) ?? hits.find((c) => c.trackId === "V1" || c.trackId === "V2");
}

export function audioClipsAt(project: Project, timeMs: number): Clip[] {
  return project.clips.filter(
    (c) =>
      clipIsEnabled(c) &&
      kindOfTrack(c.trackId) === "audio" &&
      isTrackAudible(project, c.trackId) &&
      timeMs >= c.startMs &&
      timeMs < clipEndMs(c),
  );
}

export function clipOnTrackAt(project: Project, trackId: TrackId, timeMs: number): Clip | undefined {
  return project.clips.find(
    (c) =>
      clipIsEnabled(c) &&
      c.trackId === trackId &&
      timeMs >= c.startMs &&
      timeMs < clipEndMs(c),
  );
}

/** Audible clips on every project track under the playhead (picture + mix). Stills have no audio. */
export function mixClipsAt(project: Project, timeMs: number): Clip[] {
  return trackIdsOf(project).flatMap((id) => {
    if (!isTrackAudible(project, id)) return [];
    const clip = clipOnTrackAt(project, id, timeMs);
    if (!clip) return [];
    const asset = assetById(project, clip.assetId);
    if (asset?.kind === "image") return [];
    return [clip];
  });
}

/**
 * Timeline has mixable A/V clips (not stills). A playhead gap does not clear this —
 * VIS must stay quiet there instead of falling back to the 120 BPM metronome.
 */
export function projectHasMixAudio(project: Project): boolean {
  return project.clips.some((c) => {
    if (!clipIsEnabled(c) || !project.tracks.some((t) => t.id === c.trackId)) return false;
    const asset = assetById(project, c.assetId);
    if (asset?.kind === "image") return false;
    if (asset?.kind === "video" && asset.hasAudio === false) return false;
    return true;
  });
}

export function sourceTimeAt(
  clip: {
    startMs: number;
    sourceInMs: number;
    sourceOutMs: number;
    rate?: number;
    reversed?: boolean;
    holdSourceMs?: number;
  },
  timelineMs: number,
): number {
  if (clip.holdSourceMs != null && Number.isFinite(clip.holdSourceMs)) return clip.holdSourceMs;
  const offset = Math.max(0, timelineMs - clip.startMs);
  const rate = clipRateOf(clip);
  if (clip.reversed) return clip.sourceOutMs - offset * rate;
  return clip.sourceInMs + offset * rate;
}
