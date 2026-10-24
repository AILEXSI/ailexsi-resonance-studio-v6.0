/**
 * Frame-accurate source frames for export.
 * V5.5 production backend is AILEXSI Frame Engine only.
 * There is no third-party demuxer path and no silent HTMLVideo export fallback.
 * Preview may still use HTMLVideo elsewhere.
 */
import { clipRateOf } from "../models";
import {
  AfeError,
  createFrameSourceBackend,
  isAfeError,
  markStage,
  type AfeStallSnapshot,
  type DrawableFrame,
  type FrameSourceBackendId,
  type OpenedFrameSource,
} from "../frame-engine";
import type { ExportClip } from "./types";
import { isPlayableSource } from "./media";
import { captureThrownValue, isStackOverflowThrown } from "./export-fail-dump";
import { getFrameSourceBackend } from "./frame-backend";

export type { DrawableFrame, FrameSourceBackendId };
export {
  exportFrameEngineLabel,
  getFrameSourceBackend,
  resetFrameSourceBackend,
  setFrameSourceBackend,
} from "./frame-backend";
export { drawContain } from "./draw-contain";

export type OpenedDecoder = {
  identity: FrameSourceBackendId;
  source: OpenedFrameSource;
  samplesAtTimestamps(
    timestamps: Iterable<number>,
    signal?: AbortSignal,
  ): AsyncIterable<DrawableFrame | null>;
  close(): void;
  stallSnapshot(extra?: Partial<AfeStallSnapshot>): AfeStallSnapshot | null;
  setExportStallExtra(extra: Partial<AfeStallSnapshot>): void;
};

const decoderCache = new Map<string, Promise<OpenedDecoder>>();

/** Source media time (seconds) at the center of an output frame. */
export function sourceTimeSec(clip: ExportClip, timelineMs: number, fps: number): number {
  const srcIn = clip.sourceInMs ?? 0;
  const offset = Math.max(0, timelineMs - clip.startMs);
  let srcMs = srcIn + offset * clipRateOf(clip) + 500 / Math.max(1, fps);
  if (clip.sourceOutMs != null && clip.sourceOutMs > srcIn) {
    srcMs = Math.min(srcMs, clip.sourceOutMs - 1);
  }
  return Math.max(0, srcMs / 1000);
}

function wrapOpened(source: OpenedFrameSource): OpenedDecoder {
  return {
    identity: source.identity,
    source,
    samplesAtTimestamps(timestamps: Iterable<number>, signal?: AbortSignal) {
      return source.getFramesAt([...timestamps], signal);
    },
    close() {
      source.close();
    },
    stallSnapshot(extra?: Partial<AfeStallSnapshot>) {
      return source.stallSnapshot?.(extra) ?? null;
    },
    setExportStallExtra(extra: Partial<AfeStallSnapshot>) {
      source.setExportStallExtra?.(extra);
    },
  };
}

async function openPreferred(src: string, signal?: AbortSignal): Promise<OpenedDecoder> {
  markStage("OPEN_PREFERRED_BEGIN");
  if (getFrameSourceBackend() === "htmlvideo") {
    throw new AfeError("AFE_UNSUPPORTED_CONTAINER", "HTMLVideo is not an export frame source");
  }
  if (!isPlayableSource(src)) {
    throw new AfeError("AFE_UNSUPPORTED_CONTAINER", "blocked or unreadable source");
  }

  try {
    return wrapOpened(await createFrameSourceBackend("ailexsi").open(src, signal));
  } catch (e) {
    captureThrownValue(e);
    if (isStackOverflowThrown(e)) throw e;
    if (isAfeError(e)) throw e;
    throw new AfeError("AFE_DECODE_FAILED", e instanceof Error ? e.message : String(e));
  }
}

export function evictFrameSource(src: string): void {
  const key = `${getFrameSourceBackend()}:${src}`;
  const hit = decoderCache.get(key);
  if (!hit) return;
  decoderCache.delete(key);
  void hit
    .then((opened) => {
      try {
        opened.close();
      } catch {
        /* already gone */
      }
    })
    .catch(() => {
      /* open failed */
    });
}

export function getDecoder(
  src: string,
  signal?: AbortSignal,
  opts?: { fresh?: boolean },
): Promise<OpenedDecoder> {
  if (getFrameSourceBackend() === "htmlvideo") {
    return Promise.reject(new AfeError("AFE_UNSUPPORTED_CONTAINER", "HTMLVideo is not an export frame source"));
  }
  if (!isPlayableSource(src)) {
    return Promise.reject(new AfeError("AFE_UNSUPPORTED_CONTAINER", "blocked or unreadable source"));
  }
  if (opts?.fresh) evictFrameSource(src);
  const key = `${getFrameSourceBackend()}:${src}`;
  const hit = decoderCache.get(key);
  if (hit) return hit;
  const opened = openPreferred(src, signal);
  decoderCache.set(key, opened);
  opened.catch(() => {
    decoderCache.delete(key);
  });
  return opened;
}

export function clearFrameSources(): void {
  for (const pending of decoderCache.values()) {
    void pending.then((opened) => {
      try {
        opened.close();
      } catch {
        /* already gone */
      }
    }).catch(() => {
      /* open failed */
    });
  }
  decoderCache.clear();
}
