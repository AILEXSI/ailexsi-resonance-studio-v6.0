import type { EditorCommand } from "../../commands";
import { selectionOf, type Session } from "../../session";
import { editableLinkedMate } from "../../../core/link";
import { clipById, clipIsLocked, SPLIT_EDGE_GUARD_MS } from "../../../core/models";
import { previewPlan, type PlanStep } from "../preview";
import { toolErr, toolOk, type ToolResult } from "./result";

export const MUTATION_TOOL_NAMES = [
  "timeline.move_clip",
  "timeline.split_at_playhead",
  "timeline.lift_delete",
  "timeline.nudge",
  "timeline.split_at_markers",
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
  let transitionNote =
    "No transition was proposed. Resonance transitions need an overlapping video edit pair, and audio was not analyzed.";
  if (includeTransitions) {
    const withTransition = previewPlan(preview.session, [
      { kind: "command", command: { type: "setTransition", transitionType: "crossfade", durationMs: 200 } },
    ]);
    const beforeCount = preview.session.project.transitions.length;
    const afterCount = withTransition.ok ? withTransition.session.project.transitions.length : beforeCount;
    if (withTransition.ok && afterCount > beforeCount) {
      steps.push({ kind: "command", command: { type: "setTransition", transitionType: "crossfade", durationMs: 200 } });
      transitionNote = "A crossfade was proposed on an existing video edit pair.";
    }
  }
  const skipNote = skipped.length > 0 ? ` Skipped marker times ${skipped.join(", ")} ms.` : "";
  return toolOk({
    tool: "timeline.split_at_markers",
    summary: `Split ${clip.id} at ${hits.length} project marker time${hits.length === 1 ? "" : "s"} (${hits.join(", ")} ms). Audio was not analyzed.${skipNote} ${transitionNote}`,
    steps,
    command: { type: "split" },
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
    case "timeline.nudge":
      return planNudge(session, args);
    case "timeline.split_at_markers":
      return planSplitsAtMarkers(session, args);
    default:
      return toolErr("UNKNOWN_TOOL", "Unknown tool");
  }
}
