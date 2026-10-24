import {
  AudioExportError,
  finalizeExportAudio,
  formatAudioFail,
  markAudioStage,
  prepareJobAudioMix,
  snapshotAudioExportReport,
  updateAudioExportReport,
  withTimeout,
} from "./audio";
import { clearFrameSources, getDecoder, sourceTimeSec, type DrawableFrame } from "./frame-source";
import {
  AfeError,
  emptyStallSnapshot,
  formatStallMessage,
  hostSafeSourceName,
  isAfeError,
  isExportTransactionComplete,
  markStage,
  mustColdOpenVideoDecoder,
  nowMs,
  resetStageTrace,
  setStageTraceContext,
  type AfeDumpPictureKind,
  type AfeStallSnapshot,
} from "../frame-engine";
import { AFE_DECODE_STALL_MS } from "../frame-engine/stall";
import { afePerfAdd, afePerfEnabled, afePerfTimeAsync } from "../frame-engine/perf";
import { validateMp4Ftyp } from "./ftyp";
import { videoClipAt } from "./job";
import { clearMediaCache, isPlayableSource } from "./media";
import { clearStillCache, paintStillUrl } from "../still";
import { mp4HasAudioTrack, muxAvcToMp4, type AvcSample } from "./mp4";
import type { ExportClip, ExportHooks, ExportJob, ExportResult } from "./types";
import { videoAlphaAtClipTime } from "../fades";
import {
  compositeVideoAt,
  contextFromExportClips,
  layerAlpha,
  resolvePictureSource,
} from "../transition";
import { exportVisOf } from "./job";
import { DEFAULT_AVC_BITRATE, selectAvcEncoderConfig } from "./avc-capability";
import {
  beginExportFailSession,
  captureThrownValue,
  exportResultFromCaughtThrow,
  isStackOverflowThrown,
  mergeStallSnapshotIntoExportFailContext,
  updateExportFailContext,
} from "./export-fail-dump";

export { compositeVideoAt as exportComposite } from "../transition";
import {
  createExportFeatureSession,
  visFeaturesForExport,
  type ExportFeatureSession,
  type MixPcm,
  renderVisualizerScene,
  visualizerEventAt,
  visualizerEventsOf,
} from "../visualizer";

export function canUseWebCodecs(): boolean {
  return (
    typeof VideoEncoder !== "undefined" &&
    typeof VideoFrame !== "undefined" &&
    typeof VideoEncoder.isConfigSupported === "function"
  );
}

export function webCodecsUnavailableMessage(): string {
  return "FAIL: WebCodecs unavailable. H.264 MP4 export requires VideoEncoder and VideoFrame. WebM is not a fallback.";
}

function fail(job: ExportJob, error: string, aborted = false): ExportResult {
  const audioReport = snapshotAudioExportReport();
  return {
    success: false,
    aborted,
    error,
    fileName: job.fileName,
    durationMs: job.durationMs,
    fileSizeBytes: 0,
    expectsAudio: audioReport.expectsAudio,
    audioReport,
  };
}

function failAudio(job: ExportJob, error: string): ExportResult {
  updateExportFailContext({ stage: "audio" });
  const msg = error.startsWith("FAIL:") ? error : `FAIL: ${error}`;
  return fail(job, formatAudioFail(msg));
}

function aborted(job: ExportJob): ExportResult {
  return fail(job, "Export aborted", true);
}

function even(n: number): number {
  return n % 2 === 0 ? n : n + 1;
}

function clearCanvas(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  ctx.fillStyle = "#101318";
  ctx.fillRect(0, 0, width, height);
}

function exportPictureCtx(job: ExportJob) {
  const clips = job.tracks.filter((t) => t.kind === "video").flatMap((t) => t.clips);
  const front = job.frontVideoTrackId === "V1" ? "V1" : "V2";
  return contextFromExportClips(clips, job.transitions ?? [], front, exportVisOf(job));
}

function jobComposite(job: ExportJob, timeMs: number) {
  return compositeVideoAt(exportPictureCtx(job), timeMs);
}

function paintTransitionPlate(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  job: ExportJob,
  timeMs: number,
): void {
  const plate = jobComposite(job, timeMs).plate;
  if (!plate || plate.alpha <= 0) return;
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = prev * plate.alpha;
  ctx.fillStyle = plate.color;
  ctx.fillRect(0, 0, width, height);
  ctx.globalAlpha = prev;
}

function exportClipById(job: ExportJob, clipId: string): ExportClip | undefined {
  return job.tracks.flatMap((track) => track.clips).find((clip) => clip.id === clipId);
}

/** Paint crossfade/dissolve layers other than the run's primary clip. Frame engine stays the timestamp source. */
async function paintOtherLayers(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  job: ExportJob,
  timeMs: number,
  primaryId: string,
  place: "behind" | "front",
  signal?: AbortSignal,
): Promise<void> {
  const layers = jobComposite(job, timeMs).layers;
  const index = layers.findIndex((layer) => layer.clipId === primaryId);
  const chosen =
    place === "behind"
      ? layers.slice(0, index < 0 ? 0 : index)
      : layers.slice(index < 0 ? 0 : index + 1);
  for (const layer of chosen) {
    if (layer.alpha <= 0.001 || layer.clipId === primaryId) continue;
    const clip = exportClipById(job, layer.clipId);
    if (!clip || timeMs < clip.startMs || timeMs >= clip.endMs) continue;
    if (clip.still) {
      await paintStillUrl(ctx, canvas, clip.sourceUrl, exportPaintAlpha(job, clip, timeMs));
      continue;
    }
    if (!isPlayableSource(clip.sourceUrl) || clip.missing) continue;
    const decoded = await getDecoder(clip.sourceUrl, signal);
    const frames = decoded.samplesAtTimestamps([sourceTimeSec(clip, timeMs, job.fps)], signal);
    const step = await frames[Symbol.asyncIterator]().next();
    const sample = step.value;
    if (!sample) continue;
    try {
      withVideoClipAlpha(ctx, job, clip, timeMs, () => {
        sample.drawWithFit(ctx, { fit: "contain" });
      });
    } finally {
      sample.close();
    }
  }
}

function beginExportFrame(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  job: ExportJob,
  timeMs: number,
): void {
  clearCanvas(ctx, width, height);
  paintTransitionPlate(ctx, width, height, job, timeMs);
}

function exportPaintAlpha(job: ExportJob, clip: ExportClip, timeMs: number): number {
  return exportClipVideoAlpha(clip, timeMs) * layerAlpha(jobComposite(job, timeMs), clip.id);
}

function paintVisualizer(
  ctx: CanvasRenderingContext2D,
  job: ExportJob,
  timeMs: number,
  dt: number,
  mix?: MixPcm | null,
  session?: ExportFeatureSession | null,
): void {
  if (resolvePictureSource(exportPictureCtx(job), timeMs).kind !== "vis") return;
  const covering = visualizerEventAt(job.visualizer, timeMs);
  const sceneId = covering
    ? covering.sceneId
    : visualizerEventsOf(job.visualizer).length === 0
      ? job.visualizer.sceneId
      : undefined;
  if (!sceneId) return;
  const features = visFeaturesForExport(timeMs, job.durationMs, mix, {
    timelineOriginMs: job.startMs,
    extractor: session ?? undefined,
  });
  renderVisualizerScene(ctx, job.width, job.height, sceneId, features, dt);
}

export type FrameRun = {
  clip: ExportClip | undefined;
  startIndex: number;
  count: number;
  pictureKind: AfeDumpPictureKind;
};

export function exportPictureKind(job: ExportJob, timeMs: number): AfeDumpPictureKind {
  const kind = resolvePictureSource(exportPictureCtx(job), timeMs).kind;
  if (kind === "vis") return "vis";
  if (kind === "black") return "black";
  return "video";
}

export function countExportPictureKinds(job: ExportJob): {
  visFrames: number;
  afeFrames: number;
  blackFrames: number;
  videoFramesRequested: number;
} {
  const fps = Math.max(1, job.fps);
  const total = Math.max(1, Math.round((job.durationMs / 1000) * fps));
  let visFrames = 0;
  let afeFrames = 0;
  let blackFrames = 0;
  for (let i = 0; i < total; i++) {
    const timeMs = (i / fps) * 1000;
    const kind = exportPictureKind(job, timeMs);
    const clip = kind === "video" ? videoClipAt(job, timeMs) : undefined;
    const opensAfe = Boolean(
      kind === "video" && clip && !clip.missing && !clip.still && isPlayableSource(clip.sourceUrl),
    );
    if (opensAfe) {
      afeFrames += 1;
      continue;
    }
    if (kind === "vis") visFrames += 1;
    else blackFrames += 1;
  }
  return { visFrames, afeFrames, blackFrames, videoFramesRequested: afeFrames };
}

export function groupFrameRuns(job: ExportJob, total: number, fps: number): FrameRun[] {
  const runs: FrameRun[] = [];
  let current: FrameRun | undefined;
  for (let i = 0; i < total; i++) {
    const timeMs = (i / fps) * 1000;
    const pictureKind = exportPictureKind(job, timeMs);
    const clip = pictureKind === "video" ? videoClipAt(job, timeMs) : undefined;
    const id = `${pictureKind}:${clip?.id ?? ""}`;
    const prev = current ? `${current.pictureKind}:${current.clip?.id ?? ""}` : "";
    if (current && prev === id) {
      current.count += 1;
    } else {
      current = { clip, startIndex: i, count: 1, pictureKind };
      runs.push(current);
    }
  }
  return runs;
}

function exportClipLocalMs(clip: ExportClip, timeMs: number): number {
  return timeMs - clip.startMs;
}

function exportClipVideoAlpha(clip: ExportClip, timeMs: number): number {
  return videoAlphaAtClipTime(
    {
      durationMs: Math.max(0, clip.endMs - clip.startMs),
      gain: clip.videoGain ?? clip.gain,
      fadeInMs: clip.fadeInMs,
      fadeOutMs: clip.fadeOutMs,
      fadeInFrom: clip.fadeInFrom,
      fadeOutTo: clip.fadeOutTo,
    },
    exportClipLocalMs(clip, timeMs),
  );
}

function withVideoClipAlpha(
  ctx: CanvasRenderingContext2D,
  job: ExportJob,
  clip: ExportClip,
  timeMs: number,
  draw: () => void,
): void {
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = prev * exportPaintAlpha(job, clip, timeMs);
  try {
    draw();
  } finally {
    ctx.globalAlpha = prev;
  }
}

function failAfe(job: ExportJob, error: unknown): ExportResult {
  if (isAfeError(error)) return fail(job, `FAIL: ${error.code}: ${error.message.replace(/^[A-Z0-9_]+:\s*/, "")}`);
  const msg = error instanceof Error ? error.message : String(error);
  if (msg.startsWith("AFE_")) return fail(job, `FAIL: ${msg}`);
  return fail(job, msg.startsWith("FAIL:") || msg.startsWith("missing:") ? (msg.startsWith("missing:") ? `FAIL: ${msg}` : msg) : `FAIL: ${msg}`);
}

export async function exportWithWebCodecs(
  job: ExportJob,
  hooks: ExportHooks = {},
): Promise<ExportResult> {
  beginExportFailSession(job);
  resetStageTrace();
  if (!canUseWebCodecs()) return fail(job, webCodecsUnavailableMessage());
  if (job.durationMs <= 0) return fail(job, "FAIL: empty export range");

  const width = even(job.width);
  const height = even(job.height);

  const selected = await selectAvcEncoderConfig({
    width,
    height,
    fps: job.fps,
    bitrate: DEFAULT_AVC_BITRATE,
  });
  if (!selected.ok) {
    return fail(job, selected.error);
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false, desynchronized: false });
  if (!ctx) return fail(job, "FAIL: 2D canvas unavailable");

  hooks.onProgress?.({ percent: 4, stage: "Mixing audio" });
  let audioExpected = false;
  let aacProbe = null as Awaited<ReturnType<typeof prepareJobAudioMix>>["probe"];
  let mixed: AudioBuffer | null = null;
  try {
    const prepared = await prepareJobAudioMix(job, hooks);
    audioExpected = prepared.expects;
    aacProbe = prepared.probe;
    mixed = prepared.mixed;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (hooks.signal?.aborted || /abort/i.test(msg)) return aborted(job);
    return failAudio(job, e instanceof AudioExportError ? e.message : msg);
  }

  hooks.onProgress?.({ percent: 6, stage: "Encoding H.264" });

  const samples: AvcSample[] = [];
  let description: Uint8Array | undefined;
  let encoderError: Error | undefined;

  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      if (meta?.decoderConfig?.description) {
        const desc = meta.decoderConfig.description;
        if (desc instanceof ArrayBuffer) description = new Uint8Array(desc);
        else if (ArrayBuffer.isView(desc)) {
          description = new Uint8Array(desc.buffer, desc.byteOffset, desc.byteLength);
        }
      }
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      samples.push({
        data,
        timestampUs: chunk.timestamp,
        durationUs: chunk.duration ?? Math.round(1_000_000 / job.fps),
        key: chunk.type === "key",
      });
    },
    error: (e) => {
      encoderError = e;
    },
  });

  encoder.configure({
    ...selected.config,
    latencyMode: "quality",
    hardwareAcceleration: "prefer-software",
  });

  const frameCount = Math.max(1, Math.round((job.durationMs / 1000) * job.fps));
  const frameDurUs = Math.round(1_000_000 / job.fps);
  const dt = 1 / job.fps;
  const runs = groupFrameRuns(job, frameCount, job.fps);
  const visSession = createExportFeatureSession(mixed, {
    hopMs: 1000 / Math.max(1, job.fps),
    durationMs: job.durationMs,
    timelineOriginMs: job.startMs,
  });

  const waitForQueue = async () => {
    if (!afePerfEnabled()) {
      while (encoder.encodeQueueSize > 8) {
        await new Promise<void>((resolve) => {
          const done = () => {
            encoder.removeEventListener("dequeue", done);
            window.clearTimeout(timer);
            resolve();
          };
          const timer = window.setTimeout(done, 200);
          encoder.addEventListener("dequeue", done);
        });
      }
      return;
    }
    const t0 = performance.now();
    while (encoder.encodeQueueSize > 8) {
      await new Promise<void>((resolve) => {
        const done = () => {
          encoder.removeEventListener("dequeue", done);
          window.clearTimeout(timer);
          resolve();
        };
        const timer = window.setTimeout(done, 200);
        encoder.addEventListener("dequeue", done);
      });
    }
    afePerfAdd("videoEncoderWait", performance.now() - t0);
  };

  const encodeCanvas = async (i: number) => {
    const timeMs = (i / job.fps) * 1000;
    paintVisualizer(ctx, job, timeMs, dt, mixed, visSession);
    await waitForQueue();
    const frame = new VideoFrame(canvas, {
      timestamp: i * frameDurUs,
      duration: frameDurUs,
    });
    encoder.encode(frame, { keyFrame: i % (job.fps * 2) === 0 });
    frame.close();
  };

  const paintFallback = (i: number) => {
    const timeMs = (i / job.fps) * 1000;
    beginExportFrame(ctx, width, height, job, timeMs);
    paintVisualizer(ctx, job, timeMs, dt, mixed, visSession);
  };

  let visFrames = 0;
  let afeFrames = 0;
  let blackFrames = 0;
  let videoFramesRequested = 0;
  let videoFramesDecoded = 0;
  let videoFramesEncoded = 0;
  let visFramesEncoded = 0;
  let blackFramesEncoded = 0;

  const noteEncoded = (i: number, usedAfeSample: boolean) => {
    const timeMs = (i / job.fps) * 1000;
    if (usedAfeSample) {
      afeFrames += 1;
      videoFramesEncoded += 1;
    } else if (exportPictureKind(job, timeMs) === "vis") {
      visFrames += 1;
      visFramesEncoded += 1;
    } else {
      blackFrames += 1;
      blackFramesEncoded += 1;
    }
  };

  const progressCounts = () => ({
    visFrames,
    afeFrames,
    blackFrames,
    videoFramesRequested,
    videoFramesDecoded,
    videoFramesEncoded,
    visFramesEncoded,
    blackFramesEncoded,
  });

  const encodingStage = () =>
    `Encoding H.264 · video ${videoFramesRequested}/${videoFramesDecoded}/${videoFramesEncoded} · vis ${visFramesEncoded} · black ${blackFramesEncoded}`;

  let coldOpenAfterVisForDump = false;
  const stallExtraFromClip = (clip: ExportClip, i: number): Partial<AfeStallSnapshot> => {
    const timeMs = (i / job.fps) * 1000;
    const pictureKind = exportPictureKind(job, timeMs);
    updateExportFailContext({
      exportFrame: i,
      timelineMs: timeMs,
      fps: job.fps,
      resolution: `${width}x${height}`,
      clipId: clip.id,
      clipName: clip.label,
      sourceId: hostSafeSourceName(clip.sourceUrl),
      sourceInMs: clip.sourceInMs ?? null,
      sourceOutMs: clip.sourceOutMs ?? null,
      pictureMode: pictureKind,
      videoReq: videoFramesRequested,
      videoDec: videoFramesDecoded,
      videoEnc: videoFramesEncoded,
      afeFrames,
      visFrames,
      blackFrames,
      encoderQueue: encoder.encodeQueueSize,
    });
    return {
      exportFrameIndex: i,
      exportTimestampSec: i / job.fps,
      sourceClipId: clip.id,
      sourceClipLabel: clip.label,
      sourceUrlName: hostSafeSourceName(clip.sourceUrl),
      sourceInMs: clip.sourceInMs ?? null,
      sourceOutMs: clip.sourceOutMs ?? null,
      timelineMs: timeMs,
      pictureKind,
      fps: job.fps,
      visFrames,
      afeFrames,
      blackFrames,
      videoFramesRequested,
      videoFramesDecoded,
      videoFramesEncoded,
      visFramesEncoded,
      blackFramesEncoded,
      originRequestedSample: null,
      originRequestedPts: null,
      originExportFrame: i,
      originTimelineMs: timeMs,
      originClipId: clip.id,
      originClipLabel: clip.label,
      originSourceName: hostSafeSourceName(clip.sourceUrl),
      originPictureKind: pictureKind,
      coldOpenAfterVis: coldOpenAfterVisForDump,
    };
  };

  const bindStageTrace = (clip: ExportClip, i: number): void => {
    setStageTraceContext({
      timelineMs: (i / job.fps) * 1000,
      exportFrame: i,
      clipId: clip.id,
      clipName: clip.label,
      sourceId: hostSafeSourceName(clip.sourceUrl),
    });
  };

  try {
    let previousPictureKind: AfeDumpPictureKind | null = null;
    for (const run of runs) {
      if (hooks.signal?.aborted) throw new Error("Export aborted");
      if (encoderError) throw encoderError;
      const clip = run.clip;
      if (run.pictureKind !== "video" || !clip || clip.missing || !isPlayableSource(clip.sourceUrl)) {
        for (let k = 0; k < run.count; k++) {
          if (hooks.signal?.aborted) throw new Error("Export aborted");
          const i = run.startIndex + k;
          updateExportFailContext({
            exportFrame: i,
            timelineMs: (i / job.fps) * 1000,
            fps: job.fps,
            resolution: `${width}x${height}`,
            clipId: clip?.id ?? null,
            clipName: clip?.label ?? null,
            pictureMode: run.pictureKind,
            videoReq: videoFramesRequested,
            videoDec: videoFramesDecoded,
            videoEnc: videoFramesEncoded,
            afeFrames,
            visFrames,
            blackFrames,
            encoderQueue: encoder.encodeQueueSize,
          });
          hooks.onProgress?.({
            percent: Math.round((i / frameCount) * 80) + 8,
            stage: encodingStage(),
            currentTimeMs: (i / job.fps) * 1000,
            ...progressCounts(),
          });
          paintFallback(i);
          await encodeCanvas(i);
          noteEncoded(i, false);
        }
        previousPictureKind = run.pictureKind;
        continue;
      }

      const timestamps = Array.from({ length: run.count }, (_, k) =>
        sourceTimeSec(clip, ((run.startIndex + k) / job.fps) * 1000, job.fps),
      );

      let painted = 0;
      if (clip.still) {
        for (let k = 0; k < run.count; k++) {
          if (hooks.signal?.aborted) throw new Error("Export aborted");
          const i = run.startIndex + k;
          hooks.onProgress?.({
            percent: Math.round((i / frameCount) * 80) + 8,
            stage: encodingStage(),
            currentTimeMs: (i / job.fps) * 1000,
            ...progressCounts(),
          });
          const timeMs = (i / job.fps) * 1000;
          beginExportFrame(ctx, width, height, job, timeMs);
          await paintOtherLayers(ctx, canvas, job, timeMs, clip.id, "behind", hooks.signal);
          if (await paintStillUrl(ctx, canvas, clip.sourceUrl, exportPaintAlpha(job, clip, timeMs))) {
            painted += 1;
          } else {
            paintFallback(i);
          }
          await paintOtherLayers(ctx, canvas, job, timeMs, clip.id, "front", hooks.signal);
          await encodeCanvas(i);
          noteEncoded(i, false);
        }
        if (painted === 0) throw new Error(`missing:${clip.label}`);
        previousPictureKind = "video";
        continue;
      }
      let decoded;
      const coldOpenAfterVis = mustColdOpenVideoDecoder({
        previousPictureKind,
        nextPictureKind: "video",
      });
      coldOpenAfterVisForDump = coldOpenAfterVis;
      bindStageTrace(clip, run.startIndex);
      markStage("FRAME_REQUESTED");
      markStage("CLIP_SELECTED");
      markStage("SOURCE_RESOLVED");
      try {
        decoded = await withTimeout(
          getDecoder(clip.sourceUrl, hooks.signal, { fresh: coldOpenAfterVis }),
          20000,
          null,
        );
      } catch (e) {
        if (isAfeError(e) && e.code === "AFE_ABORTED") throw e;
        if (isAfeError(e)) throw e;
        throw e;
      }
      if (!decoded) {
        throw new AfeError("AFE_DECODE_FAILED", `timed out opening ${clip.label}`);
      }
      let k = 0;
      let lastProgressAt = nowMs();
      try {
        const frames = decoded.samplesAtTimestamps(timestamps, hooks.signal);
        const iter = frames[Symbol.asyncIterator]();
        const exportStallMs = AFE_DECODE_STALL_MS + 2000;
        while (true) {
          if (hooks.signal?.aborted) throw new Error("Export aborted");
          if (encoderError) throw encoderError;
          videoFramesRequested += 1;
          if (k > 0) {
            bindStageTrace(clip, run.startIndex + k);
            markStage("FRAME_REQUESTED");
            markStage("CLIP_SELECTED");
            markStage("SOURCE_RESOLVED");
          }
          const stallFields = {
            ...stallExtraFromClip(clip, run.startIndex + k),
            videoFramesRequested,
            encoderEncodeQueueSize: encoder.encodeQueueSize,
            lastProgressUpdateMs: lastProgressAt,
          };
          decoded.setExportStallExtra(stallFields);
          const next = iter.next();
          const step = await new Promise<IteratorResult<DrawableFrame | null>>((resolve, reject) => {
            const timer = setTimeout(() => {
              const dump =
                decoded.stallSnapshot({
                  ...stallFields,
                  stalledMs: exportStallMs,
                }) ??
                emptyStallSnapshot({
                  ...stallFields,
                  stalledMs: exportStallMs,
                });
              if (isExportTransactionComplete(dump)) {
                console.info("[AFE-08] TRANSACTION COMPLETE", {
                  cancelledSpeculativeSamples: dump.cancelledSpeculativeSamples,
                  decodeQueueBeforeCancel: dump.decodeQueueBeforeCancel,
                  decoderResetForTransactionEnd: dump.decoderResetForTransactionEnd,
                  lastRequestedSample: dump.lastRequestedSample,
                  lastRequiredDecodeSample: dump.lastRequiredDecodeSample,
                  lastSubmittedSample: dump.lastSubmittedSample,
                  speculativeSamplesSubmitted: dump.speculativeSamplesSubmitted,
                  videoFramesRequested: dump.videoFramesRequested,
                  videoFramesDecoded: dump.videoFramesDecoded,
                  videoFramesEncoded: dump.videoFramesEncoded,
                });
                return;
              }
              console.error("[AFE-07] DECODE STALL", dump);
              reject(new AfeError("AFE_DECODE_STALL", formatStallMessage(dump), false));
            }, exportStallMs);
            next.then(
              (v) => {
                clearTimeout(timer);
                resolve(v);
              },
              (e) => {
                clearTimeout(timer);
                reject(e);
              },
            );
          });
          if (step.done) {
            videoFramesRequested -= 1;
            break;
          }
          const sample = step.value;
          if (hooks.signal?.aborted) throw new Error("Export aborted");
          if (encoderError) throw encoderError;
          const i = run.startIndex + k;
          lastProgressAt = nowMs();
          hooks.onProgress?.({
            percent: Math.round((i / frameCount) * 80) + 8,
            stage: encodingStage(),
            currentTimeMs: (i / job.fps) * 1000,
            ...progressCounts(),
          });
          const timeMs = (i / job.fps) * 1000;
          const loop0 = afePerfEnabled() ? performance.now() : 0;
          beginExportFrame(ctx, width, height, job, timeMs);
          if (loop0) afePerfAdd("exportLoopOverhead", performance.now() - loop0);
          await paintOtherLayers(ctx, canvas, job, timeMs, clip.id, "behind", hooks.signal);
          if (!sample) {
            const dump =
              decoded.stallSnapshot({
                ...stallFields,
                stalledMs: AFE_DECODE_STALL_MS,
              }) ??
              emptyStallSnapshot({
                ...stallFields,
                stalledMs: AFE_DECODE_STALL_MS,
              });
            throw new AfeError(
              "AFE_DECODE_STALL",
              `silent VIDEO null-yield forbidden; ${formatStallMessage(dump)}`,
              false,
            );
          }
          videoFramesDecoded += 1;
          withVideoClipAlpha(ctx, job, clip, timeMs, () => {
            sample.drawWithFit(ctx, { fit: "contain" });
          });
          sample.close();
          await paintOtherLayers(ctx, canvas, job, timeMs, clip.id, "front", hooks.signal);
          painted += 1;
          await encodeCanvas(i);
          noteEncoded(i, true);
          if (videoFramesRequested !== videoFramesDecoded || videoFramesDecoded !== videoFramesEncoded) {
            throw new AfeError(
              "AFE_DECODE_FAILED",
              `video chain broken requested=${videoFramesRequested} decoded=${videoFramesDecoded} encoded=${videoFramesEncoded}`,
              false,
            );
          }
          k += 1;
        }
      } catch (e) {
        captureThrownValue(e);
        const liveDump =
          decoded?.stallSnapshot({
            ...stallExtraFromClip(clip, run.startIndex + k),
            encoderEncodeQueueSize: encoder.encodeQueueSize,
            lastProgressUpdateMs: lastProgressAt,
            stalledMs: AFE_DECODE_STALL_MS,
          }) ?? null;
        if (liveDump) mergeStallSnapshotIntoExportFailContext(liveDump);
        if (isStackOverflowThrown(e)) throw e;
        const msg = e instanceof Error ? e.message : String(e);
        if (isAfeError(e) && e.code === "AFE_DECODE_STALL") {
          const dump =
            decoded.stallSnapshot({
              ...stallExtraFromClip(clip, run.startIndex + k),
              encoderEncodeQueueSize: encoder.encodeQueueSize,
              lastProgressUpdateMs: lastProgressAt,
              stalledMs: AFE_DECODE_STALL_MS,
            }) ??
            emptyStallSnapshot({
              ...stallExtraFromClip(clip, run.startIndex + k),
              encoderEncodeQueueSize: encoder.encodeQueueSize,
              lastProgressUpdateMs: lastProgressAt,
              stalledMs: AFE_DECODE_STALL_MS,
            });
          if (isExportTransactionComplete(dump)) {
            console.info("[AFE-08] TRANSACTION COMPLETE", {
              cancelledSpeculativeSamples: dump.cancelledSpeculativeSamples,
              decodeQueueBeforeCancel: dump.decodeQueueBeforeCancel,
              decoderResetForTransactionEnd: dump.decoderResetForTransactionEnd,
            });
            break;
          }
          console.error("[AFE-07] DECODE STALL", dump);
          throw new AfeError("AFE_DECODE_STALL", formatStallMessage(dump), false);
        }
        if (/abort/i.test(msg) || (isAfeError(e) && e.code === "AFE_ABORTED")) throw e;
        if (isAfeError(e)) throw e;
        throw new AfeError("AFE_DECODE_FAILED", msg);
      }
      if (k < run.count) {
        throw new AfeError("AFE_DECODE_FAILED", `incomplete frame run for ${clip.label}`);
      }

      if (painted === 0) {
        throw new Error(`missing:${clip.label}`);
      }
      previousPictureKind = "video";
    }

    await afePerfTimeAsync("videoEncoderWait", () => encoder.flush());
    encoder.close();
  } catch (e) {
    try {
      encoder.close();
    } catch {
      /* already closed */
    }
    clearFrameSources();
    clearMediaCache();
    clearStillCache();
    captureThrownValue(e);
    const msg = e instanceof Error ? e.message : String(e);
    if (hooks.signal?.aborted || /abort/i.test(msg) || (isAfeError(e) && e.code === "AFE_ABORTED")) {
      return aborted(job);
    }
    if (isStackOverflowThrown(e)) return exportResultFromCaughtThrow(job, e);
    if (isAfeError(e) || msg.startsWith("AFE_")) return failAfe(job, e);
    if (e instanceof Error && e.stack) return exportResultFromCaughtThrow(job, e);
    const prefixed = msg.startsWith("FAIL:") || msg.startsWith("missing:") ? msg : `FAIL: ${msg}`;
    return fail(job, prefixed.startsWith("missing:") ? `FAIL: ${prefixed}` : prefixed);
  }

  clearFrameSources();
  clearMediaCache();
  clearStillCache();

  if (hooks.signal?.aborted) return aborted(job);
  if (!description) return fail(job, "FAIL: encoder did not emit AVC description");
  if (samples.length === 0) return fail(job, "FAIL: encoder produced no samples");

  hooks.onProgress?.({ percent: 90, stage: "Encoding AAC" });
  let audioTrack: Parameters<typeof muxAvcToMp4>[0]["audio"];
  let audioKind: "aac" | "none" = "none";
  try {
    const finalized = await finalizeExportAudio(job, mixed, aacProbe, hooks);
    audioTrack = finalized.audioTrack;
    if (audioTrack) audioKind = "aac";
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (hooks.signal?.aborted || /abort/i.test(msg)) return aborted(job);
    return failAudio(job, e instanceof AudioExportError ? e.message : `AAC encode failed: ${msg}`);
  }

  if (hooks.signal?.aborted) return aborted(job);
  hooks.onProgress?.({ percent: 95, stage: "Muxing MP4" });
  updateExportFailContext({ stage: "mux" });
  if (audioTrack) markAudioStage("AUDIO_MUX_BEGIN");
  updateAudioExportReport({ mp4AudioSupplied: Boolean(audioTrack) });
  let bytes: Uint8Array;
  try {
    const mux0 = afePerfEnabled() ? performance.now() : 0;
    bytes = muxAvcToMp4({
      width,
      height,
      fps: job.fps,
      description,
      samples,
      audio: audioTrack,
    });
    if (mux0) afePerfAdd("mux", performance.now() - mux0);
  } catch (e) {
    captureThrownValue(e);
    if (isStackOverflowThrown(e) || (e instanceof Error && e.stack && /call stack|recursion/i.test(e.message))) {
      updateExportFailContext({ stage: "mux" });
      return exportResultFromCaughtThrow(job, e);
    }
    const msg = e instanceof Error ? e.message : String(e);
    return fail(job, `FAIL: mux ${msg}`);
  }
  if (audioTrack) markAudioStage("AUDIO_MUX_DONE");

  const check = validateMp4Ftyp(bytes);
  if (!check.ok) return fail(job, `FAIL: ${check.error}`);
  const hasAudioTrak = mp4HasAudioTrack(bytes);
  updateAudioExportReport({ mp4HasAudioTrack: hasAudioTrak });
  if (audioKind === "aac" || audioExpected) {
    if (!hasAudioTrak) {
      updateAudioExportReport({ resultAudio: "none" });
      return failAudio(job, "MP4 missing AAC audio trak (expectsAudio)");
    }
    markAudioStage("AUDIO_TRACK_VALIDATED");
    audioKind = "aac";
  } else {
    audioKind = "none";
  }
  updateAudioExportReport({ resultAudio: audioKind });

  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy], { type: "video/mp4" });
  hooks.onProgress?.({ percent: 100, stage: "Done" });
  return {
    success: true,
    fileName: job.fileName,
    durationMs: job.durationMs,
    fileSizeBytes: blob.size,
    mimeType: "video/mp4",
    blob,
    brands: check.brands,
    audio: audioKind,
    expectsAudio: audioExpected,
    audioReport: snapshotAudioExportReport(),
    videoFramesRequested,
    videoFramesDecoded,
    videoFramesEncoded,
    visFramesEncoded,
    blackFramesEncoded,
  };
}
