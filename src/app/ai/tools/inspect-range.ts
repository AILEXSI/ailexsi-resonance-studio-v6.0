/**
 * timeline.inspect_range — Resonance-owned READ perception.
 * Composes existing Project / Session facts. Never mutates Project.
 */
import {
  clipEndMs,
  clipIsEnabled,
  clipIsLocked,
  clipRateOf,
  isTrackId,
  kindOfTrack,
  orderedTracks,
  parseTimecode,
  projectDurationMs,
  type Clip,
  type Project,
  type Track,
} from "../../../core/models";
import {
  canonicalClipSelection,
  projectRevisionOf,
  type Session,
} from "../../session";
import type { ToolError, ToolResult } from "./types";

export const INSPECT_RANGE_TOOL = "timeline.inspect_range";
export const INSPECT_PLAYHEAD_WINDOW_MS = 8000;
export const INSPECT_PROJECT_SPAN_MAX_CLIPS = 64;

export interface InspectRangeArgs {
  fromMs?: number;
  toMs?: number;
  trackIds?: string[];
  maxClips?: number;
}

export interface InspectRangeDto {
  projectId: string;
  projectRevision: number;
  schemaVersion: Project["schemaVersion"];
  range: { fromMs: number; toMs: number };
  playheadMs: number;
  inPointMs: number | null;
  outPointMs: number | null;
  loop: boolean;
  selection: {
    clipIds: string[];
    primaryClipId: string | null;
    markerId: string | null;
  };
  tracks: Array<{ trackId: string; kind: Track["kind"]; name: string }>;
  clips: Array<{
    clipId: string;
    trackId: string;
    kind: Track["kind"];
    startMs: number;
    durationMs: number;
    endMs: number;
    sourceInMs: number;
    sourceOutMs: number;
    rate: number;
    fadeInMs: number;
    fadeOutMs: number;
    gain: number;
    locked: boolean;
    enabled: boolean;
    selected: boolean;
    linkId?: string;
  }>;
  markers: Array<{ markerId: string; timeMs: number; label: string }>;
  gaps: Array<{ trackId: string; startMs: number; endMs: number }>;
  overlaps: Array<{ trackId: string; a: string; b: string; fromMs: number; toMs: number }>;
  counts: { clips: number; markers: number; gaps: number; omitted?: number };
  hash: string;
}

function deny(code: ToolError["code"], message: string): ToolError {
  return { ok: false, code, message };
}

function isToolError(value: unknown): value is ToolError {
  return Boolean(value && typeof value === "object" && (value as ToolError).ok === false);
}

function isExactIntegerMs(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

/** FNV-1a over canonical JSON. No Date.now / random / UI-only fields. */
export function stableInspectHash(value: unknown): string {
  const json = JSON.stringify(value);
  let hash = 0x811c9dc5;
  for (let i = 0; i < json.length; i += 1) {
    hash ^= json.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function clipOverlapsRange(clip: Clip, fromMs: number, toMs: number): boolean {
  return clip.startMs < toMs && clipEndMs(clip) > fromMs;
}

function resolveTrackFilter(
  project: Project,
  trackIds: string[] | undefined,
): Track[] | ToolError {
  const ordered = orderedTracks(project);
  if (trackIds == null) return ordered;
  if (!Array.isArray(trackIds) || trackIds.length === 0) {
    return deny("INVALID_ARGS", "trackIds must be a non-empty string array");
  }
  const resolved: Track[] = [];
  const seen = new Set<string>();
  for (const id of trackIds) {
    if (typeof id !== "string" || !id) {
      return deny("INVALID_ARGS", "trackIds must be strings");
    }
    if (id === "VIS" || id === "master" || !isTrackId(id)) {
      return deny("INVALID_ARGS", "Display names are not ids");
    }
    if (seen.has(id)) continue;
    seen.add(id);
    const track = ordered.find((t) => t.id === id);
    if (!track) return deny("UNKNOWN_TRACK", `Track not found: ${id}`);
    resolved.push(track);
  }
  return resolved;
}

function selectedClipUnionMs(session: Session): { fromMs: number; toMs: number } | null {
  const selected = canonicalClipSelection(session).clipIds
    .map((id) => session.project.clips.find((c) => c.id === id))
    .filter((c): c is Clip => Boolean(c));
  if (selected.length === 0) return null;
  let fromMs = Number.POSITIVE_INFINITY;
  let toMs = Number.NEGATIVE_INFINITY;
  for (const clip of selected) {
    fromMs = Math.min(fromMs, clip.startMs);
    toMs = Math.max(toMs, clipEndMs(clip));
  }
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs >= toMs) return null;
  return { fromMs, toMs };
}

function playheadWindowMs(project: Project): { fromMs: number; toMs: number } | null {
  if (!Number.isFinite(project.playheadMs)) return null;
  const durationMs = projectDurationMs(project);
  const fromMs = Math.max(0, Math.round(project.playheadMs) - INSPECT_PLAYHEAD_WINDOW_MS);
  const toMs = Math.min(durationMs, Math.round(project.playheadMs) + INSPECT_PLAYHEAD_WINDOW_MS);
  if (fromMs >= toMs) return null;
  return { fromMs, toMs };
}

function resolveRange(
  session: Session,
  args: InspectRangeArgs,
): { fromMs: number; toMs: number; projectSpan: boolean } | ToolError {
  const hasFrom = args.fromMs !== undefined;
  const hasTo = args.toMs !== undefined;
  if (hasFrom !== hasTo) {
    return deny("INVALID_ARGS", "fromMs and toMs must be provided together");
  }
  if (hasFrom && hasTo) {
    if (!isExactIntegerMs(args.fromMs) || !isExactIntegerMs(args.toMs)) {
      return deny("INVALID_ARGS", "fromMs and toMs must be integer milliseconds");
    }
    if (args.fromMs < 0 || args.toMs < 0) {
      return deny("INVALID_ARGS", "fromMs and toMs must be >= 0");
    }
    if (args.fromMs >= args.toMs) {
      return deny("INVALID_ARGS", "fromMs must be less than toMs");
    }
    return { fromMs: args.fromMs, toMs: args.toMs, projectSpan: false };
  }

  const selected = selectedClipUnionMs(session);
  if (selected) return { ...selected, projectSpan: false };

  const aroundPlayhead = playheadWindowMs(session.project);
  if (aroundPlayhead) return { ...aroundPlayhead, projectSpan: false };

  const durationMs = projectDurationMs(session.project);
  if (durationMs <= 0) {
    return deny("INVALID_ARGS", "Inspect range is empty");
  }
  return { fromMs: 0, toMs: durationMs, projectSpan: true };
}

function gapsOnTrack(
  trackId: string,
  clips: readonly Clip[],
  fromMs: number,
  toMs: number,
): Array<{ trackId: string; startMs: number; endMs: number }> {
  const occupied = clips
    .filter((c) => c.trackId === trackId)
    .map((c) => ({
      startMs: Math.max(fromMs, c.startMs),
      endMs: Math.min(toMs, clipEndMs(c)),
    }))
    .filter((span) => span.endMs > span.startMs)
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);

  const merged: Array<{ startMs: number; endMs: number }> = [];
  for (const span of occupied) {
    const last = merged[merged.length - 1];
    if (last && span.startMs <= last.endMs) {
      last.endMs = Math.max(last.endMs, span.endMs);
    } else {
      merged.push({ ...span });
    }
  }

  const gaps: Array<{ trackId: string; startMs: number; endMs: number }> = [];
  let cursor = fromMs;
  for (const span of merged) {
    if (span.startMs > cursor) {
      gaps.push({ trackId, startMs: cursor, endMs: span.startMs });
    }
    cursor = Math.max(cursor, span.endMs);
  }
  if (cursor < toMs) gaps.push({ trackId, startMs: cursor, endMs: toMs });
  return gaps;
}

function overlapsOnTrack(
  trackId: string,
  clips: readonly Clip[],
  fromMs: number,
  toMs: number,
): Array<{ trackId: string; a: string; b: string; fromMs: number; toMs: number }> {
  const onTrack = clips
    .filter((c) => c.trackId === trackId)
    .slice()
    .sort((a, b) => a.startMs - b.startMs || a.id.localeCompare(b.id));
  const overlaps: Array<{ trackId: string; a: string; b: string; fromMs: number; toMs: number }> = [];
  for (let i = 0; i < onTrack.length; i += 1) {
    const a = onTrack[i]!;
    for (let j = i + 1; j < onTrack.length; j += 1) {
      const b = onTrack[j]!;
      const overlapFrom = Math.max(a.startMs, b.startMs, fromMs);
      const overlapTo = Math.min(clipEndMs(a), clipEndMs(b), toMs);
      if (overlapTo > overlapFrom) {
        overlaps.push({ trackId, a: a.id, b: b.id, fromMs: overlapFrom, toMs: overlapTo });
      }
    }
  }
  return overlaps;
}

export function inspectTimelineRange(session: Session, args: InspectRangeArgs = {}): ToolResult<InspectRangeDto> {
  if (args.maxClips !== undefined) {
    if (!isExactIntegerMs(args.maxClips) || args.maxClips <= 0) {
      return deny("INVALID_ARGS", "maxClips must be a positive integer");
    }
  }

  const tracksOrErr = resolveTrackFilter(session.project, args.trackIds);
  if (isToolError(tracksOrErr)) return tracksOrErr;
  const tracks = tracksOrErr;
  const trackIds = new Set(tracks.map((t) => t.id));

  const rangeOrErr = resolveRange(session, args);
  if (isToolError(rangeOrErr)) return rangeOrErr;
  const { fromMs, toMs, projectSpan } = rangeOrErr;

  const trackOrder = new Map(tracks.map((t, i) => [t.id, i]));
  const overlapping = session.project.clips.filter(
    (c) => trackIds.has(c.trackId) && clipOverlapsRange(c, fromMs, toMs),
  );
  overlapping.sort((a, b) => {
    const ta = trackOrder.get(a.trackId) ?? Number.MAX_SAFE_INTEGER;
    const tb = trackOrder.get(b.trackId) ?? Number.MAX_SAFE_INTEGER;
    if (ta !== tb) return ta - tb;
    if (a.startMs !== b.startMs) return a.startMs - b.startMs;
    return a.id.localeCompare(b.id);
  });

  const cap = args.maxClips ?? (projectSpan ? INSPECT_PROJECT_SPAN_MAX_CLIPS : undefined);
  if (cap != null && overlapping.length > cap) {
    return deny(
      "INVALID_ARGS",
      `maxClips exceeded: ${overlapping.length} clips in range (max ${cap})`,
    );
  }

  const selectedIds = new Set(canonicalClipSelection(session).clipIds);
  const canonical = canonicalClipSelection(session);

  const clipDtos = overlapping.map((clip) => {
    const dto: InspectRangeDto["clips"][number] = {
      clipId: clip.id,
      trackId: clip.trackId,
      kind: kindOfTrack(clip.trackId),
      startMs: clip.startMs,
      durationMs: clip.durationMs,
      endMs: clipEndMs(clip),
      sourceInMs: clip.sourceInMs,
      sourceOutMs: clip.sourceOutMs,
      rate: clipRateOf(clip),
      fadeInMs: clip.fadeInMs,
      fadeOutMs: clip.fadeOutMs,
      gain: clip.gain,
      locked: clipIsLocked(clip),
      enabled: clipIsEnabled(clip),
      selected: selectedIds.has(clip.id),
    };
    if (clip.linkId) dto.linkId = clip.linkId;
    return dto;
  });

  const markers = session.project.markers
    .filter((m) => m.timeMs >= fromMs && m.timeMs < toMs)
    .slice()
    .sort((a, b) => a.timeMs - b.timeMs || a.id.localeCompare(b.id))
    .map((m) => ({ markerId: m.id, timeMs: m.timeMs, label: m.label }));

  const clipsWithTrackHits = new Set(overlapping.map((c) => c.trackId));
  const gaps = tracks
    .filter((t) => clipsWithTrackHits.has(t.id))
    .flatMap((t) => gapsOnTrack(t.id, overlapping, fromMs, toMs));
  const overlaps = tracks.flatMap((t) => overlapsOnTrack(t.id, overlapping, fromMs, toMs));

  const semantic = {
    projectId: session.project.id,
    projectRevision: projectRevisionOf(session),
    schemaVersion: session.project.schemaVersion,
    range: { fromMs, toMs },
    playheadMs: session.project.playheadMs,
    inPointMs: session.project.inPointMs,
    outPointMs: session.project.outPointMs,
    loop: session.project.loop,
    selection: {
      clipIds: [...canonical.clipIds],
      primaryClipId: canonical.primaryId,
      markerId: session.selectedMarkerId,
    },
    tracks: tracks.map((t) => ({ trackId: t.id, kind: t.kind, name: t.name })),
    clips: clipDtos,
    markers,
    gaps,
    overlaps,
    counts: {
      clips: clipDtos.length,
      markers: markers.length,
      gaps: gaps.length,
    },
  };

  const dto: InspectRangeDto = {
    ...semantic,
    hash: stableInspectHash(semantic),
  };
  return { ok: true, data: dto };
}

/** Keep colons so 1:30 stays a timecode (normalizeDirectorPrompt strips them). */
export function foldInspectPrompt(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/ö/g, "o")
    .replace(/ä/g, "a")
    .replace(/ü/g, "u")
    .replace(/ß/g, "ss")
    .replace(/[?!.,;]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function hasInspectCue(n: string): boolean {
  if (n.includes("was passiert") || n.includes("what happens") || n.includes("what is happening") || n.includes("whats happening")) {
    return true;
  }
  if (n.includes("was liegt") || n.includes("what lies") || n.includes("what is around") || n.includes("whats around")) {
    return true;
  }
  if (n.includes("was befindet") || n.includes("inspect")) return true;
  if (n.includes("timeline-bereich") || n.includes("timeline bereich") || n.includes("timeline range")) {
    return true;
  }
  const mentionsTimeline = n.includes("timeline") || n.includes("bereich") || n.includes("range");
  if ((n.includes("zeig") || n.includes("show")) && mentionsTimeline) return true;
  return false;
}

function asksPlayheadNeighborhood(n: string): boolean {
  if (!n.includes("playhead")) return false;
  return n.includes("rund um") || n.includes("around") || n.includes("um den") || n.includes("um die");
}

function asksSelectedClipNeighborhood(n: string): boolean {
  return (
    n.includes("um den markierten") ||
    n.includes("um die markierte") ||
    n.includes("around the selected") ||
    n.includes("around the marked") ||
    n.includes("around the selected clip") ||
    n.includes("um den markierten clip")
  );
}

function parseInspectTimes(n: string): { fromMs: number; toMs: number } | null {
  const timecode = n.match(
    /(?:zwischen|von|from|between)\s+(\d{1,2}:\d{2}(?:\.\d+)?)\s+(?:und|bis|and|to)\s+(\d{1,2}:\d{2}(?:\.\d+)?)/,
  );
  if (timecode) {
    const fromMs = parseTimecode(timecode[1]!);
    const toMs = parseTimecode(timecode[2]!);
    if (fromMs == null || toMs == null || fromMs >= toMs) return null;
    return { fromMs, toMs };
  }

  const seconds = n.match(
    /(?:zwischen|von|from|between)\s+(?:sekunde|sekunden|second|seconds)?\s*(\d{1,4})\s+(?:und|bis|and|to)\s+(?:sekunde|sekunden|second|seconds)?\s*(\d{1,4})(?:\s*(?:sekunden|seconds|sekunde|second))?/,
  );
  if (seconds) {
    const a = Number(seconds[1]);
    const b = Number(seconds[2]);
    if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || a < 0 || b < 0 || a >= b) {
      return null;
    }
    return { fromMs: a * 1000, toMs: b * 1000 };
  }
  return null;
}

/**
 * Explicit range-inspect prompts only. Unclear ranges fail closed (null).
 * Empty args → tool default range (selection union, else playhead ± 8s, else project span).
 */
export function parseInspectRangePrompt(text: string): InspectRangeArgs | null {
  const n = foldInspectPrompt(text);
  if (!n || !hasInspectCue(n)) return null;
  const explicit = parseInspectTimes(n);
  if (explicit) return explicit;
  if (asksPlayheadNeighborhood(n) || asksSelectedClipNeighborhood(n)) return {};
  return null;
}
