import type { EditorCommand } from "../../commands";
import { selectionOf, type Session } from "../../session";
import { DEFAULT_FADE_MS } from "../../../core/fades";
import { editableLinkedMate } from "../../../core/link";
import { CLIP_RATE_MAX, CLIP_RATE_MIN, clipById, clipIsLocked, kindOfTrack, SPLIT_EDGE_GUARD_MS } from "../../../core/models";
import type { BeatAnalysis } from "../audio/beats";
import { previewPlan, type PlanStep } from "../preview";
import { toolErr, toolOk, type ToolResult } from "./result";

export const AUDIO_CROSSFADE_MS = 200;

export const MUTATION_TOOL_NAMES = [
  "timeline.move_clip",
  "timeline.split_at_playhead",
  "timeline.lift_delete",
  "timeline.trim",
  "timeline.ripple_delete",
  "timeline.add_fade",
  "timeline.set_speed",
  "timeline.nudge",
  "timeline.split_at_markers",
  "audio.detect_beats",
  "lyrics.suggest_scenes",
] as const;

export type MutationToolName = (typeof MUTATION_TOOL_NAMES)[number];

export function isMutationToolName(name: string): name is MutationToolName {
  return (MUTATION_TOOL_NAMES as readonly string[]).includes(name);
}

export interface MutationProposal {
  tool: MutationToolName;
  summary: string;
  /** Steps a later Accept may replay. AI-3 does not replay them onto the live session. */
  steps: PlanStep[];
  /** The editor command a human can read. Exact moves are `moveClips`, never nudge. */
  command: EditorCommand;
  /** Scratch replay keeps detected marker times instead of snapping them. */
  exactMarkerTimes?: boolean;
  /** Accept keeps the clip selection. Marker adds clear it on the scratch session. */
  preserveSelection?: boolean;
}

function argsOf(args: unknown): Record<string, unknown> {
  if (!args || typeof args !== "object" || Array.isArray(args)) return {};
  return args as Record<string, unknown>;
}

function finiteNumber(value: unknown, label: string): { ok: true; ms: number } | { ok: false; error: string } {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { ok: false, error: `${label} must be a finite number of milliseconds` };
  }
  return { ok: true, ms: value };
}

function integerMs(value: unknown, label: string): { ok: true; ms: number } | { ok: false; error: string } {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
    return { ok: false, error: `${label} must be an integer number of milliseconds` };
  }
  return { ok: true, ms: value };
}

function secondsToMs(value: unknown, label: string): { ok: true; ms: number } | { ok: false; error: string } {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { ok: false, error: `${label} must be a finite number of seconds` };
  }
  return { ok: true, ms: Math.round(value * 1000) };
}

function oneTiming(
  raw: Record<string, unknown>,
  keys: readonly string[],
): { ok: true; ms: number; mode: "delta" | "target" } | { ok: false; error: string } {
  const present = keys.filter((key) => raw[key] !== undefined);
  if (present.length !== 1) {
    return { ok: false, error: "Provide exactly one of deltaMs, deltaSeconds, targetStartMs, targetStartSeconds" };
  }
  const key = present[0]!;
  const parsed = key.endsWith("Seconds") ? secondsToMs(raw[key], key) : integerMs(raw[key], key);
  if (!parsed.ok) return parsed;
  return { ok: true, ms: parsed.ms, mode: key.startsWith("target") ? "target" : "delta" };
}

function propose(
  session: Session,
  proposal: MutationProposal,
): ToolResult<MutationProposal> {
  const preview = previewPlan(session, proposal.steps);
  if (!preview.ok) return toolErr("PREVIEW_REJECTED", preview.error);
  return toolOk(proposal);
}

export function planMoveClip(session: Session, args: unknown): ToolResult<MutationProposal> {
  const raw = argsOf(args);
  const timing = oneTiming(raw, ["deltaMs", "deltaSeconds", "targetStartMs", "targetStartSeconds"]);
  if (!timing.ok) return toolErr("SCHEMA_INVALID", timing.error);

  let clipId: string;
  if (raw.clipId !== undefined) {
    if (typeof raw.clipId !== "string" || raw.clipId.trim().length === 0) {
      return toolErr("SCHEMA_INVALID", "clipId must be a clip id");
    }
    clipId = raw.clipId;
  } else {
    const selected = selectionOf(session);
    if (selected.length === 0) return toolErr("NO_SELECTION", "No clip selected");
    if (selected.length !== 1) return toolErr("AMBIGUOUS_SELECTION", "Select exactly one clip");
    clipId = selected[0]!;
  }

  const clip = clipById(session.project, clipId);
  if (!clip) return toolErr("CLIP_NOT_FOUND", "Clip not found");
  if (clipIsLocked(clip)) return toolErr("CLIP_LOCKED", "Clip is locked");

  const deltaMs = timing.mode === "target" ? timing.ms - clip.startMs : timing.ms;
  if (deltaMs === 0) return toolErr("NO_CHANGE", "Move would not change the clip");
  if (clip.startMs + deltaMs < 0) return toolErr("NEGATIVE_START", "Move would start before 0");
  const mate = editableLinkedMate(session.project, clipId);
  if (mate && mate.startMs + deltaMs < 0) {
    return toolErr("NEGATIVE_START", "Linked clip would start before 0");
  }

  const command: EditorCommand = { type: "moveClips", clipIds: [clipId], deltaMs };
  const preview = previewPlan(session, [{ kind: "command", command }]);
  if (!preview.ok) return toolErr("PREVIEW_REJECTED", preview.error);
  const moved = clipById(preview.session.project, clipId);
  if (!moved || moved.startMs - clip.startMs !== deltaMs) {
    return toolErr("NOT_EXACT", "Move was not exact");
  }
  if (mate) {
    const movedMate = clipById(preview.session.project, mate.id);
    if (!movedMate || movedMate.startMs - mate.startMs !== deltaMs) {
      return toolErr("NOT_EXACT", "Linked clip move was not exact");
    }
  }

  const mateNote = mate ? ` Linked clip ${mate.id} moves by the same ${deltaMs} ms.` : "";
  return toolOk({
    tool: "timeline.move_clip",
    summary: `Exact move. Snap is ${session.project.snap ? "on" : "off"} and is not used. ${clipId} ${clip.startMs} ms → ${clip.startMs + deltaMs} ms.${mateNote}`,
    steps: [{ kind: "command", command }],
    command,
  });
}

export function planSplitAtPlayhead(session: Session, _args: unknown): ToolResult<MutationProposal> {
  const command: EditorCommand = { type: "split" };
  const planned = propose(session, {
    tool: "timeline.split_at_playhead",
    summary: `Split at the playhead (${session.project.playheadMs} ms) using the existing split command.`,
    steps: [{ kind: "command", command }],
    command,
  });
  return planned;
}

export function planTrim(session: Session, args: unknown): ToolResult<MutationProposal> {
  const raw = argsOf(args);
  const edge = raw.edge;
  if (edge !== "in" && edge !== "out") {
    return toolErr("SCHEMA_INVALID", "edge must be in or out");
  }
  let clipId: string;
  if (typeof raw.clipId === "string" && raw.clipId.trim().length > 0) clipId = raw.clipId;
  else {
    const selected = selectionOf(session);
    if (selected.length === 0) return toolErr("NO_SELECTION", "No clip selected");
    if (selected.length !== 1) return toolErr("AMBIGUOUS_SELECTION", "Select exactly one clip");
    clipId = selected[0]!;
  }
  const clip = clipById(session.project, clipId);
  if (!clip) return toolErr("CLIP_NOT_FOUND", "Clip not found");
  if (clipIsLocked(clip)) return toolErr("CLIP_LOCKED", "Clip is locked");
  const target = raw.targetEdgeMs;
  const nextEdgeMs =
    typeof target === "number" && Number.isFinite(target) ? target : session.project.playheadMs;
  const command: EditorCommand = { type: "liftTrim", clipId, edge, nextEdgeMs };
  const preview = previewPlan(session, [{ kind: "command", command }]);
  if (!preview.ok) return toolErr("PREVIEW_REJECTED", preview.error);
  const after = clipById(preview.session.project, clipId);
  if (!after || (after.startMs === clip.startMs && after.durationMs === clip.durationMs)) {
    return toolErr("NO_CHANGE", "Trim would not change the clip");
  }
  return toolOk({
    tool: "timeline.trim",
    summary: `Trim ${edge} of ${clipId} toward ${nextEdgeMs} ms. Snap is ${session.project.snap ? "on" : "off"}. Nothing changes until you accept.`,
    steps: [{ kind: "command", command }],
    command,
  });
}

export function planAddFade(session: Session, args: unknown): ToolResult<MutationProposal> {
  const raw = argsOf(args);
  const readMs = (key: string): { ok: true; ms?: number } | { ok: false; error: string } => {
    if (raw[key] === undefined) return { ok: true };
    const parsed = finiteNumber(raw[key], key);
    if (!parsed.ok) return parsed;
    if (parsed.ms < 0) return { ok: false, error: `${key} must be >= 0` };
    return { ok: true, ms: parsed.ms };
  };
  const fadeIn = readMs("fadeInMs");
  if (!fadeIn.ok) return toolErr("SCHEMA_INVALID", fadeIn.error);
  const fadeOut = readMs("fadeOutMs");
  if (!fadeOut.ok) return toolErr("SCHEMA_INVALID", fadeOut.error);
  const fadeInMs = fadeIn.ms ?? (fadeOut.ms == null ? DEFAULT_FADE_MS : undefined);
  const fadeOutMs = fadeOut.ms ?? (fadeIn.ms == null ? DEFAULT_FADE_MS : undefined);

  let clipId: string | undefined;
  if (raw.clipId !== undefined) {
    if (typeof raw.clipId !== "string" || raw.clipId.trim().length === 0) {
      return toolErr("SCHEMA_INVALID", "clipId must be a clip id");
    }
    clipId = raw.clipId;
    const clip = clipById(session.project, clipId);
    if (!clip) return toolErr("CLIP_NOT_FOUND", "Clip not found");
    if (clipIsLocked(clip)) return toolErr("CLIP_LOCKED", "Clip is locked");
  } else if (selectionOf(session).length === 0) {
    return toolErr("NO_SELECTION", "No clip selected");
  }

  const command: EditorCommand = clipId
    ? {
        type: "setClipFades",
        clipId,
        fadeInMs: fadeInMs ?? clipById(session.project, clipId)?.fadeInMs ?? 0,
        fadeOutMs: fadeOutMs ?? clipById(session.project, clipId)?.fadeOutMs ?? 0,
      }
    : { type: "setSelectionFades", fadeInMs, fadeOutMs };
  const preview = previewPlan(session, [{ kind: "command", command }]);
  if (!preview.ok) return toolErr("PREVIEW_REJECTED", preview.error);
  const watch = clipId ? [clipId] : selectionOf(session);
  const unchanged = watch.every((id) => {
    const before = clipById(session.project, id);
    const after = clipById(preview.session.project, id);
    return Boolean(before && after && before.fadeInMs === after.fadeInMs && before.fadeOutMs === after.fadeOutMs);
  });
  if (unchanged) return toolErr("NO_CHANGE", "Fade would not change the clip");
  const summary = clipId
    ? `Fade ${clipId} in ${fadeInMs ?? "unchanged"} ms and out ${fadeOutMs ?? "unchanged"} ms. Nothing changes until you accept.`
    : `Fade the selection in ${fadeInMs ?? "unchanged"} ms and out ${fadeOutMs ?? "unchanged"} ms. Nothing changes until you accept.`;
  return toolOk({
    tool: "timeline.add_fade",
    summary,
    steps: [{ kind: "command", command }],
    command,
  });
}

export function planSetSpeed(session: Session, args: unknown): ToolResult<MutationProposal> {
  const raw = argsOf(args);
  if (typeof raw.rate !== "number" || !Number.isFinite(raw.rate)) {
    return toolErr("SCHEMA_INVALID", "rate must be a finite number");
  }
  if (raw.rate < CLIP_RATE_MIN || raw.rate > CLIP_RATE_MAX) {
    return toolErr("SCHEMA_INVALID", "rate must be between 0.25 and 4");
  }
  let clipId: string | undefined;
  if (raw.clipId !== undefined) {
    if (typeof raw.clipId !== "string" || raw.clipId.trim().length === 0) {
      return toolErr("SCHEMA_INVALID", "clipId must be a clip id");
    }
    clipId = raw.clipId;
    const clip = clipById(session.project, clipId);
    if (!clip) return toolErr("CLIP_NOT_FOUND", "Clip not found");
    if (clipIsLocked(clip)) return toolErr("CLIP_LOCKED", "Clip is locked");
  } else if (selectionOf(session).length === 0) {
    return toolErr("NO_SELECTION", "No clip selected");
  }
  const command: EditorCommand = clipId
    ? { type: "setClipRate", clipId, rate: raw.rate }
    : { type: "setSelectionRate", rate: raw.rate };
  const preview = previewPlan(session, [{ kind: "command", command }]);
  if (!preview.ok) return toolErr("PREVIEW_REJECTED", preview.error);
  const watch = clipId ? [clipId] : selectionOf(session);
  const unchanged = watch.every((id) => {
    const before = clipById(session.project, id);
    const after = clipById(preview.session.project, id);
    return Boolean(before && after && before.rate === after.rate && before.durationMs === after.durationMs);
  });
  if (unchanged) return toolErr("NO_CHANGE", "Speed would not change the clip");
  return toolOk({
    tool: "timeline.set_speed",
    summary: `Set speed to ${raw.rate}x. Source in and out stay. Nothing changes until you accept. Preview and export keep pitch.`,
    steps: [{ kind: "command", command }],
    command,
  });
}

export function planRippleDelete(session: Session, _args: unknown): ToolResult<MutationProposal> {
  const ids = selectionOf(session);
  if (ids.length === 0) return toolErr("NO_SELECTION", "No clip selected");
  const command: EditorCommand = { type: "rippleDelete" };
  return propose(session, {
    tool: "timeline.ripple_delete",
    summary: `Ripple-delete ${ids.length === 1 ? ids[0] : `${ids.length} selected clips`} (${ids.join(", ")}). Later clips on those tracks close the gap. Nothing changes until you accept.`,
    steps: [{ kind: "command", command }],
    command,
  });
}

export function planLiftDelete(session: Session, _args: unknown): ToolResult<MutationProposal> {
  const ids = selectionOf(session);
  if (ids.length === 0) return toolErr("NO_SELECTION", "No clip selected");
  const command: EditorCommand = { type: "liftDelete" };
  return propose(session, {
    tool: "timeline.lift_delete",
    summary: `Lift-delete ${ids.length === 1 ? ids[0] : `${ids.length} selected clips`} (${ids.join(", ")}).`,
    steps: [{ kind: "command", command }],
    command,
  });
}

export function planNudge(session: Session, args: unknown): ToolResult<MutationProposal> {
  const raw = argsOf(args);
  const present = ["deltaMs", "deltaSeconds"].filter((key) => raw[key] !== undefined);
  if (present.length !== 1) {
    return toolErr("SCHEMA_INVALID", "Provide exactly one of deltaMs or deltaSeconds");
  }
  const key = present[0]!;
  const parsed = key === "deltaSeconds" ? secondsToMs(raw[key], key) : finiteNumber(raw[key], key);
  if (!parsed.ok) return toolErr("SCHEMA_INVALID", parsed.error);
  const ids = selectionOf(session);
  if (ids.length === 0) return toolErr("NO_SELECTION", "No clip selected");
  const primary = clipById(session.project, ids[0]!);
  if (!primary) return toolErr("CLIP_NOT_FOUND", "Clip not found");
  const command: EditorCommand = { type: "nudgeClip", deltaMs: parsed.ms };
  const preview = previewPlan(session, [{ kind: "command", command }]);
  if (!preview.ok) return toolErr("PREVIEW_REJECTED", preview.error);
  const after = clipById(preview.session.project, primary.id);
  const actual = after ? after.startMs - primary.startMs : parsed.ms;
  return toolOk({
    tool: "timeline.nudge",
    summary: `Nudge uses the editor snap path. Requested ${parsed.ms} ms. Preview moves ${primary.id} by ${actual} ms. An exact move uses timeline.move_clip instead.`,
    steps: [{ kind: "command", command }],
    command,
  });
}

export function planSplitsAtMarkers(session: Session, args: unknown): ToolResult<MutationProposal> {
  const raw = argsOf(args);
  const includeTransitions = raw.includeTransitions === true;
  const selected = selectionOf(session);
  if (selected.length === 0) return toolErr("NO_SELECTION", "No clip selected");
  if (selected.length !== 1) return toolErr("AMBIGUOUS_SELECTION", "Select exactly one clip");
  const clip = clipById(session.project, selected[0]!);
  if (!clip) return toolErr("CLIP_NOT_FOUND", "Clip not found");
  if (clipIsLocked(clip)) return toolErr("CLIP_LOCKED", "Clip is locked");
  const markers = [...session.project.markers].sort((a, b) => a.timeMs - b.timeMs || a.id.localeCompare(b.id));
  if (markers.length === 0) {
    return toolErr(
      "NO_BEAT_DATA",
      "No beat or marker data is in this project. Audio was not analyzed.",
    );
  }
  const hits: number[] = [];
  const skipped: number[] = [];
  for (const marker of markers) {
    const offset = marker.timeMs - clip.startMs;
    const inside = offset >= SPLIT_EDGE_GUARD_MS && clip.durationMs - offset >= SPLIT_EDGE_GUARD_MS;
    if (inside) hits.push(marker.timeMs);
    else skipped.push(marker.timeMs);
  }
  if (hits.length === 0) {
    return toolErr(
      "NO_BEAT_DATA",
      "No marker falls inside the selected clip. Audio was not analyzed.",
    );
  }
  const steps: PlanStep[] = hits.flatMap((timeMs) => [
    { kind: "seek" as const, timeMs },
    { kind: "command" as const, command: { type: "split" as const } },
  ]);
  const preview = previewPlan(session, steps);
  if (!preview.ok) return toolErr("PREVIEW_REJECTED", preview.error);
  let transitionNote = "No video transition was added. Overlapping video edit pairs are unchanged.";
  if (includeTransitions && kindOfTrack(clip.trackId) === "audio") {
    const fadeStep: PlanStep = { kind: "audio-crossfade", durationMs: AUDIO_CROSSFADE_MS, boundariesMs: hits };
    const faded = previewPlan(preview.session, [fadeStep]);
    if (faded.ok) {
      steps.push(fadeStep);
      const pieces = faded.session.project.clips
        .filter((item) => item.trackId === clip.trackId)
        .map((item) => `${item.fadeInMs}/${item.fadeOutMs}`);
      transitionNote = `Audio crossfades use setClipFades (${AUDIO_CROSSFADE_MS} ms, clamped by the existing fade normalizer). Fade in/out ms by piece: ${pieces.join(", ")}.`;
    } else {
      transitionNote = `No audio crossfade was added. ${faded.error}`;
    }
  }
  if (includeTransitions) {
    const withTransition = previewPlan(preview.session, [
      { kind: "command", command: { type: "setTransition", transitionType: "crossfade", durationMs: AUDIO_CROSSFADE_MS } },
    ]);
    const beforeCount = preview.session.project.transitions.length;
    const afterCount = withTransition.ok ? withTransition.session.project.transitions.length : beforeCount;
    if (withTransition.ok && afterCount > beforeCount) {
      steps.push({
        kind: "command",
        command: { type: "setTransition", transitionType: "crossfade", durationMs: AUDIO_CROSSFADE_MS },
      });
      transitionNote = `${transitionNote} A video crossfade was also proposed on an existing edit pair.`;
    }
  }
  const full = previewPlan(session, steps);
  if (!full.ok) return toolErr("PREVIEW_REJECTED", full.error);
  const skipNote = skipped.length > 0 ? ` Skipped marker times ${skipped.join(", ")} ms.` : "";
  return toolOk({
    tool: "timeline.split_at_markers",
    summary: `Split ${clip.id} at ${hits.length} project marker time${hits.length === 1 ? "" : "s"} (${hits.join(", ")} ms). These marker times were already on the project. Audio was not analyzed for this proposal.${skipNote} ${transitionNote}`,
    steps,
    command: { type: "split" },
  });
}

function beatLabel(event: { timeMs: number; kind: "beat" | "onset"; confidence: number }): string {
  const word = event.kind === "beat" ? "Beat" : "Onset";
  return `${word} ${event.timeMs} ms · ${event.confidence.toFixed(2)}`;
}

/**
 * Marker proposal for onsets already measured from PCM.
 * Model-supplied times are not accepted here.
 */
export function planBeatMarkers(session: Session, analysis: BeatAnalysis): ToolResult<MutationProposal> {
  if (analysis.events.length === 0) {
    return toolErr("NO_BEAT_DATA", "No onsets were found in the selected clip's audio. No beats were invented.");
  }
  const steps: PlanStep[] = analysis.events.flatMap((event) => [
    { kind: "seek" as const, timeMs: event.timeMs },
    { kind: "command" as const, command: { type: "addMarker" as const, label: beatLabel(event) } },
  ]);
  const preview = previewPlan(session, steps, { exactMarkerTimes: true });
  if (!preview.ok) return toolErr("PREVIEW_REJECTED", preview.error);
  const added = preview.session.project.markers.filter(
    (marker) => !session.project.markers.some((existing) => existing.id === marker.id),
  );
  const expected = analysis.events.map((event) => event.timeMs);
  const actual = [...added].map((marker) => marker.timeMs).sort((a, b) => a - b);
  const wanted = [...expected].sort((a, b) => a - b);
  if (actual.length !== wanted.length || actual.some((time, index) => time !== wanted[index])) {
    return toolErr("NOT_EXACT", "Marker times did not match the detected onsets.");
  }
  if (preview.session.project.snap !== session.project.snap) {
    return toolErr("NOT_EXACT", "Snap would have changed.");
  }
  const gap = analysis.medianGapMs == null ? "no median gap" : `median gap ${analysis.medianGapMs} ms`;
  const truncated = analysis.truncated ? " The list was truncated." : "";
  const summary = [
    `${analysis.events.length} ${analysis.events[0]?.kind === "beat" ? "beat" : "onset"} marker${analysis.events.length === 1 ? "" : "s"} from the selected clip's audio.`,
    `Method: ${analysis.method}. Confidence ${analysis.confidence.toFixed(2)} is the share of onset gaps within 15% of the ${gap}.`,
    analysis.events[0]?.kind === "beat"
      ? "The gaps are regular enough to call these beats."
      : "A steady beat was not found, so these stay labeled as onsets.",
    `Times: ${analysis.events.map((event) => beatLabel(event)).join("; ")}.`,
    "No tempo was invented. Nothing changes until you accept.",
    truncated,
  ].join(" ");
  return toolOk({
    tool: "audio.detect_beats",
    summary,
    steps,
    command: { type: "addMarker", label: beatLabel(analysis.events[0]!) },
    exactMarkerTimes: true,
    preserveSelection: true,
  });
}

/** Build a proposal. Does not assign the live session. */
export function planMutation(session: Session, name: string, args?: unknown): ToolResult<MutationProposal> {
  switch (name) {
    case "timeline.move_clip":
      return planMoveClip(session, args);
    case "timeline.split_at_playhead":
      return planSplitAtPlayhead(session, args);
    case "timeline.lift_delete":
      return planLiftDelete(session, args);
    case "timeline.trim":
      return planTrim(session, args);
    case "timeline.ripple_delete":
      return planRippleDelete(session, args);
    case "timeline.add_fade":
      return planAddFade(session, args);
    case "timeline.set_speed":
      return planSetSpeed(session, args);
    case "timeline.nudge":
      return planNudge(session, args);
    case "timeline.split_at_markers":
      return planSplitsAtMarkers(session, args);
    case "audio.detect_beats":
      return toolErr("SCHEMA_INVALID", "Beat times cannot be supplied. Detection reads the selected clip's audio.");
    case "lyrics.suggest_scenes":
      return toolErr("SCHEMA_INVALID", "Scene ideas are planned from pasted lyrics. This path does not apply them.");
    default:
      return toolErr("UNKNOWN_TOOL", "Unknown tool");
  }
}
