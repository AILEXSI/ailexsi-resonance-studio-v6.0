import { createId } from "../../../core/ids";
import {
  analysisAudioClipAt,
  assetById,
  clipById,
  clipIsLocked,
  projectDurationMs,
  type Project,
} from "../../../core/models";
import { volumeAutomationOf } from "../../../core/volume-automation";
import { selectionOf, type Session } from "../../session";
import {
  SEND_RAW_MEDIA,
  type AIContextSnapshot,
  type ContextAnalysisHint,
  type ContextClipStructure,
  type ContextLevel,
  type ContextMediaMetadata,
  type ContextProjectSummary,
  type OutboundClass,
} from "./types";

/** Local playhead cache. Never triggers provider traffic. */
let playheadCacheMs: number | null = null;

export function cachePlayheadMs(ms: number): void {
  if (!Number.isFinite(ms)) return;
  playheadCacheMs = Math.max(0, Math.round(ms));
}

export function readPlayheadCacheMs(): number | null {
  return playheadCacheMs;
}

export function clearPlayheadCache(): void {
  playheadCacheMs = null;
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    if (child && typeof child === "object" && !Object.isFrozen(child)) deepFreeze(child);
  }
  return value;
}

function basename(name: string): string {
  const parts = name.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || name;
}

function assertOutbound(outboundClass: string): OutboundClass {
  if (outboundClass === SEND_RAW_MEDIA) {
    throw new Error("SEND_RAW_MEDIA is forbidden");
  }
  return outboundClass as OutboundClass;
}

export interface CaptureContextOptions {
  level?: ContextLevel;
  outboundClass?: OutboundClass | typeof SEND_RAW_MEDIA;
  /** CUSTOM: explicit clip ids (stable ids only). */
  clipIds?: readonly string[];
}

/**
 * Immutable snapshot captured on intentional submit.
 * Reuses selectionOf / clipById / projectDurationMs / analysisAudioClipAt / volumeAutomationOf.
 * Never includes sourcePath, objectUrl, PCM, frames, blobs, or waveforms.
 */
export function captureContextSnapshot(
  session: Session,
  opts: CaptureContextOptions = {},
): AIContextSnapshot {
  const level = opts.level ?? "SELECTION";
  const outboundClass = assertOutbound(opts.outboundClass ?? "SEND_STRUCTURE");
  const project = session.project;
  const selected = selectionOf(session);
  const clipIds =
    level === "NONE"
      ? []
      : opts.clipIds && (level === "CUSTOM" || level === "SELECTION")
        ? [...opts.clipIds]
        : selected;
  const trackIds = resolveTrackIds(session, level, clipIds);

  let projectSummary: ContextProjectSummary | undefined;
  let structure: ContextClipStructure[] | undefined;
  let analysisHint: ContextAnalysisHint | undefined;
  let mediaMetadata: ContextMediaMetadata[] | undefined;

  if (level !== "NONE" && outboundClass !== "SEND_NONE") {
    if (
      outboundClass === "SEND_STRUCTURE" ||
      outboundClass === "SEND_ANALYSIS" ||
      outboundClass === "SEND_MEDIA_METADATA" ||
      outboundClass === "SEND_IDS"
    ) {
      if (outboundClass !== "SEND_IDS") {
        projectSummary = {
          name: project.name,
          durationMs: projectDurationMs(project),
          clipCount: project.clips.length,
          trackCount: project.tracks.length,
        };
      }
    }
    if (outboundClass === "SEND_STRUCTURE" || outboundClass === "SEND_ANALYSIS") {
      const ids =
        level === "PROJECT"
          ? project.clips.map((c) => c.id)
          : level === "PLAYHEAD"
            ? playheadClipIds(project)
            : clipIds;
      structure = ids
        .map((id) => clipById(project, id))
        .filter((c): c is NonNullable<typeof c> => Boolean(c))
        .map((c) => ({
          clipId: c.id,
          trackId: c.trackId,
          startMs: c.startMs,
          durationMs: c.durationMs,
          locked: clipIsLocked(c),
        }));
    }
    if (outboundClass === "SEND_ANALYSIS" || level === "PLAYHEAD") {
      const hit = analysisAudioClipAt(project, project.playheadMs);
      analysisHint = { clipId: hit?.id ?? null, timeMs: project.playheadMs };
    }
    if (outboundClass === "SEND_MEDIA_METADATA") {
      mediaMetadata = mediaMetadataOf(project, clipIds);
    }
  }

  const snapshot: AIContextSnapshot = {
    id: createId("ctx"),
    projectId: project.id,
    selection: {
      clipIds: [...clipIds],
      primaryClipId: level === "NONE" ? null : (session.selectedClipId ?? clipIds[0] ?? null),
      trackIds: [...new Set(trackIds)],
    },
    playheadMs: project.playheadMs,
    activeTrack: session.targetTrackId,
    projectSummary,
    analysisHint,
    structure,
    mediaMetadata,
    createdAt: Date.now(),
    level,
    outboundClass,
  };

  return deepFreeze(snapshot);
}

function resolveTrackIds(session: Session, level: ContextLevel, clipIds: readonly string[]): string[] {
  if (level === "NONE") return [];
  if (level === "TRACK" || level === "PROJECT") {
    return session.selectedTrackIds.length ? [...session.selectedTrackIds] : [session.targetTrackId];
  }
  return clipIds
    .map((id) => clipById(session.project, id)?.trackId)
    .filter((id): id is string => Boolean(id));
}

function playheadClipIds(project: Project): string[] {
  const t = project.playheadMs;
  return project.clips.filter((c) => t >= c.startMs && t < c.startMs + c.durationMs).map((c) => c.id);
}

function mediaMetadataOf(project: Project, clipIds: readonly string[]): ContextMediaMetadata[] {
  const assets = new Map<string, ContextMediaMetadata>();
  for (const id of clipIds) {
    const clip = clipById(project, id);
    if (!clip) continue;
    const asset = assetById(project, clip.assetId);
    if (!asset) continue;
    assets.set(asset.id, {
      assetId: asset.id,
      filename: basename(asset.name),
      mimeType: asset.mimeType,
      durationMs: asset.durationMs,
      missing: asset.missing,
    });
  }
  return [...assets.values()];
}

/** TRACK-level helper: envelope exists? Does not copy point values or media. */
export function trackAutomationHint(session: Session, trackId: string): { enabled: boolean; pointCount: number } {
  const track = session.project.tracks.find((t) => t.id === trackId);
  const env = volumeAutomationOf(track);
  return { enabled: env.enabled, pointCount: env.points.length };
}

export function snapshotContainsForbidden(snapshot: AIContextSnapshot): boolean {
  const raw = JSON.stringify(snapshot);
  return /sourcePath|objectUrl|"blob:"|pcm|waveform|spectrum/i.test(raw);
}
