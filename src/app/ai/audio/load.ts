import type { Clip, MediaAsset } from "../../../core/models";
import { clipById, clipIsLocked, kindOfTrack } from "../../../core/models";
import { decodeAudio } from "../../../core/exporter/media";
import type { MixPcm } from "../../../core/visualz/feature-extractor";
import { selectionOf, type Session } from "../../session";
import type { AnalysisWindow } from "./beats";

export type ClipDecoder = (objectUrl: string) => Promise<MixPcm>;

export type LoadedClipAudio =
  | { ok: true; pcm: MixPcm; window: AnalysisWindow; clip: Clip; note: string }
  | { ok: false; error: string };

export type ChosenBeatClip = { ok: true; clip: Clip; note: string } | { ok: false; error: string };

function assetOf(session: Session, clip: Clip): MediaAsset | undefined {
  return session.project.assets.find((item) => item.id === clip.assetId);
}

function isAudioAsset(asset: MediaAsset | undefined): asset is MediaAsset {
  return !!asset && !asset.missing && asset.kind === "audio";
}

function isVideoClip(session: Session, clip: Clip): boolean {
  const asset = assetOf(session, clip);
  return asset?.kind === "video" || kindOfTrack(clip.trackId) === "video";
}

function projectHasAudio(session: Session): boolean {
  return session.project.clips.some((clip) => isAudioAsset(assetOf(session, clip)));
}

function clipIdsFromArgs(args: unknown): string[] | null {
  if (!args || typeof args !== "object" || Array.isArray(args)) return null;
  const record = args as { clipId?: unknown; clipIds?: unknown };
  if (Array.isArray(record.clipIds)) {
    if (!record.clipIds.every((id) => typeof id === "string" && id.length > 0)) return [];
    return record.clipIds as string[];
  }
  if (typeof record.clipId === "string" && record.clipId) return [record.clipId];
  return null;
}

function overlaps(left: Clip, right: Clip): boolean {
  const leftEnd = left.startMs + left.durationMs;
  const rightEnd = right.startMs + right.durationMs;
  return left.startMs < rightEnd && right.startMs < leftEnd;
}

function audioClipsOnA1(session: Session): Clip[] {
  return session.project.clips.filter(
    (clip) => clip.trackId === "A1" && clip.enabled !== false && isAudioAsset(assetOf(session, clip)),
  );
}

function fallbackToA1(session: Session, video: Clip): ChosenBeatClip {
  const candidates = audioClipsOnA1(session);
  const covering = candidates.filter((clip) => overlaps(clip, video));
  const chosen = covering.length === 1 ? covering[0] : candidates.length === 1 ? candidates[0] : undefined;
  if (chosen) {
    if (clipIsLocked(chosen)) return { ok: false, error: "The A1 audio clip is locked. No beats were detected." };
    const cover = covering.length === 1 ? `covers ${video.id}` : "is the only clip on A1";
    return {
      ok: true,
      clip: chosen,
      note: `Clip ${video.id} is video. Beats are measured on audio track A1 (${chosen.id}, ${cover}).`,
    };
  }
  if (candidates.length === 0) {
    return {
      ok: false,
      error: `Clip ${video.id} is video. Track A1 has no audio clip. No beats were detected.`,
    };
  }
  const ids = (covering.length > 1 ? covering : candidates).map((clip) => clip.id).join(", ");
  const why = covering.length > 1 ? "more than one audio clip covers it" : "no single audio clip covers it";
  return {
    ok: false,
    error: `Clip ${video.id} is video. Track A1 has ${why} (${ids}). No beats were detected.`,
  };
}

/**
 * Pick the clip whose audio may be measured.
 * A video clip id falls back to one A1 audio clip. No audio in the project fails closed.
 */
export function chooseBeatClip(session: Session, args: unknown): ChosenBeatClip {
  if (!projectHasAudio(session)) {
    return { ok: false, error: "No audio in this project. No beats were detected." };
  }
  const requested = clipIdsFromArgs(args);
  let clip: Clip | undefined;
  if (requested) {
    if (requested.length !== 1) {
      return { ok: false, error: "Name exactly one clip. No beats were detected." };
    }
    clip = clipById(session.project, requested[0]!);
    if (!clip) return { ok: false, error: `Clip ${requested[0]} was not found. No beats were detected.` };
  } else {
    const selected = selectionOf(session);
    if (selected.length === 0) return { ok: false, error: "No clip selected. No beats were detected." };
    if (selected.length !== 1) return { ok: false, error: "Select exactly one clip. No beats were detected." };
    clip = clipById(session.project, selected[0]!);
    if (!clip) return { ok: false, error: "Clip not found. No beats were detected." };
  }
  if (isVideoClip(session, clip)) return fallbackToA1(session, clip);
  if (clipIsLocked(clip)) return { ok: false, error: "Clip is locked. No beats were detected." };
  if (!isAudioAsset(assetOf(session, clip))) {
    return { ok: false, error: "The selected clip has no audio in this session. No beats were detected." };
  }
  return { ok: true, clip, note: "" };
}

/**
 * Decode one clip. Callers pass a decoder in tests.
 * No path is returned. A missing object URL is not analyzed.
 */
export async function loadBeatClipAudio(
  session: Session,
  args: unknown,
  decode: ClipDecoder = decodeAudio,
): Promise<LoadedClipAudio> {
  const chosen = chooseBeatClip(session, args);
  if (!chosen.ok) return chosen;
  const clip = chosen.clip;
  const asset = assetOf(session, clip);
  if (!asset?.objectUrl) {
    return { ok: false, error: "The selected clip's audio is not loaded. No beats were detected." };
  }
  if (!(clip.rate > 0)) return { ok: false, error: "Clip rate is invalid. No beats were detected." };
  try {
    const pcm = await decode(asset.objectUrl);
    const sourceOut = clip.sourceOutMs > clip.sourceInMs ? clip.sourceOutMs : clip.sourceInMs + clip.durationMs * clip.rate;
    return {
      ok: true,
      pcm,
      clip,
      note: chosen.note,
      window: {
        sourceInMs: clip.sourceInMs,
        sourceOutMs: sourceOut,
        timelineStartMs: clip.startMs,
        rate: clip.rate,
      },
    };
  } catch {
    return { ok: false, error: "The audio could not be decoded. No beats were detected." };
  }
}

/** Decode the one selected clip. */
export async function loadSelectedClipAudio(
  session: Session,
  decode: ClipDecoder = decodeAudio,
): Promise<LoadedClipAudio> {
  return loadBeatClipAudio(session, {}, decode);
}
