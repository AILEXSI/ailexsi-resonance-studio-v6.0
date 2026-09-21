/**
 * READ presentation — untrusted provider text over trusted inspect evidence.
 * Evidence is factual. Presentation never mutates Project / History / transactions.
 */
import { formatTimecode } from "../../core/models";
import {
  parseDirectorResponse,
  looksLikePreparedMoveClaim,
  DIRECTOR_MUTATING_TOOL,
} from "./contract";
import { orchestrateChat, type Orchestrator } from "./orchestrator";
import type { AIProvider, ChatMessage } from "./providers/types";
import type { ToolResult } from "./tools/types";
import {
  foldInspectPrompt,
  type InspectRangeDto,
} from "./tools/inspect-range";

export type InspectReplyLocale = "de" | "en";

export type InspectPresentationSource =
  | "provider"
  | "fallback"
  | "rejected-write"
  | "inspect-error";

export interface DirectorReadEvidence {
  toolName: string;
  result: ToolResult & { projectRevision: number };
  presentation: {
    source: InspectPresentationSource;
    reason?: string;
  };
}

export interface InspectPresentationResult {
  text: string;
  source: InspectPresentationSource;
  reason?: string;
}

const READ_PRESENTATION_PROMPT = [
  "You present trusted Resonance Director READ evidence.",
  'Reply with JSON only: {"message":"string"}.',
  "Do not include toolRequest. This is READ only. No mutation.",
  "Use only facts present in the evidence. Do not invent clips, markers, selection, or media meaning.",
  "Answer in the user's language when it is German or English.",
].join(" ");

const RAW_JSON_RE = /\{\s*"ok"\s*:|"data"\s*:|"projectRevision"\s*:|"hash"\s*:/;
const INVENTED_MEDIA_RE =
  /\b(beat drop|the video shows|film scene|music drop|audio waveform|pcm|transcript)\b/i;
const MUTATION_CLAIM_RE =
  /\b(moved|applied|committed|deleted|geschnitten|verschoben)\b/i;
const EMPTY_RANGE_RE =
  /\b(empty|keine|nichts|leer|no clips|0 clips|keine[n]? clips)\b/i;
const ZERO_MARKER_RE =
  /\b(0\s+markers?|no\s+markers?|keine[n]?\s+marker|ohne\s+marker|keine[n]?\s+markern)\b/i;

export function inspectReplyLocale(userText: string): InspectReplyLocale {
  const n = foldInspectPrompt(userText);
  if (
    n.includes("was ") ||
    n.includes("zeig") ||
    n.includes("liegt") ||
    n.includes("befindet") ||
    n.includes("zwischen") ||
    n.includes("rund um") ||
    n.includes("markiert") ||
    n.includes("sekunde") ||
    n.includes("bereich")
  ) {
    return "de";
  }
  return "en";
}

export function formatInspectFailure(
  result: Extract<ToolResult, { ok: false }>,
  userText: string,
): string {
  const locale = inspectReplyLocale(userText);
  if (locale === "de") {
    return `Inspect fehlgeschlagen: ${result.code}. ${result.message} Keine Projektänderung.`;
  }
  return `Inspect failed: ${result.code}. ${result.message} No project changes were made.`;
}

export function formatReadWriteRejection(userText: string): string {
  const locale = inspectReplyLocale(userText);
  if (locale === "de") {
    return `READ-Antwort darf ${DIRECTOR_MUTATING_TOOL} nicht anfordern. Keine Projektänderung.`;
  }
  return `READ presentation cannot request ${DIRECTOR_MUTATING_TOOL}. No project changes were made.`;
}

export function formatInspectRangeReply(dto: InspectRangeDto, userText: string): string {
  const locale = inspectReplyLocale(userText);
  const from = formatTimecode(dto.range.fromMs);
  const to = formatTimecode(dto.range.toMs);
  const playhead = formatTimecode(dto.playheadMs);
  const clipLines = dto.clips.map((clip) => {
    const span = `${formatTimecode(clip.startMs)}–${formatTimecode(clip.endMs)}`;
    if (locale === "de") {
      return `${clip.clipId} (${clip.trackId}, ${span}${clip.selected ? ", ausgewählt" : ""})`;
    }
    return `${clip.clipId} (${clip.trackId}, ${span}${clip.selected ? ", selected" : ""})`;
  });
  const selected = dto.selection.clipIds;
  const markers = dto.markers.map((marker) => {
    const at = formatTimecode(marker.timeMs);
    return `${marker.label} (${marker.markerId} @ ${at})`;
  });

  if (locale === "de") {
    const lines = [
      `Im Bereich ${from}–${to}: ${dto.counts.clips} Clip(s), ${dto.counts.markers} Marker, ${dto.counts.gaps} Lücke(n).`,
    ];
    if (clipLines.length === 0) {
      lines.push("Keine Clips in diesem Bereich.");
    } else {
      lines.push(`Clips: ${clipLines.join("; ")}.`);
    }
    lines.push(
      selected.length === 0
        ? "Auswahl: keine."
        : `Auswahl: ${selected.join(", ")}${dto.selection.primaryClipId ? ` (primary ${dto.selection.primaryClipId})` : ""}.`,
    );
    lines.push(`Playhead: ${playhead}.`);
    if (markers.length === 0) {
      lines.push("Keine Marker.");
    } else {
      lines.push(`Marker: ${markers.join("; ")}.`);
    }
    return lines.join(" ");
  }

  const lines = [
    `In range ${from}–${to}: ${dto.counts.clips} clip(s), ${dto.counts.markers} marker(s), ${dto.counts.gaps} gap(s).`,
  ];
  if (clipLines.length === 0) {
    lines.push("No clips in this range.");
  } else {
    lines.push(`Clips: ${clipLines.join("; ")}.`);
  }
  lines.push(
    selected.length === 0
      ? "Selection: none."
      : `Selection: ${selected.join(", ")}${dto.selection.primaryClipId ? ` (primary ${dto.selection.primaryClipId})` : ""}.`,
  );
  lines.push(`Playhead: ${playhead}.`);
  if (markers.length === 0) {
    lines.push("No markers.");
  } else {
    lines.push(`Markers: ${markers.join("; ")}.`);
  }
  return lines.join(" ");
}

export function looksLikeRawInspectJson(text: string): boolean {
  return RAW_JSON_RE.test(text);
}

export type InspectGrounding =
  | { ok: true; text: string }
  | { ok: false; reason: "unsupported-claim" | "tool-request" | "empty" | "not-a-presentation" };

export function groundInspectPresentation(text: string, dto: InspectRangeDto): InspectGrounding {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, reason: "empty" };
  if (looksLikeRawInspectJson(trimmed)) return { ok: false, reason: "not-a-presentation" };
  if (looksLikePreparedMoveClaim(trimmed) || new RegExp(DIRECTOR_MUTATING_TOOL.replace(".", "\\.")).test(trimmed)) {
    return { ok: false, reason: "tool-request" };
  }
  if (MUTATION_CLAIM_RE.test(trimmed) || INVENTED_MEDIA_RE.test(trimmed)) {
    return { ok: false, reason: "unsupported-claim" };
  }
  if (mentionsUnsupportedClip(trimmed, dto) || mentionsUnsupportedMarker(trimmed, dto)) {
    return { ok: false, reason: "unsupported-claim" };
  }
  if (claimsUnselectedClipSelected(trimmed, dto)) {
    return { ok: false, reason: "unsupported-claim" };
  }
  if (!coversInspectEvidence(trimmed, dto)) {
    return { ok: false, reason: "not-a-presentation" };
  }
  return { ok: true, text: trimmed };
}

function foldToken(value: string): string {
  return foldInspectPrompt(value).replace(/\s+/g, "");
}

function allowedClipIds(dto: InspectRangeDto): Set<string> {
  const ids = new Set<string>();
  for (const clip of dto.clips) ids.add(clip.clipId);
  for (const id of dto.selection.clipIds) ids.add(id);
  if (dto.selection.primaryClipId) ids.add(dto.selection.primaryClipId);
  return ids;
}

function mentionsUnsupportedClip(text: string, dto: InspectRangeDto): boolean {
  const allowed = allowedClipIds(dto);
  const mentioned = text.match(/\bclip_[A-Za-z0-9]+\b/g) ?? [];
  return mentioned.some((id) => !allowed.has(id));
}

function mentionsUnsupportedMarker(text: string, dto: InspectRangeDto): boolean {
  const allowed = new Set(
    dto.markers.flatMap((marker) => [foldToken(marker.markerId), foldToken(marker.label)].filter(Boolean)),
  );
  const labeled = [
    ...(text.match(/\bmarkers?\b[:\s]+([A-Za-z0-9_-]+)/gi) ?? []),
    ...(text.match(/\b([A-Z][A-Z0-9_-]{1,31})\s+markers?\b/g) ?? []),
    ...(text.match(/\bmarkern?\b[:\s]+([A-Za-z0-9_-]+)/gi) ?? []),
  ];
  for (const raw of labeled) {
    const token = raw.replace(/markers?|markern?/gi, "").replace(/[:\s]+/g, "").trim();
    const n = foldToken(token);
    if (!n || n === "0" || n === "no" || n === "keine" || n === "keinen" || n === "ohne") continue;
    if (!allowed.has(n)) return true;
  }
  if (/\bdrop\b/i.test(text) && !allowed.has("drop")) return true;
  if (dto.markers.length === 0 && /\bmarkers?\b|\bmarkern\b/i.test(text) && !ZERO_MARKER_RE.test(text)) {
    return true;
  }
  return false;
}

function claimsUnselectedClipSelected(text: string, dto: InspectRangeDto): boolean {
  const folded = foldInspectPrompt(text);
  return dto.clips.some((clip) => {
    if (clip.selected) return false;
    const id = foldToken(clip.clipId);
    if (!id || !folded.includes(id)) return false;
    const ownClause = new RegExp(
      `${id}(?:\\s*\\([^)]*(?:selected|ausgewahl|markiert)|\\s+(?:is\\s+|ist\\s+)?(?:selected|ausgewahlt|markiert))`,
    );
    return ownClause.test(folded);
  });
}

function coversInspectEvidence(text: string, dto: InspectRangeDto): boolean {
  if (dto.clips.length > 0) {
    return dto.clips.some((clip) => text.includes(clip.clipId));
  }
  return EMPTY_RANGE_RE.test(text) || dto.counts.clips === 0 && /0/.test(text);
}

export function buildInspectPresentationMessages(
  userText: string,
  dto: InspectRangeDto,
): ChatMessage[] {
  return [
    { role: "system", content: READ_PRESENTATION_PROMPT },
    { role: "system", content: JSON.stringify({ evidence: dto }) },
    { role: "user", content: userText },
  ];
}

export async function presentInspectRead(opts: {
  dto: InspectRangeDto;
  userText: string;
  provider?: AIProvider;
  orchestrator?: Orchestrator;
  signal?: AbortSignal;
}): Promise<InspectPresentationResult> {
  const fallback = formatInspectRangeReply(opts.dto, opts.userText);
  if (!opts.provider || !opts.orchestrator) {
    return { text: fallback, source: "fallback", reason: "no-provider" };
  }

  try {
    const outcome = await orchestrateChat(
      opts.provider,
      buildInspectPresentationMessages(opts.userText, opts.dto),
      opts.orchestrator,
      opts.signal,
    );
    if (outcome.kind === "stale") {
      return { text: fallback, source: "fallback", reason: "stale" };
    }
    if (outcome.kind === "error") {
      return { text: fallback, source: "fallback", reason: outcome.error.code };
    }
    const parsed = parseDirectorResponse(outcome.response.text);
    if (!parsed.ok) {
      return { text: fallback, source: "fallback", reason: "invalid-response" };
    }
    if (parsed.toolRequest) {
      return {
        text: formatReadWriteRejection(opts.userText),
        source: "rejected-write",
        reason: parsed.toolRequest.name,
      };
    }
    const grounded = groundInspectPresentation(parsed.message, opts.dto);
    if (!grounded.ok) {
      if (grounded.reason === "tool-request") {
        return {
          text: formatReadWriteRejection(opts.userText),
          source: "rejected-write",
          reason: grounded.reason,
        };
      }
      return { text: fallback, source: "fallback", reason: grounded.reason };
    }
    return { text: grounded.text, source: "provider" };
  } catch {
    return { text: fallback, source: "fallback", reason: "provider-error" };
  }
}
