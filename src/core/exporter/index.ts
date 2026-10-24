import { ensureLexiScenes } from "../visualz/scenes";
import { canUseWebCodecs, exportWithWebCodecs, webCodecsUnavailableMessage } from "./webcodecs";
import { beginExportFailSession, exportResultFromCaughtThrow } from "./export-fail-dump";
import { missingOnlyVideoLabel } from "./job";
import type { ExportHooks, ExportJob, ExportResult } from "./types";

export type { ExportHooks, ExportJob, ExportProgress, ExportResult, ExportAudioKind } from "./types";
export {
  abortExportDialog,
  applyExportDialogSize,
  applyExportProgress,
  closeExportDialog,
  closedExportDialog,
  driveExportDialog,
  EXPORT_FPS_PRESETS,
  EXPORT_SIZE_PRESETS,
  failExportDialog,
  isExportSuccess,
  normalizeExportFps,
  normalizeExportSize,
  openExportDialog,
  readyExportDialog,
  succeedExportDialog,
  type ExportDialogState,
} from "./dialog";
export {
  jobFromProject,
  ExportPlanError,
  summarizeJob,
  videoClipAt,
  missingOnlyVideoLabel,
  expectsAudio,
  exportableAudioClips,
  clipIsExportableAudio,
} from "./job";
export { runExportWithDestination, type ExportDestinationOutcome } from "./destination";
export {
  existingExportNamesFromMemory,
  existingProjectNamesFromMemory,
  formatExportFileName,
  mediaExportFileName,
  nextVersionedFileName,
  parseExportFileName,
  readyExportNameFromProject,
  sanitizeMediaExportStem,
  splitNameAndExt,
  suggestedProjectSaveAsName,
} from "./filename-version";
export {
  collectExistingExportNames,
  listDirectoryFileNames,
  probeExportSiblingNames,
  readyExportNameFromProjectAsync,
  resolveSuggestedExportFileName,
} from "./export-name";
export {
  canUseWebCodecs,
  countExportPictureKinds,
  exportPictureKind,
  groupFrameRuns,
  webCodecsUnavailableMessage,
} from "./webcodecs";
export type { FrameRun } from "./webcodecs";
export {
  AVC_BASELINE_LEVEL_3_1,
  DEFAULT_AVC_BITRATE,
  avcEncoderCandidates,
  requiredAvcLevel,
  selectAvcEncoderConfig,
  unsupportedAvcEncoderMessage,
} from "./avc-capability";
export { validateMp4Ftyp, looksLikeWebm, hexHeader } from "./ftyp";
export {
  aacAudioSpecificConfigIsUsable,
  audioInputForMux,
  mp4HasAudioTrack,
  mp4SoundTrackInfo,
  muxAvcToMp4,
} from "./mp4";
export {
  AAC_ENCODE_QUEUE_HIGH_WATER,
  AudioExportError,
  AUDIO_STAGE_NAMES,
  beginJobAudioReport,
  classifyOfflineAudioMemory,
  encodeAac,
  finalizeExportAudio,
  formatAudioExportReport,
  formatAudioFail,
  getAudioExportReport,
  mixJobAudio,
  pcmBytesForDuration,
  prepareJobAudioMix,
  probeAac,
  requireAacForMixed,
  resetAudioExportReport,
  snapshotAudioExportReport,
  waitForAudioEncodeQueue,
  withTimeout,
} from "./audio";
export type { AacProbe, AudioExportReport, AudioStageName } from "./audio";
export type { Mp4SoundTrackInfo } from "./mp4";
export { downloadWav, encodeWavPcm, exportMixWav, readWavPcm, wavFileName } from "./wav";
export {
  beginExportFailSession,
  captureThrownValue,
  clearExportFailDiagnostics,
  diagnosticSourcemapEnabled,
  exportResultFromCaughtThrow,
  formatExportFailDump,
  getExportFailContext,
  installExportFailDiagnostics,
  uninstallExportFailDiagnostics,
  isStackOverflowThrown,
  lastCapturedThrown,
  lastGlobalExportFail,
  resetExportFailContext,
  updateExportFailContext,
  EXPORT_FAIL_DUMP_TITLE,
} from "./export-fail-dump";
export type { CapturedThrown, ExportFailContext } from "./export-fail-dump";

function fail(job: ExportJob | undefined, error: string, aborted = false): ExportResult {
  return {
    success: false,
    aborted,
    error,
    fileName: job?.fileName ?? "export.mp4",
    durationMs: job?.durationMs ?? 0,
    fileSizeBytes: 0,
  };
}

export function abortedExportResult(job?: ExportJob): ExportResult {
  return fail(job, "Export aborted", true);
}

export async function exportTimeline(
  job: ExportJob,
  hooks: ExportHooks = {},
): Promise<ExportResult> {
  hooks.onProgress?.({ percent: 0, stage: "Validating" });
  if (hooks.signal?.aborted) {
    return abortedExportResult(job);
  }
  if (!job || job.durationMs <= 0) {
    return fail(job, "FAIL: empty export job");
  }
  const visOnly = job.visualizer?.enabled && !job.visualizer?.muted;
  if (!job.tracks.some((t) => t.clips.length > 0) && !visOnly) {
    return fail(job, "FAIL: no clips in export range");
  }
  const missingName = missingOnlyVideoLabel(job);
  if (missingName) {
    return fail(job, `FAIL: missing:${missingName}`);
  }
  if (hooks.signal?.aborted) {
    return abortedExportResult(job);
  }
  if (!canUseWebCodecs()) {
    return fail(job, webCodecsUnavailableMessage());
  }
  await ensureLexiScenes();
  beginExportFailSession(job);
  try {
    return await exportWithWebCodecs(job, hooks);
  } catch (e) {
    return exportResultFromCaughtThrow(job, e);
  }
}

export function downloadMp4(result: ExportResult): void {
  if (result.aborted || !result.success || !result.blob) {
    throw new Error(result.error ?? "Export did not produce an MP4");
  }
  const url = URL.createObjectURL(result.blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = result.fileName.endsWith(".mp4") ? result.fileName : `${result.fileName}.mp4`;
  a.click();
  URL.revokeObjectURL(url);
}
