import { mixJobAudio, type AacProbe } from "./audio";
import { wavFileName } from "./filename-version";
import type { ExportHooks, ExportJob, ExportResult } from "./types";

export { wavFileName };

/** Mix layout for WAV — same PCM mix as AAC/VIS, no AAC encoder. */
export const WAV_MIX_LAYOUT: AacProbe = {
  sampleRate: 44100,
  channels: 2,
  bitrate: 128_000,
};

export type PcmBuffer = {
  sampleRate: number;
  numberOfChannels: number;
  length: number;
  getChannelData: (channel: number) => Float32Array;
};

function fail(job: ExportJob, error: string, aborted = false): ExportResult {
  return {
    success: false,
    aborted,
    error,
    fileName: wavFileName(job.fileName),
    durationMs: job.durationMs,
    fileSizeBytes: 0,
  };
}

function clampSample(s: number): number {
  if (!Number.isFinite(s)) return 0;
  if (s > 1) return 1;
  if (s < -1) return -1;
  return s;
}

function floatToPcm16(s: number): number {
  const x = clampSample(s);
  return x < 0 ? Math.round(x * 0x8000) : Math.round(x * 0x7fff);
}

/** Interleaved little-endian PCM16 WAVE. Preview mix and this file share the same buffer. */
export function encodeWavPcm(buffer: PcmBuffer): ArrayBuffer {
  const channels = Math.max(1, Math.min(2, buffer.numberOfChannels || 1));
  const frames = Math.max(0, buffer.length | 0);
  const rate = Math.max(1, Math.round(buffer.sampleRate) || 44100);
  const blockAlign = channels * 2;
  const dataBytes = frames * blockAlign;
  const bytes = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(bytes);
  const writeStr = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, dataBytes, true);
  let o = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const chan = buffer.getChannelData(c);
      view.setInt16(o, floatToPcm16(chan[i] ?? 0), true);
      o += 2;
    }
  }
  return bytes;
}

export function readWavPcm(bytes: ArrayBuffer): {
  sampleRate: number;
  channels: number;
  frames: number;
  samples: Int16Array;
} {
  const view = new DataView(bytes);
  const ascii = (offset: number, n: number) =>
    String.fromCharCode(...Array.from({ length: n }, (_, i) => view.getUint8(offset + i)));
  if (ascii(0, 4) !== "RIFF" || ascii(8, 4) !== "WAVE") {
    throw new Error("Not a WAV file");
  }
  const channels = view.getUint16(22, true);
  const sampleRate = view.getUint32(24, true);
  const bits = view.getUint16(34, true);
  const dataBytes = view.getUint32(40, true);
  if (bits !== 16) throw new Error("Expected PCM16");
  const frames = Math.floor(dataBytes / (channels * 2));
  return {
    sampleRate,
    channels,
    frames,
    samples: new Int16Array(bytes, 44, frames * channels),
  };
}

export async function exportMixWav(
  job: ExportJob,
  hooks: ExportHooks = {},
  mix: typeof mixJobAudio = mixJobAudio,
): Promise<ExportResult> {
  const fileName = wavFileName(job.fileName);
  hooks.onProgress?.({ percent: 0, stage: "Mixing" });
  if (hooks.signal?.aborted) {
    return fail({ ...job, fileName }, "Export aborted", true);
  }
  if (!job || job.durationMs <= 0) {
    return fail({ ...job, fileName }, "FAIL: empty export job");
  }
  let mixed: AudioBuffer | null = null;
  try {
    mixed = await mix(job, WAV_MIX_LAYOUT, hooks.signal);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (hooks.signal?.aborted || /abort/i.test(msg)) {
      return fail({ ...job, fileName }, "Export aborted", true);
    }
    return fail({ ...job, fileName }, `FAIL: ${msg}`);
  }
  if (hooks.signal?.aborted) {
    return fail({ ...job, fileName }, "Export aborted", true);
  }
  if (!mixed || mixed.length <= 0 || mixed.numberOfChannels <= 0) {
    return fail({ ...job, fileName }, "FAIL: no audible mix to write");
  }
  hooks.onProgress?.({ percent: 80, stage: "Writing WAV" });
  const bytes = encodeWavPcm(mixed);
  const blob = new Blob([bytes], { type: "audio/wav" });
  hooks.onProgress?.({ percent: 100, stage: "Done" });
  return {
    success: true,
    fileName,
    durationMs: job.durationMs,
    fileSizeBytes: bytes.byteLength,
    mimeType: "audio/wav",
    blob,
    audio: "wav",
  };
}

export function downloadWav(result: ExportResult): void {
  if (result.aborted || !result.success || !result.blob) {
    throw new Error(result.error ?? "Export did not produce a WAV");
  }
  const url = URL.createObjectURL(result.blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = result.fileName.endsWith(".wav") ? result.fileName : `${result.fileName}.wav`;
  a.click();
  URL.revokeObjectURL(url);
}
