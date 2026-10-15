/**
 * song.analyze — read-only pass-0 report.
 * PCM comes from the tool runtime, same as audio.get_analysis. No fetch, no network.
 */
import type { Session } from "../../session";
import { clipById } from "../../../core/models";
import { analyzeSong, formatSongReport, type SongAnalysisReport } from "../../../core/director/song-analysis";
import { StatementLevelError } from "../../../core/director/song-analysis/seal";
import type { MixPcm } from "../../../core/visualz/feature-extractor";
import type { ToolResult } from "./types";
import { isLikelyDisplayName } from "./validate";

interface SongAnalyzeRuntime {
  session: Session;
  pcmByClipId?: Record<string, MixPcm>;
}

export const SONG_ANALYZE_TOOL = "song.analyze";

export interface SongAnalyzeData {
  summary: string;
  report: SongAnalysisReport;
}

export function songAnalyze(args: Record<string, unknown>, runtime: SongAnalyzeRuntime): ToolResult<SongAnalyzeData> {
  const windowMs = typeof args.windowMs === "number" ? args.windowMs : undefined;
  if (windowMs != null && (!(windowMs > 0) || windowMs > 10_000)) {
    return { ok: false, code: "INVALID_ARGS", message: "windowMs must be in (0, 10000]" };
  }
  const timelineOriginMs = typeof args.timelineOriginMs === "number" ? args.timelineOriginMs : undefined;
  if (timelineOriginMs != null && !Number.isFinite(timelineOriginMs)) {
    return { ok: false, code: "INVALID_ARGS", message: "timelineOriginMs must be finite" };
  }
  const lyrics = typeof args.lyrics === "string" ? args.lyrics : null;
  const lrc = typeof args.lrc === "string" ? args.lrc : null;
  const clipId = typeof args.clipId === "string" ? args.clipId : null;
  let pcm = null;
  if (clipId) {
    if (isLikelyDisplayName(clipId)) return { ok: false, code: "INVALID_ARGS", message: "Display names are not ids" };
    const clip = clipById(runtime.session.project, clipId);
    if (!clip) return { ok: false, code: "UNKNOWN_CLIP", message: "Clip not found" };
    pcm = runtime.pcmByClipId?.[clipId] ?? null;
  }
  try {
    const report = analyzeSong({
      pcm,
      lyricsText: lyrics,
      lrc,
      windowMs,
      timelineOriginMs,
    });
    return { ok: true, data: { summary: formatSongReport(report), report } };
  } catch (error) {
    if (error instanceof StatementLevelError) {
      return { ok: false, code: "INVALID_ARGS", message: error.message };
    }
    throw error;
  }
}
