import { scheduleGainEnvelope } from "../fades";
import { clampClipRate } from "../models";
import { timeStretchChannels } from "./time-stretch";
import { scheduleTransitionAudioGain } from "../transition";
import { clampPan, equalPowerPan } from "../volume";
import { scheduleVolumeAutomation, volumeAutomationIsActive } from "../volume-automation";
import {
  audioClipsForMix,
  expectsAudio as jobExpectsAudio,
  mixWindowsForClip,
  presentLinkedAudioMates,
} from "./job";
import { decodeAudio, isPlayableSource } from "./media";
import { aacAudioSpecificConfigIsUsable, audioInputForMux, type AacSample, type AacTrack } from "./mp4";
import type { ExportHooks, ExportJob } from "./types";
import type { TrackId } from "../models";
import {
  beginAudioExportReport,
  formatAudioExportReport,
  markAudioStage,
  snapshotAudioExportReport,
  updateAudioExportReport,
  type AudioExportReport,
  type AudioTrackSnapshot,
} from "./audio-trace";

export {
  expectsAudio,
  exportableAudioClips,
  clipIsExportableAudio,
} from "./job";

export {
  AUDIO_STAGE_NAMES,
  beginAudioExportReport,
  classifyOfflineAudioMemory,
  getAudioExportReport,
  markAudioStage,
  pcmBytesForDuration,
  resetAudioExportReport,
  snapshotAudioExportReport,
  updateAudioExportReport,
  type AudioExportReport,
  type AudioStageName,
} from "./audio-trace";
export { formatAudioExportReport };

function trackPanOfJob(job: ExportJob, trackId: TrackId): number {
  return clampPan(job.tracks.find((t) => t.id === trackId)?.pan ?? 0);
}

/** Pan last: gain envelope (clip/fade/fader/master) already on `input`. */
function connectTrackPan(ctx: OfflineAudioContext, input: AudioNode, pan: number): void {
  const p = clampPan(pan);
  if (typeof ctx.createStereoPanner === "function") {
    const panner = ctx.createStereoPanner();
    panner.pan.value = p;
    input.connect(panner);
    panner.connect(ctx.destination);
    return;
  }
  const { left, right } = equalPowerPan(p);
  const merger = ctx.createChannelMerger(2);
  const gL = ctx.createGain();
  const gR = ctx.createGain();
  gL.gain.value = left;
  gR.gain.value = right;
  input.connect(gL);
  input.connect(gR);
  gL.connect(merger, 0, 0);
  gR.connect(merger, 0, 1);
  merger.connect(ctx.destination);
}

export type AacProbe = {
  sampleRate: number;
  channels: number;
  bitrate: number;
};

const AAC_CODEC = "mp4a.40.2";

/** Same high-water spirit as video encodeQueueSize > 8. Duration-scaling PCM must not queue unbounded. */
export const AAC_ENCODE_QUEUE_HIGH_WATER = 8;

export class AudioExportError extends Error {
  constructor(message: string) {
    super(message.startsWith("FAIL:") ? message : `FAIL: ${message}`);
    this.name = "AudioExportError";
  }
}

export function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = window.setTimeout(() => resolve(fallback), ms);
    p.then(
      (v) => { window.clearTimeout(t); resolve(v); },
      (e) => { window.clearTimeout(t); reject(e); },
    );
  });
}

export type AudioEncoderQueue = {
  encodeQueueSize: number;
  addEventListener?(type: string, listener: () => void): void;
  removeEventListener?(type: string, listener: () => void): void;
};

export async function waitForAudioEncodeQueue(
  encoder: AudioEncoderQueue,
  signal?: AbortSignal,
): Promise<void> {
  while (encoder.encodeQueueSize > AAC_ENCODE_QUEUE_HIGH_WATER) {
    if (signal?.aborted) throw new AudioExportError("Export aborted");
    await new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        encoder.removeEventListener?.("dequeue", done);
        window.clearTimeout(timer);
        resolve();
      };
      const timer = window.setTimeout(done, 200);
      encoder.addEventListener?.("dequeue", done);
    });
  }
}

export async function probeAac(): Promise<AacProbe | null> {
  if (typeof AudioEncoder === "undefined") return null;
  const candidates: AacProbe[] = [
    { sampleRate: 44100, channels: 2, bitrate: 128_000 },
    { sampleRate: 48000, channels: 2, bitrate: 128_000 },
    { sampleRate: 44100, channels: 1, bitrate: 96_000 },
    { sampleRate: 48000, channels: 1, bitrate: 96_000 },
  ];
  for (const c of candidates) {
    try {
      let failed = false;
      const encoder = new AudioEncoder({
        output: () => {},
        error: () => {
          failed = true;
        },
      });
      encoder.configure({
        codec: AAC_CODEC,
        numberOfChannels: c.channels,
        sampleRate: c.sampleRate,
        bitrate: c.bitrate,
      });
      encoder.close();
      if (!failed) return c;
    } catch {
      /* next */
    }
  }
  return null;
}

/** Video-only / empty decode: no channels or no frames → skip, do not fail the mix. */
export function decodedBufferIsAudible(
  buf: Pick<AudioBuffer, "numberOfChannels" | "length">,
): boolean {
  return buf.numberOfChannels > 0 && buf.length > 0;
}

export function audioTrackSnapshots(job: ExportJob): AudioTrackSnapshot[] {
  return job.tracks.map((t) => ({
    id: t.id,
    kind: t.kind,
    muted: t.muted ?? null,
    solo: t.solo ?? null,
    volume: t.volume ?? null,
    pan: t.pan,
    clipCount: t.clips.length,
  }));
}

export function beginJobAudioReport(job: ExportJob, expects: boolean): AudioExportReport {
  return beginAudioExportReport({
    projectDurationMs: job.durationMs,
    exportStartMs: job.startMs,
    exportEndMs: job.endMs,
    expectsAudio: expects,
    clipCount: audioClipsForMix(job).length,
    trackCount: job.tracks.length,
    tracks: audioTrackSnapshots(job),
  });
}

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/** Reverse the source span so index 0 is the source time at the timeline start. */
function sliceReversed(
  ctx: BaseAudioContext,
  decoded: AudioBuffer,
  fromSec: number,
  toSec: number,
): AudioBuffer {
  const sr = decoded.sampleRate;
  const lo = Math.max(0, Math.min(fromSec, toSec));
  const hi = Math.min(decoded.duration, Math.max(fromSec, toSec));
  const startSample = Math.min(decoded.length - 1, Math.max(0, Math.floor(lo * sr)));
  const endSample = Math.min(decoded.length, Math.max(startSample + 1, Math.ceil(hi * sr)));
  const length = Math.max(1, endSample - startSample);
  const out = ctx.createBuffer(decoded.numberOfChannels, length, sr);
  for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
    const src = decoded.getChannelData(ch);
    const dst = out.getChannelData(ch);
    for (let i = 0; i < length; i++) dst[i] = src[endSample - 1 - i] ?? 0;
  }
  return out;
}

export type AudioPlaybackPlan = {
  /** True when the source slice is time-stretched, then played at 1x so pitch stays. */
  stretch: boolean;
  playRate: number;
  offsetSec: number;
  sourceDurSec: number;
};

/**
 * Schedule for one mix window.
 * Rate 1, forward, not held matches the c3b4206 playbackRate path:
 * offset walks the source, duration is the window times the rate.
 * Any other rate time-stretches first and plays at 1x.
 */
export function audioPlaybackPlan(
  clip: {
    sourceInMs: number;
    rate?: number;
    reversed?: boolean;
    holdSourceMs?: number;
  },
  window: { startMs: number; endMs: number },
  clipStartMs: number,
): AudioPlaybackPlan {
  const held = clip.holdSourceMs != null && Number.isFinite(clip.holdSourceMs);
  const reversed = !held && clip.reversed === true;
  const rate = clampClipRate(clip.rate ?? 1);
  const stretch = !held && Math.abs(rate - 1) > 1e-4;
  const playRate = held || stretch ? 1 : rate;
  const localMs = Math.max(0, window.startMs - clipStartMs);
  const windowMs = Math.max(0, window.endMs - window.startMs);
  const offsetSec =
    held || reversed || stretch
      ? Math.max(0, localMs / 1000)
      : Math.max(0, (clip.sourceInMs + localMs * rate) / 1000);
  return {
    stretch,
    playRate,
    offsetSec,
    sourceDurSec: Math.max(0.01, (windowMs * playRate) / 1000),
  };
}

function bufferFromChannels(ctx: BaseAudioContext, channels: readonly Float32Array[], sampleRate: number): AudioBuffer {
  const length = Math.max(1, channels[0]?.length ?? 1);
  const out = ctx.createBuffer(Math.max(1, channels.length), length, sampleRate);
  for (let ch = 0; ch < channels.length; ch++) out.getChannelData(ch).set(channels[ch]!);
  return out;
}

function stretchSpan(
  ctx: BaseAudioContext,
  decoded: AudioBuffer,
  fromSec: number,
  toSec: number,
  factor: number,
): AudioBuffer {
  const sr = decoded.sampleRate;
  const lo = Math.max(0, Math.min(fromSec, toSec));
  const hi = Math.min(decoded.duration, Math.max(fromSec, toSec));
  const start = Math.min(decoded.length - 1, Math.max(0, Math.floor(lo * sr)));
  const end = Math.min(decoded.length, Math.max(start + 1, Math.ceil(hi * sr)));
  const channels: Float32Array[] = [];
  for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
    channels.push(decoded.getChannelData(ch).subarray(start, end));
  }
  return bufferFromChannels(ctx, timeStretchChannels(channels, sr, factor), sr);
}

function stretchWhole(ctx: BaseAudioContext, decoded: AudioBuffer, factor: number): AudioBuffer {
  const channels: Float32Array[] = [];
  for (let ch = 0; ch < decoded.numberOfChannels; ch++) channels.push(decoded.getChannelData(ch));
  return bufferFromChannels(ctx, timeStretchChannels(channels, decoded.sampleRate, factor), decoded.sampleRate);
}

/** Short loop of the held source time. Playback loops it across the clip. */
function holdGrain(ctx: BaseAudioContext, decoded: AudioBuffer, holdSec: number): AudioBuffer {
  const sr = decoded.sampleRate;
  const grain = Math.max(1, Math.floor(0.04 * sr));
  const origin = Math.min(decoded.length - 1, Math.max(0, Math.floor(Math.max(0, holdSec) * sr)));
  const out = ctx.createBuffer(decoded.numberOfChannels, grain, sr);
  for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
    const src = decoded.getChannelData(ch);
    const dst = out.getChannelData(ch);
    for (let i = 0; i < grain; i++) dst[i] = src[Math.min(src.length - 1, origin + i)] ?? 0;
  }
  return out;
}

export async function mixJobAudio(
  job: ExportJob,
  probe: AacProbe,
  signal?: AbortSignal,
): Promise<AudioBuffer | null> {
  const clips = audioClipsForMix(job).filter((c) => isPlayableSource(c.sourceUrl));
  markAudioStage("AUDIO_MIX_BEGIN");
  updateAudioExportReport({
    sampleRate: probe.sampleRate,
    channels: probe.channels,
    bitrate: probe.bitrate,
    clipCount: clips.length,
  });
  if (clips.length === 0) {
    markAudioStage("AUDIO_MIX_DONE");
    return null;
  }
  const length = Math.max(1, Math.ceil((job.durationMs / 1000) * probe.sampleRate));
  updateAudioExportReport({ offlineFrameLength: length });
  const ctx = new OfflineAudioContext(probe.channels, length, probe.sampleRate);
  let added = 0;
  const mix0 = nowMs();
  for (const clip of clips) {
    if (signal?.aborted) throw new AudioExportError("Export aborted");
    try {
      markAudioStage("AUDIO_DECODE_BEGIN");
      const decoded = await decodeAudio(clip.sourceUrl);
      markAudioStage("AUDIO_DECODE_DONE");
      if (!decodedBufferIsAudible(decoded)) continue;
      const held = clip.holdSourceMs != null && Number.isFinite(clip.holdSourceMs);
      const reversed = !held && clip.reversed === true;
      const rate = clampClipRate(clip.rate ?? 1);
      const stretch = !held && Math.abs(rate - 1) > 1e-4;
      let buffer = held
        ? holdGrain(ctx, decoded, clip.holdSourceMs! / 1000)
        : reversed
          ? sliceReversed(
              ctx,
              decoded,
              Math.min(clip.sourceInMs, clip.sourceOutMs) / 1000,
              Math.max(clip.sourceInMs, clip.sourceOutMs) / 1000,
            )
          : decoded;
      if (stretch) {
        buffer = reversed
          ? stretchWhole(ctx, buffer, 1 / rate)
          : stretchSpan(
              ctx,
              decoded,
              Math.min(clip.sourceInMs, clip.sourceOutMs) / 1000,
              Math.max(clip.sourceInMs, clip.sourceOutMs) / 1000,
              1 / rate,
            );
      }
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const gain = ctx.createGain();
      const peak = Number.isFinite(clip.gain) ? Math.max(0, clip.gain) : 1;
      const durationMs = Math.max(1, clip.endMs - clip.startMs);
      const mates = clip.skipMix ? presentLinkedAudioMates(job, clip) : [];
      const windows = clip.skipMix && mates.length > 0 ? mixWindowsForClip(clip, mates) : [
        { startMs: clip.startMs, endMs: clip.endMs },
      ];
      if (windows.length === 0) continue;
      scheduleGainEnvelope(
        gain.gain,
        clip.startMs,
        durationMs,
        clip.fadeInMs ?? 0,
        clip.fadeOutMs ?? 0,
        peak,
        { startFactor: clip.fadeInFrom, endFactor: clip.fadeOutTo },
      );
      src.connect(gain);
      let tail: AudioNode = gain;
      if (volumeAutomationIsActive(clip.gainKeys)) {
        const keyGain = ctx.createGain();
        keyGain.gain.value = 1;
        scheduleVolumeAutomation(
          keyGain.gain,
          {
            enabled: true,
            points: clip.gainKeys!.points.map((point) => ({
              timeMs: clip.startMs + point.timeMs,
              value: point.value,
            })),
          },
          clip.startMs,
          clip.endMs,
        );
        tail.connect(keyGain);
        tail = keyGain;
      }
      const trackAuto = job.tracks.find((t) => t.id === clip.trackId)?.volumeAutomation;
      let mixOut: AudioNode = tail;
      if (volumeAutomationIsActive(trackAuto)) {
        const autoGain = ctx.createGain();
        autoGain.gain.value = 1;
        scheduleVolumeAutomation(autoGain.gain, trackAuto, clip.startMs, clip.endMs);
        tail.connect(autoGain);
        mixOut = autoGain;
      }
      const transitions = job.transitions ?? [];
      if (transitions.length > 0) {
        const transGain = ctx.createGain();
        const peers = job.tracks.flatMap((t) => t.clips);
        scheduleTransitionAudioGain(
          transGain.gain,
          transitions,
          clip.id,
          clip.startMs,
          clip.endMs,
          undefined,
          peers,
        );
        mixOut.connect(transGain);
        connectTrackPan(ctx, transGain, trackPanOfJob(job, clip.trackId));
      } else {
        connectTrackPan(ctx, mixOut, trackPanOfJob(job, clip.trackId));
      }
      const playRate = held || stretch ? 1 : rate;
      src.playbackRate.value = playRate;
      if (held) src.loop = true;
      const first = windows[0]!;
      const startOne = (w: { startMs: number; endMs: number }, node: AudioBufferSourceNode) => {
        const plan = audioPlaybackPlan(clip, w, clip.startMs);
        node.playbackRate.value = plan.playRate;
        if (held) node.loop = true;
        node.start(Math.max(0, w.startMs / 1000), plan.offsetSec, plan.sourceDurSec);
      };
      startOne(first, src);
      for (let i = 1; i < windows.length; i++) {
        const extra = ctx.createBufferSource();
        extra.buffer = buffer;
        extra.playbackRate.value = playRate;
        extra.connect(gain);
        startOne(windows[i]!, extra);
      }
      added += 1;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (signal?.aborted || /abort/i.test(msg) || e instanceof AudioExportError) throw e;
      /* skip unreadable audio; video-only files drop at decode */
    }
  }
  if (!added) {
    updateAudioExportReport({ mixElapsedMs: nowMs() - mix0 });
    markAudioStage("AUDIO_MIX_DONE");
    return null;
  }
  markAudioStage("AUDIO_MIX_RENDER_BEGIN");
  const rendered = await ctx.startRendering();
  markAudioStage("AUDIO_MIX_RENDER_DONE");
  updateAudioExportReport({
    mixedBufferLength: rendered.length,
    mixedDurationSec: rendered.length / rendered.sampleRate,
    mixElapsedMs: nowMs() - mix0,
  });
  markAudioStage("AUDIO_MIX_DONE");
  return rendered;
}

function stripAdts(data: Uint8Array): Uint8Array {
  if (data.length >= 7 && data[0] === 0xff && (data[1]! & 0xf0) === 0xf0) {
    const hasCrc = (data[1]! & 0x01) === 0;
    return data.subarray(hasCrc ? 9 : 7);
  }
  return data;
}

function descriptionBytes(desc: AllowSharedBufferSource | undefined): Uint8Array | undefined {
  if (!desc) return undefined;
  if (desc instanceof ArrayBuffer) return new Uint8Array(desc);
  if (ArrayBuffer.isView(desc)) {
    return new Uint8Array(desc as ArrayBufferView as Uint8Array);
  }
  return undefined;
}

export async function encodeAac(
  buffer: AudioBuffer,
  probe: AacProbe,
  hooks: ExportHooks = {},
): Promise<{ samples: AacSample[]; description: Uint8Array }> {
  if (typeof AudioEncoder === "undefined" || typeof AudioData === "undefined") {
    throw new AudioExportError("AAC encoder unavailable");
  }

  const samples: AacSample[] = [];
  let description: Uint8Array | undefined;
  let encoderError: Error | undefined;
  const encode0 = nowMs();
  markAudioStage("AAC_ENCODE_BEGIN");
  updateAudioExportReport({
    sampleRate: probe.sampleRate,
    channels: probe.channels,
    bitrate: probe.bitrate,
    aacInputFrames: buffer.length,
  });

  const encoder = new AudioEncoder({
    output: (chunk, meta) => {
      const desc = descriptionBytes(meta?.decoderConfig?.description);
      if (desc && desc.byteLength > 0) description = desc;
      const raw = new Uint8Array(chunk.byteLength);
      chunk.copyTo(raw);
      const data = stripAdts(raw);
      if (data.byteLength === 0) return;
      samples.push({
        data,
        timestampUs: chunk.timestamp,
        durationUs: chunk.duration ?? Math.round((1024 / probe.sampleRate) * 1_000_000),
      });
    },
    error: (e) => {
      encoderError = e;
    },
  });

  try {
    encoder.configure({
      codec: AAC_CODEC,
      numberOfChannels: probe.channels,
      sampleRate: probe.sampleRate,
      bitrate: probe.bitrate,
    });

    const channels = Math.min(probe.channels, buffer.numberOfChannels);
    const frameSize = 1024;
    for (let offset = 0; offset < buffer.length; offset += frameSize) {
      if (hooks.signal?.aborted) throw new AudioExportError("Export aborted");
      if (encoderError) throw encoderError;
      await waitForAudioEncodeQueue(encoder, hooks.signal);
      const frames = Math.min(frameSize, buffer.length - offset);
      const planar = new Float32Array(frames * channels);
      for (let c = 0; c < channels; c++) {
        planar.set(buffer.getChannelData(c).subarray(offset, offset + frames), c * frames);
      }
      const audioData = new AudioData({
        format: "f32-planar",
        sampleRate: buffer.sampleRate,
        numberOfFrames: frames,
        numberOfChannels: channels,
        timestamp: Math.round((offset / buffer.sampleRate) * 1_000_000),
        data: planar,
      });
      encoder.encode(audioData);
      audioData.close();
    }

    if (hooks.signal?.aborted) throw new AudioExportError("Export aborted");
    if (encoderError) throw encoderError;
    markAudioStage("AAC_ENCODE_FLUSH_BEGIN");
    await encoder.flush();
    markAudioStage("AAC_ENCODE_FLUSH_DONE");
    encoder.close();
  } catch (e) {
    try {
      encoder.close();
    } catch {
      /* already closed */
    }
    if (e instanceof AudioExportError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    if (hooks.signal?.aborted || /abort/i.test(msg)) throw new AudioExportError("Export aborted");
    throw new AudioExportError(`AAC encode failed: ${msg}`);
  }

  const encodedBytes = samples.reduce((n, s) => n + s.data.byteLength, 0);
  updateAudioExportReport({
    aacOutputCount: samples.length,
    descriptionBytes: description?.byteLength ?? 0,
    encodedBytes,
    aacElapsedMs: nowMs() - encode0,
  });
  markAudioStage("AAC_ENCODE_DONE");

  if (!description || description.byteLength === 0) {
    throw new AudioExportError("AAC encoder did not emit AudioSpecificConfig description");
  }
  if (!aacAudioSpecificConfigIsUsable(description)) {
    throw new AudioExportError("AAC AudioSpecificConfig unusable");
  }
  if (samples.length === 0) {
    throw new AudioExportError("AAC encoder produced no samples");
  }
  return { samples, description };
}

export function requireAacForMixed(
  job: ExportJob,
  mixed: AudioBuffer | null,
): boolean {
  if (jobExpectsAudio(job)) return true;
  return Boolean(mixed && decodedBufferIsAudible(mixed));
}

export async function prepareJobAudioMix(
  job: ExportJob,
  hooks: ExportHooks = {},
): Promise<{ expects: boolean; probe: AacProbe | null; mixed: AudioBuffer | null }> {
  const expects = jobExpectsAudio(job);
  beginJobAudioReport(job, expects);
  markAudioStage("AUDIO_EXPECTATION_EVALUATED");
  markAudioStage("AUDIO_CLIPS_DISCOVERED");
  const mixFn = hooks.audio?.mixJobAudio ?? mixJobAudio;
  const probeFn = hooks.audio?.probeAac ?? probeAac;
  let probe: AacProbe | null = null;
  try {
    markAudioStage("AAC_PROBE_BEGIN");
    probe = await probeFn();
    markAudioStage("AAC_PROBE_DONE");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (hooks.signal?.aborted || /abort/i.test(msg)) throw new AudioExportError("Export aborted");
    if (expects) throw new AudioExportError(`AAC probe failed: ${msg}`);
    probe = null;
  }
  if (expects && !probe) {
    throw new AudioExportError("AAC encoder unavailable (expectsAudio)");
  }
  const mixLayout = probe ?? { sampleRate: 44100, channels: 2, bitrate: 128_000 };
  const visWantsMix = job.visualizer.enabled && !job.visualizer.muted;
  let mixed: AudioBuffer | null = null;
  if (expects || visWantsMix) {
    try {
      mixed = await mixFn(job, mixLayout, hooks.signal);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (hooks.signal?.aborted || /abort/i.test(msg)) throw new AudioExportError("Export aborted");
      if (expects) {
        throw e instanceof AudioExportError ? e : new AudioExportError(`audio mix failed: ${msg}`);
      }
      mixed = null;
    }
    if (expects && (!mixed || !decodedBufferIsAudible(mixed))) {
      throw new AudioExportError("audio mix produced no buffer (expectsAudio)");
    }
  }
  return { expects, probe, mixed };
}

export async function finalizeExportAudio(
  job: ExportJob,
  mixed: AudioBuffer | null,
  probe: AacProbe | null,
  hooks: ExportHooks = {},
): Promise<{ audioTrack: AacTrack | undefined; encoded: { samples: AacSample[]; description: Uint8Array } | null }> {
  const requireAac = requireAacForMixed(job, mixed);
  if (!requireAac) {
    updateAudioExportReport({ mp4AudioSupplied: false, resultAudio: "none" });
    return { audioTrack: undefined, encoded: null };
  }
  if (!probe) {
    throw new AudioExportError("AAC encoder unavailable (expectsAudio)");
  }
  if (!mixed || !decodedBufferIsAudible(mixed)) {
    throw new AudioExportError("audio mix produced no buffer (expectsAudio)");
  }
  const encode = hooks.audio?.encodeAac ?? encodeAac;
  const encoded = await encode(mixed, probe, hooks);
  if (!encoded.description || encoded.description.byteLength === 0) {
    throw new AudioExportError("AAC encoder did not emit AudioSpecificConfig description");
  }
  if (!aacAudioSpecificConfigIsUsable(encoded.description)) {
    throw new AudioExportError("AAC AudioSpecificConfig unusable");
  }
  if (!encoded.samples || encoded.samples.length === 0) {
    throw new AudioExportError("AAC encoder produced no samples");
  }
  const audioTrack = audioInputForMux(encoded, probe);
  if (!audioTrack) {
    throw new AudioExportError("mux omitted AAC track (expectsAudio)");
  }
  updateAudioExportReport({
    aacOutputCount: encoded.samples.length,
    descriptionBytes: encoded.description.byteLength,
    encodedBytes: encoded.samples.reduce((n, s) => n + s.data.byteLength, 0),
    mp4AudioSupplied: true,
  });
  markAudioStage("AUDIO_TRACK_READY");
  return { audioTrack, encoded };
}

export function formatAudioFail(error: string, report: AudioExportReport = snapshotAudioExportReport()): string {
  const prefixed = error.startsWith("FAIL:") ? error : `FAIL: ${error}`;
  return `${prefixed}\n--- AUDIO-01 ---\n${formatAudioExportReport(report)}`;
}
