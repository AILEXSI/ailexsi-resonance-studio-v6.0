export const CONTEXT_LEVELS = [
  "NONE",
  "SELECTION",
  "PLAYHEAD",
  "TRACK",
  "PROJECT",
  "CUSTOM",
] as const;

export type ContextLevel = (typeof CONTEXT_LEVELS)[number];

export const OUTBOUND_CLASSES = [
  "SEND_NONE",
  "SEND_IDS",
  "SEND_STRUCTURE",
  "SEND_ANALYSIS",
  "SEND_MEDIA_METADATA",
] as const;

export type OutboundClass = (typeof OUTBOUND_CLASSES)[number];

/** Forbidden. No API accepts this class. */
export const SEND_RAW_MEDIA = "SEND_RAW_MEDIA" as const;

export interface ContextSelection {
  readonly clipIds: readonly string[];
  readonly primaryClipId: string | null;
  readonly trackIds: readonly string[];
}

export interface ContextClipStructure {
  readonly clipId: string;
  readonly trackId: string;
  readonly startMs: number;
  readonly durationMs: number;
  readonly locked: boolean;
}

export interface ContextProjectSummary {
  readonly name: string;
  readonly durationMs: number;
  readonly clipCount: number;
  readonly trackCount: number;
}

export interface ContextAnalysisHint {
  readonly clipId: string | null;
  readonly timeMs: number;
}

export interface ContextMediaMetadata {
  readonly assetId: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly durationMs: number;
  readonly missing: boolean;
}

export interface AIContextSnapshot {
  readonly id: string;
  readonly projectId: string;
  readonly selection: ContextSelection;
  readonly playheadMs: number;
  readonly activeTrack: string;
  readonly projectSummary?: ContextProjectSummary;
  readonly analysisHint?: ContextAnalysisHint;
  readonly structure?: readonly ContextClipStructure[];
  readonly mediaMetadata?: readonly ContextMediaMetadata[];
  readonly createdAt: number;
  readonly level: ContextLevel;
  readonly outboundClass: OutboundClass;
}
