import { remapClipKeys } from "../clip-keys";
import { remapClipFadesForWindow } from "../fades";
import { createId } from "../ids";
import {
  TRACK_IDS,
  clipEndMs,
  isTrackAudible,
  kindOfTrack,
  sourceTimeAt,
  type Project,
} from "../models";
import { vClipMixesOwnAudio } from "../link";
import { clampPan, mixLinearGain } from "../volume";
import {
  automationValueAt,
  remapVolumeAutomation,
  volumeAutomationIsActive,
  volumeAutomationOf,
} from "../volume-automation";
import { isPlayableSource } from "./media";
import { exportRangeMs } from "../timeline";
import {
  compositeVideoAt,
  contextFromExportClips,
  primaryLayer,
  resolvePictureSource,
  transitionSourcesIn,
  type CompositeVis,
} from "../transition";
import type { ExportClip, ExportJob, ExportTrack } from "./types";

export class ExportPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExportPlanError";
  }
}

export interface JobOptions {
  width?: number;
  height?: number;
  fps?: number;
  fileName?: string;
}

export function jobFromProject(project: Project, opts: JobOptions = {}): ExportJob {
  const { startMs, endMs } = exportRangeMs(project);
  if (endMs <= startMs) {
    throw new ExportPlanError("Export range is empty (IN >= OUT or no clips)");
  }
  const assets = new Map(project.assets.map((a) => [a.id, a]));
  const tracks: ExportTrack[] = project.tracks.map((track) => {
    const audible = isTrackAudible(project, track.id);
    const keepPicture = kindOfTrack(track.id) === "video";
    if (!audible && !keepPicture) {
      return {
        id: track.id,
        kind: track.kind,
        pan: clampPan(track.pan ?? 0),
        muted: track.muted === true,
        solo: track.solo === true,
        volume: track.volume ?? 1,
        clips: [],
      };
    }
    const clips: ExportClip[] = project.clips
      .filter((c) => c.trackId === track.id && c.enabled !== false)
      .filter((c) => clipEndMs(c) > startMs && c.startMs < endMs)
      .map((c) => {
        const asset = assets.get(c.assetId);
        const visibleStart = Math.max(c.startMs, startMs);
        const visibleEnd = Math.min(clipEndMs(c), endMs);
        const fades = remapClipFadesForWindow(
          c.fadeInMs ?? 0,
          c.fadeOutMs ?? 0,
          c.durationMs,
          visibleStart - c.startMs,
          visibleEnd - visibleStart,
        );
        return {
          id: c.id,
          trackId: c.trackId,
          kind: kindOfTrack(c.trackId),
          startMs: visibleStart - startMs,
          endMs: visibleEnd - startMs,
          sourceUrl: asset?.objectUrl && !asset.missing ? asset.objectUrl : "",
          sourceInMs: sourceTimeAt(c, visibleStart),
          sourceOutMs: sourceTimeAt(c, visibleEnd),
          gain: mixLinearGain(c.gain, track.volume ?? 1, project.masterVolume ?? 1, !audible),
          videoGain: Math.max(0, Number.isFinite(c.gain) ? c.gain : 1),
          fadeInMs: fades.fadeInMs,
          fadeOutMs: fades.fadeOutMs,
          fadeInFrom: fades.fadeInFrom,
          fadeOutTo: fades.fadeOutTo,
          rate: c.rate ?? 1,
          reversed: c.reversed === true ? true : undefined,
          holdSourceMs:
            typeof c.holdSourceMs === "number" && Number.isFinite(c.holdSourceMs)
              ? c.holdSourceMs
              : undefined,
          gainKeys: remapClipKeys(c.gainKeys, visibleStart - c.startMs, visibleEnd - visibleStart),
          opacityKeys: remapClipKeys(c.opacityKeys, visibleStart - c.startMs, visibleEnd - visibleStart),
          missing: !asset || asset.missing || !asset.objectUrl,
          label: asset?.name ?? c.id,
          linkId: c.linkId,
          still: asset?.kind === "image",
          skipMix: !vClipMixesOwnAudio(project, c),
          hasAudio: asset?.hasAudio,
        };
      });
    return {
      id: track.id,
      kind: track.kind,
      pan: clampPan(track.pan ?? 0),
      muted: track.muted === true,
      solo: track.solo === true,
      volume: track.volume ?? 1,
      clips,
      volumeAutomation: remapVolumeAutomation(volumeAutomationOf(track), startMs),
    };
  });

  const hasClips = tracks.some((t) => t.clips.length > 0);
  const visOnly = project.visualizer.enabled && !project.visualizer.muted;
  if (!hasClips && !visOnly) {
    throw new ExportPlanError("Nothing to export in the IN/OUT range");
  }

  const safe = (opts.fileName || project.name || "resonance").replace(/[^\w\-]+/g, "_");
  const durationMs = endMs - startMs;
  const livingIds = new Set(tracks.flatMap((tr) => tr.clips.map((c) => c.id)));
  const transitions = (project.transitions ?? [])
    .filter((t) => transitionSourcesIn(t, livingIds))
    .map((t) => ({ ...t, startMs: t.startMs - startMs }))
    .filter((t) => t.durationMs > 0 && t.startMs + t.durationMs > 0 && t.startMs < durationMs);
  return {
    id: createId("job"),
    projectId: project.id,
    projectName: project.name,
    startMs,
    endMs,
    durationMs,
    width: opts.width ?? 1280,
    height: opts.height ?? 720,
    fps: opts.fps ?? 30,
    fileName: safe.endsWith(".mp4") ? safe : `${safe}.mp4`,
    tracks,
    visualizer: {
      enabled: project.visualizer.enabled,
      muted: project.visualizer.muted,
      sceneId: project.visualizer.sceneId,
      startMs: (project.visualizer.startMs ?? 0) - startMs,
      durationMs: project.visualizer.durationMs ?? 0,
      events: (project.visualizer.events ?? [])
        .map((e) => ({ ...e, startMs: e.startMs - startMs }))
        .filter((e) => e.durationMs > 0 && e.startMs + e.durationMs > 0 && e.startMs < durationMs),
    },
    transitions,
    frontVideoTrackId: project.frontVideoTrackId === "V1" ? "V1" : "V2",
  };
}

function jobVideoClips(job: ExportJob): ExportClip[] {
  return job.tracks.filter((t) => t.kind === "video").flatMap((t) => t.clips);
}

export function exportVisOf(job: ExportJob): CompositeVis {
  return {
    enabled: job.visualizer.enabled,
    muted: job.visualizer.muted,
    events: (job.visualizer.events ?? []).map((e) => ({
      startMs: e.startMs,
      durationMs: e.durationMs,
    })),
    startMs: job.visualizer.startMs ?? 0,
    durationMs: job.visualizer.durationMs ?? 0,
  };
}

export function videoClipAt(job: ExportJob, timeMs: number): ExportClip | undefined {
  const clips = jobVideoClips(job);
  const front = job.frontVideoTrackId === "V1" ? "V1" : "V2";
  const ctx = contextFromExportClips(clips, job.transitions ?? [], front, exportVisOf(job));
  const picture = resolvePictureSource(ctx, timeMs);
  if (picture.kind === "vis" || picture.kind === "black") {
    if (picture.source === "vis" || picture.source === "black") return undefined;
  }
  if (picture.clipId) {
    const chosen = clips.find((c) => c.id === picture.clipId && timeMs >= c.startMs && timeMs < c.endMs);
    if (chosen) return chosen;
  }
  const composite = compositeVideoAt(ctx, timeMs);
  const primary = primaryLayer(composite);
  if (primary) {
    const hit = clips.find(
      (c) => c.id === primary.clipId && timeMs >= c.startMs && timeMs < c.endMs,
    );
    if (hit) return hit;
  }
  if (picture.kind === "vis" || picture.kind === "black") return undefined;
  const hits = clips.filter((c) => timeMs >= c.startMs && timeMs < c.endMs);
  const preferred = hits.find((c) => c.trackId === front);
  if (preferred) return preferred;
  const order = job.tracks.map((t) => t.id);
  hits.sort((a, b) => {
    const ib = order.indexOf(b.trackId);
    const ia = order.indexOf(a.trackId);
    if (ib !== ia) return (ib < 0 ? TRACK_IDS.length : ib) - (ia < 0 ? TRACK_IDS.length : ia);
    return TRACK_IDS.indexOf(b.trackId) - TRACK_IDS.indexOf(a.trackId);
  });
  return hits[0];
}

/** Present A clips that share this V clip's linkId. */
export function presentLinkedAudioMates(job: ExportJob, clip: ExportClip): ExportClip[] {
  if (!clip.linkId) return [];
  return job.tracks
    .flatMap((t) => t.clips)
    .filter((c) => !c.missing && c.kind === "audio" && c.linkId === clip.linkId);
}

/** Job-time spans of `clip` not covered by `covers` (half-open). */
export function mixWindowsForClip(
  clip: ExportClip,
  covers: readonly ExportClip[],
): { startMs: number; endMs: number }[] {
  let segs = [{ startMs: clip.startMs, endMs: clip.endMs }];
  for (const cover of covers) {
    const next: { startMs: number; endMs: number }[] = [];
    for (const seg of segs) {
      const a = Math.max(seg.startMs, cover.startMs);
      const b = Math.min(seg.endMs, cover.endMs);
      if (a >= b) {
        next.push(seg);
        continue;
      }
      if (seg.startMs < a) next.push({ startMs: seg.startMs, endMs: a });
      if (b < seg.endMs) next.push({ startMs: b, endMs: seg.endMs });
    }
    segs = next;
  }
  return segs.filter((s) => s.endMs - s.startMs > 1);
}

function automationAudibleInRange(
  automation: ExportTrack["volumeAutomation"],
  startMs: number,
  endMs: number,
): boolean {
  if (!volumeAutomationIsActive(automation)) return true;
  const times = [startMs, endMs];
  for (const point of automation!.points) {
    if (point.timeMs >= startMs && point.timeMs <= endMs) times.push(point.timeMs);
  }
  return times.some((t) => automationValueAt(automation, t) > 0);
}

/** Job-time audible/exportable contribution. Reuses mix mute/solo/gain/skipMix semantics. */
export function clipIsExportableAudio(job: ExportJob, clip: ExportClip): boolean {
  if (clip.missing || clip.still) return false;
  if (!isPlayableSource(clip.sourceUrl)) return false;
  if (clip.endMs <= clip.startMs) return false;
  if (!(clip.gain > 0)) return false;
  if (clip.hasAudio === false) return false;
  const track = job.tracks.find((t) => t.id === clip.trackId);
  if (!automationAudibleInRange(track?.volumeAutomation, clip.startMs, clip.endMs)) return false;
  return true;
}

/**
 * Mix candidates that are present, playable, and audible after existing
 * mute/solo/volume/master/gain/fade/automation/skipMix/mate rules.
 */
export function exportableAudioClips(job: ExportJob): ExportClip[] {
  return audioClipsForMix(job).filter((c) => clipIsExportableAudio(job, c));
}

/**
 * Deterministic: true when at least one enabled present audible/exportable
 * audio contribution exists in the selected export range.
 * Audio-kind clips and V clips with known embedded audio (`hasAudio === true`)
 * require AAC. Video-only files (`hasAudio === false`) do not.
 * Unknown V embedded audio is still mixed; a produced buffer must be encoded.
 */
export function expectsAudio(job: ExportJob): boolean {
  return exportableAudioClips(job).some((c) => c.kind === "audio" || c.hasAudio === true);
}

/** Mix candidates: A and V clips that are present. Video-only files drop at decode. */
export function audioClipsForMix(job: ExportJob): ExportClip[] {
  const clips = job.tracks.flatMap((t) => t.clips).filter((c) => !c.missing);
  return clips.filter((c) => {
    if (c.still) return false;
    if (c.kind === "video" && c.skipMix) {
      const mates = presentLinkedAudioMates(job, c);
      if (mates.length === 0) return false;
      return mixWindowsForClip(c, mates).length > 0;
    }
    if (c.skipMix) return false;
    if (c.kind === "video" && c.linkId) {
      const mates = presentLinkedAudioMates(job, c);
      if (mates.length > 0 && mixWindowsForClip(c, mates).length === 0) return false;
    }
    return true;
  });
}

export function missingOnlyVideoLabel(job: ExportJob): string | undefined {
  const videos = job.tracks.filter((t) => t.kind === "video").flatMap((t) => t.clips);
  if (videos.length === 0) return undefined;
  const present = videos.filter((c) => !c.missing && Boolean(c.sourceUrl));
  if (present.length > 0) return undefined;
  return videos[0]?.label || "media";
}

export function summarizeJob(job: ExportJob): {
  videoClips: number;
  audioClips: number;
  missing: number;
  durationMs: number;
} {
  const clips = job.tracks.flatMap((t) => t.clips);
  return {
    videoClips: clips.filter((c) => c.kind === "video").length,
    audioClips: clips.filter((c) => c.kind === "audio").length,
    missing: clips.filter((c) => c.missing).length,
    durationMs: job.durationMs,
  };
}
