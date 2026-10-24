import { createId } from "./ids";
import { presentClipKeys } from "./clip-keys";
import { normalizeClipFades } from "./fades";
import { sanitizeTransitions } from "./transition";
import { ZOOM_MAX_PX_PER_SEC } from "./zoom";
import { ensureAudioTracksForIds, sanitizeAutomationLanes } from "./audio-tracks";
import { resolveVolumeAutomation } from "./volume-automation";
import { sanitizeTrackGroups, syncTrackGroups } from "./track-groups";
import {
  MAX_AUDIO_TRACKS,
  clampClipRate,
  defaultTracks,
  defaultVisualizer,
  isTrackId,
  isVideoTrackId,
  isVisualizerSceneId,
  type Clip,
  type MediaAsset,
  type MediaKind,
  type Project,
  type Track,
  type VisualizerCue,
  type VisualizerEvent,
  type VisualizerState,
} from "./models";
import { roundVisMs } from "./visualizer";

export const PROJECT_SCHEMA_VERSION = 5;
export const PROJECT_FILE_SUFFIX = ".resonance.json";

export const DEFAULT_PROJECT_NAME = "Untitled Resonance";

export function createEmptyProject(name = DEFAULT_PROJECT_NAME): Project {
  const now = new Date().toISOString();
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: createId("proj"),
    name,
    createdAt: now,
    updatedAt: now,
    assets: [],
    tracks: defaultTracks(),
    groups: [],
    clips: [],
    markers: [],
    transitions: [],
    playheadMs: 0,
    inPointMs: null,
    outPointMs: null,
    loop: false,
    snap: true,
    zoomPxPerSec: 80,
    scrollMs: 0,
    visualizer: defaultVisualizer(),
    frontVideoTrackId: "V2",
    masterVolume: 1,
  };
}

export function touch(project: Project, patch: Partial<Project> = {}): Project {
  return { ...project, ...patch, updatedAt: new Date().toISOString() };
}

/** Same `Project.name` field that serialize/deserialize already require. */
export function renameProject(project: Project, name: string): Project {
  const next = name.trim() || DEFAULT_PROJECT_NAME;
  if (next === project.name) return project;
  return { ...project, name: next, updatedAt: new Date().toISOString() };
}

export function windowTitleFor(name: string): string {
  const n = name.trim() || DEFAULT_PROJECT_NAME;
  return `${n} — Resonance Studio`;
}

function isMediaKind(value: unknown): value is MediaKind {
  return value === "video" || value === "audio" || value === "image";
}

function sanitizeAsset(raw: unknown): MediaAsset | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  if (typeof a.id !== "string" || typeof a.name !== "string") return null;
  if (!isMediaKind(a.kind)) return null;
  const blobId = typeof a.blobId === "string" && !a.blobId.startsWith("blob:")
    ? a.blobId
    : a.id;
  const missingFlag = a.missing === true;
  const objectUrl = typeof a.objectUrl === "string" ? a.objectUrl : undefined;
  const looksMissing =
    missingFlag ||
    (typeof a.objectUrl === "string" && a.objectUrl.startsWith("missing:")) ||
    blobId.startsWith("missing:");
  return {
    id: a.id,
    name: a.name.startsWith("missing:") ? a.name.slice("missing:".length) : a.name,
    kind: a.kind,
    mimeType: typeof a.mimeType === "string" ? a.mimeType : "",
    durationMs: Number(a.durationMs) || 0,
    blobId,
    objectUrl: looksMissing ? undefined : objectUrl,
    sourcePath: typeof a.sourcePath === "string" && a.sourcePath.length > 0 ? a.sourcePath : undefined,
    missing: looksMissing,
    width: typeof a.width === "number" ? a.width : undefined,
    height: typeof a.height === "number" ? a.height : undefined,
    hasAudio: typeof a.hasAudio === "boolean" ? a.hasAudio : undefined,
  };
}

function sanitizeClip(raw: unknown): Clip | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  if (typeof c.id !== "string" || typeof c.assetId !== "string") return null;
  if (typeof c.trackId !== "string" || !isTrackId(c.trackId)) return null;
  const startMs = Math.max(0, Number(c.startMs) || 0);
  const durationMs = Math.max(1, Number(c.durationMs) || 0);
  const sourceInMs = Math.max(0, Number(c.sourceInMs) || 0);
  const sourceOutMs = Math.max(sourceInMs + 1, Number(c.sourceOutMs) || sourceInMs + durationMs);
  const fades = normalizeClipFades(
    c.fadeInMs == null ? 0 : Number(c.fadeInMs),
    c.fadeOutMs == null ? 0 : Number(c.fadeOutMs),
    durationMs,
  );
  return {
    id: c.id,
    assetId: c.assetId,
    trackId: c.trackId,
    startMs,
    durationMs,
    sourceInMs,
    sourceOutMs,
    gain: Math.max(0, Number(c.gain) || 1),
    fadeInMs: fades.fadeInMs,
    fadeOutMs: fades.fadeOutMs,
    rate: c.rate == null ? 1 : clampClipRate(Number(c.rate)),
    linkId: typeof c.linkId === "string" && c.linkId.length > 0 ? c.linkId : undefined,
    enabled: c.enabled === false ? false : undefined,
    locked: c.locked === true ? true : undefined,
    reversed: c.reversed === true ? true : undefined,
    holdSourceMs:
      typeof c.holdSourceMs === "number" && Number.isFinite(c.holdSourceMs) ? c.holdSourceMs : undefined,
    ...(presentClipKeys(c.gainKeys) ? { gainKeys: presentClipKeys(c.gainKeys) } : {}),
    ...(presentClipKeys(c.opacityKeys) ? { opacityKeys: presentClipKeys(c.opacityKeys) } : {}),
  };
}

function mergeTrack(base: Track, found: Record<string, unknown> | undefined): Track {
  if (!found) return base;
  const vol = Number(found.volume);
  const pan = Number(found.pan);
  const order = Number(found.order);
  const name = typeof found.name === "string" && found.name.trim() ? found.name.trim() : base.name;
  return {
    ...base,
    name,
    muted: Boolean(found.muted),
    solo: found.solo === true,
    volume: Number.isFinite(vol) ? Math.max(0, Math.min(2, vol)) : 1,
    pan: Number.isFinite(pan) ? Math.max(-1, Math.min(1, pan)) : 0,
    order: Number.isFinite(order) ? order : base.order,
    groupId: typeof found.groupId === "string" && found.groupId.length > 0 ? found.groupId : undefined,
    volumeAutomation: resolveVolumeAutomation(found.volumeAutomation, found.automationLanes),
    automationLanes: sanitizeAutomationLanes(found.automationLanes),
  };
}

function sanitizeTracks(raw: unknown): Track[] {
  const defaults = defaultTracks();
  if (!Array.isArray(raw)) return defaults;
  const byId = new Map<string, Record<string, unknown>>();
  const extras: Record<string, unknown>[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec.id !== "string" || rec.id.length === 0 || rec.id === "VIS") continue;
    if (rec.id === "V1" || rec.id === "V2" || rec.id === "A1" || rec.id === "A2") {
      byId.set(rec.id, rec);
      continue;
    }
    if (isVideoTrackId(rec.id)) {
      byId.set(rec.id, rec);
      continue;
    }
    if (rec.kind === "audio" || isTrackId(rec.id)) extras.push(rec);
  }
  const core = defaults.map((track) => mergeTrack(track, byId.get(track.id)));
  const extraTracks: Track[] = [];
  let audioCount = core.filter((t) => t.kind === "audio").length;
  for (const rec of extras) {
    if (audioCount >= MAX_AUDIO_TRACKS) break;
    const id = rec.id as string;
    if (!isTrackId(id) || isVideoTrackId(id) || core.some((t) => t.id === id)) continue;
    if (extraTracks.some((t) => t.id === id)) continue;
    extraTracks.push(
      mergeTrack(
        {
          id,
          kind: "audio",
          name: typeof rec.name === "string" && rec.name.trim() ? rec.name.trim() : `A${audioCount + 1}`,
          order: core.length + extraTracks.length,
          muted: false,
          solo: false,
          volume: 1,
          pan: 0,
          automationLanes: [],
        },
        rec,
      ),
    );
    audioCount += 1;
  }
  return [...core, ...extraTracks];
}

function sanitizeVisualizerEvent(raw: unknown): VisualizerEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  if (typeof rec.id !== "string" || rec.id.length === 0) return null;
  if (typeof rec.sceneId !== "string" || !isVisualizerSceneId(rec.sceneId)) return null;
  if (typeof rec.startMs !== "number" || !Number.isFinite(rec.startMs)) return null;
  if (typeof rec.durationMs !== "number" || !Number.isFinite(rec.durationMs)) return null;
  const opacityKeys = presentClipKeys(rec.opacityKeys);
  return {
    id: rec.id,
    sceneId: rec.sceneId,
    startMs: Math.max(0, roundVisMs(rec.startMs)),
    durationMs: Math.max(1, roundVisMs(rec.durationMs)),
    ...(opacityKeys ? { opacityKeys } : {}),
  };
}

function sanitizeVisualizerCue(raw: unknown): VisualizerCue | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  if (typeof rec.sceneId !== "string" || !isVisualizerSceneId(rec.sceneId)) return null;
  if (typeof rec.startMs !== "number" || !Number.isFinite(rec.startMs)) return null;
  return {
    startMs: Math.max(0, roundVisMs(rec.startMs)),
    sceneId: rec.sceneId,
  };
}

function sanitizeVisualizer(raw: unknown): VisualizerState {
  const fallback = defaultVisualizer();
  if (!raw || typeof raw !== "object") return fallback;
  const v = raw as Record<string, unknown>;
  const events = Array.isArray(v.events)
    ? v.events.map((item) => sanitizeVisualizerEvent(item)).filter((item): item is VisualizerEvent => item !== null)
    : [];
  const cues = Array.isArray(v.cues)
    ? v.cues.map((item) => sanitizeVisualizerCue(item)).filter((item): item is VisualizerCue => item !== null)
    : [];
  return {
    enabled: v.enabled !== false,
    muted: v.muted === true,
    sceneId: isVisualizerSceneId(v.sceneId) ? v.sceneId : fallback.sceneId,
    startMs: Math.max(0, roundVisMs(Number(v.startMs) || 0)),
    durationMs: Math.max(0, roundVisMs(Number(v.durationMs) || 0)),
    events,
    cues,
  };
}

export class ProjectFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectFormatError";
  }
}

/** Strip session-only blob URLs. Keep sourcePath. They are not durable ids. */
export function serializeProject(project: Project): string {
  const durable: Project = {
    ...project,
    assets: project.assets.map((asset) => ({
      ...asset,
      objectUrl: undefined,
      missing: true,
      name: asset.name,
      sourcePath: asset.sourcePath,
    })),
    updatedAt: new Date().toISOString(),
  };
  return `${JSON.stringify(durable, null, 2)}\n`;
}

export function deserializeProject(text: string): Project {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ProjectFormatError("File is not valid JSON");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new ProjectFormatError("Project root must be an object");
  }
  const raw = parsed as Record<string, unknown>;
  if (raw.schemaVersion !== PROJECT_SCHEMA_VERSION) {
    throw new ProjectFormatError(
      `Unsupported schemaVersion ${String(raw.schemaVersion)} (need ${PROJECT_SCHEMA_VERSION})`,
    );
  }
  if (typeof raw.id !== "string" || typeof raw.name !== "string") {
    throw new ProjectFormatError("Project id and name are required");
  }
  const assets = Array.isArray(raw.assets)
    ? raw.assets.map(sanitizeAsset).filter((a): a is MediaAsset => a != null)
    : [];
  const clips = Array.isArray(raw.clips)
    ? raw.clips.map(sanitizeClip).filter((c): c is Clip => c != null)
    : [];
  const tracks = ensureAudioTracksForIds(
    sanitizeTracks(raw.tracks),
    clips.map((c) => c.trackId),
  );
  const knownTracks = new Set(tracks.map((t) => t.id));
  const keptClips = clips.filter((c) => knownTracks.has(c.trackId));
  const base = createEmptyProject(raw.name);
  return {
    ...base,
    id: raw.id,
    name: raw.name,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : base.createdAt,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : base.updatedAt,
    assets,
    tracks,
    groups: syncTrackGroups({ ...base, tracks, groups: sanitizeTrackGroups(raw.groups) }).groups,
    clips: keptClips,
    transitions: sanitizeTransitions(raw.transitions),
    markers: Array.isArray(raw.markers)
      ? raw.markers
          .filter((m) => m && typeof m === "object")
          .map((m) => {
            const mk = m as Record<string, unknown>;
            return {
              id: typeof mk.id === "string" ? mk.id : createId("mk"),
              timeMs: Math.max(0, Number(mk.timeMs) || 0),
              label: typeof mk.label === "string" ? mk.label : "M",
            };
          })
      : [],
    playheadMs: Math.max(0, Number(raw.playheadMs) || 0),
    inPointMs: raw.inPointMs == null ? null : Math.max(0, Number(raw.inPointMs)),
    outPointMs: raw.outPointMs == null ? null : Math.max(0, Number(raw.outPointMs)),
    loop: Boolean(raw.loop),
    snap: raw.snap !== false,
    zoomPxPerSec: Math.max(0.05, Math.min(ZOOM_MAX_PX_PER_SEC, Number(raw.zoomPxPerSec) || 80)),
    scrollMs: Math.max(0, Number(raw.scrollMs) || 0),
    visualizer: sanitizeVisualizer(raw.visualizer),
    frontVideoTrackId: raw.frontVideoTrackId === "V1" ? "V1" : "V2",
    masterVolume: (() => {
      const v = Number(raw.masterVolume);
      return Number.isFinite(v) ? Math.max(0, Math.min(2, v)) : 1;
    })(),
  };
}

export function downloadText(filename: string, text: string, mime = "application/json"): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function projectFilename(project: Project): string {
  const safe = project.name.replace(/[^\w\-]+/g, "_") || "untitled";
  return `${safe}${PROJECT_FILE_SUFFIX}`;
}
