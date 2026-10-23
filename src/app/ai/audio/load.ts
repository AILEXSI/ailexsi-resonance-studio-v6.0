import type { Clip } from "../../../core/models";
import { clipById, clipIsLocked } from "../../../core/models";
import { decodeAudio } from "../../../core/exporter/media";
import type { MixPcm } from "../../../core/visualz/feature-extractor";
import { selectionOf, type Session } from "../../session";
import type { AnalysisWindow } from "./beats";

export type ClipDecoder = (objectUrl: string) => Promise<MixPcm>;

export type LoadedClipAudio =
  | { ok: true; pcm: MixPcm; window: AnalysisWindow; clip: Clip }
  | { ok: false; error: string };

/**
 * Decode the one selected clip. Callers pass a decoder in tests.
 * No path is returned. A missing object URL is not analyzed.
 */
export async function loadSelectedClipAudio(
  session: Session,
  decode: ClipDecoder = decodeAudio,
): Promise<LoadedClipAudio> {
  const selected = selectionOf(session);
  if (selected.length === 0) return { ok: false, error: "No clip selected. No beats were detected." };
  if (selected.length !== 1) return { ok: false, error: "Select exactly one clip. No beats were detected." };
  const clip = clipById(session.project, selected[0]!);
  if (!clip) return { ok: false, error: "Clip not found. No beats were detected." };
  if (clipIsLocked(clip)) return { ok: false, error: "Clip is locked. No beats were detected." };
  const asset = session.project.assets.find((item) => item.id === clip.assetId);
  if (!asset || asset.missing || (asset.kind !== "audio" && asset.hasAudio !== true)) {
    return { ok: false, error: "The selected clip has no audio in this session. No beats were detected." };
  }
  if (!asset.objectUrl) {
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
