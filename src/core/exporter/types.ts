import type { FrontVideoTrackId, MediaKind, TrackId, VisualizerEvent, VisualizerSceneId } from "../models";
import type { Transition } from "../transition";

export interface ExportClip {
  id: string;
  trackId: TrackId;
  kind: MediaKind;
  startMs: number;
  endMs: number;
  sourceUrl: string;
  sourceInMs: number;
  sourceOutMs: number;
  gain: number;
  /** Clip gain for picture alpha. Mute/fader/master stay on `gain` (audio). */
  videoGain?: number;
  fadeInMs: number;
  fadeOutMs: number;
  /** Factor at job-local 0 when IN starts mid fade-in (omit = classic 0). */
  fadeInFrom?: number;
  /** Factor at job-local end when OUT ends mid fade-out (omit = classic 0). */
  fadeOutTo?: number;
  rate: number;
  /** Missing = forward. Source in/out are already the window's source times. */
  reversed?: boolean;
  /** Missing = play the window. Set = sample this source time for every frame. */
  holdSourceMs?: number;
  missing: boolean;
  label: string;
  linkId?: string;
  /** Image asset on a video lane — picture only, no decode/mix. */
  still?: boolean;
  /** True when a living linked A mate (enabled, disabled, or muted) carries the sound. */
  skipMix?: boolean;
  /** From MediaAsset.hasAudio when known. false = video-only file (no embedded audio). */
  hasAudio?: boolean;
}

export interface ExportTrack {
  id: TrackId;
  kind: MediaKind;
  /** −1 L … +1 R. Applied last on this track’s mix contribution. */
  pan: number;
  /** Raw project mute flag (diagnostics). Mix already baked via isTrackAudible. */
  muted?: boolean;
  /** Raw project solo flag (diagnostics). */
  solo?: boolean;
  /** Raw project fader (diagnostics). Mix already baked into clip.gain. */
  volume?: number;
  clips: ExportClip[];
  /** Export-local volume envelope. Missing / disabled = identity (prior mix). */
  volumeAutomation?: { enabled: boolean; points: { timeMs: number; value: number }[] };
}

export interface ExportVisualizer {
  enabled: boolean;
  muted: boolean;
  sceneId: VisualizerSceneId;
  startMs?: number;
  durationMs?: number;
  events?: VisualizerEvent[];
}

export interface ExportJob {
  id: string;
  projectId: string;
  projectName: string;
  startMs: number;
  endMs: number;
  durationMs: number;
  width: number;
  height: number;
  fps: number;
  fileName: string;
  tracks: ExportTrack[];
  visualizer: ExportVisualizer;
  /** Job-relative startMs (shifted by export IN). */
  transitions?: Transition[];
  frontVideoTrackId?: FrontVideoTrackId;
}

export interface ExportProgress {
  percent: number;
  stage: string;
  currentTimeMs?: number;
  visFrames?: number;
  afeFrames?: number;
  blackFrames?: number;
  videoFramesRequested?: number;
  videoFramesDecoded?: number;
  videoFramesEncoded?: number;
  visFramesEncoded?: number;
  blackFramesEncoded?: number;
  recoveryAttempts?: number;
  decoderFlushes?: number;
  decoderResets?: number;
}

export type ExportAudioKind = "aac" | "wav" | "none";

export interface ExportResult {
  success: boolean;
  aborted?: boolean;
  error?: string;
  fileName: string;
  durationMs: number;
  fileSizeBytes: number;
  mimeType?: string;
  blob?: Blob;
  brands?: string[];
  audio?: ExportAudioKind;
  expectsAudio?: boolean;
  audioReport?: import("./audio-trace").AudioExportReport;
  videoFramesRequested?: number;
  videoFramesDecoded?: number;
  videoFramesEncoded?: number;
  visFramesEncoded?: number;
  blackFramesEncoded?: number;
}

export interface ExportAudioTestHooks {
  mixJobAudio?: (
    job: ExportJob,
    probe: { sampleRate: number; channels: number; bitrate: number },
    signal?: AbortSignal,
  ) => Promise<AudioBuffer | null>;
  encodeAac?: (
    buffer: AudioBuffer,
    probe: { sampleRate: number; channels: number; bitrate: number },
    hooks?: ExportHooks,
  ) => Promise<{ samples: { data: Uint8Array; timestampUs: number; durationUs: number }[]; description: Uint8Array }>;
  probeAac?: () => Promise<{ sampleRate: number; channels: number; bitrate: number } | null>;
}

export interface ExportHooks {
  onProgress?: (progress: ExportProgress) => void;
  signal?: AbortSignal;
  /** Test-only overrides. Production callers omit. */
  audio?: ExportAudioTestHooks;
}
