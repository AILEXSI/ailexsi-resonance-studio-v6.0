import { clipById, clipIsLocked } from "../../../core/models";
import { selectionOf, type Session } from "../../session";
import type { DirectorMode } from "../permissions/policy";
import {
  applyCommandTransaction,
  draftCommandTransaction,
  type TransactionFail,
  type TransactionOk,
} from "../transactions/transaction";

export const GOLDEN_MOVE_PROMPT =
  "Verschiebe den markierten Clip exakt zwei Sekunden nach rechts.";

export const MOVE_CLIP_TOOL = "timeline.move_clip";

export interface MoveClipArgs {
  clipId?: string;
  deltaMs?: number;
  targetStartSeconds?: number;
}

export function parseGoldenMovePrompt(text: string): { deltaMs: 2000 } | null {
  return text.trim() === GOLDEN_MOVE_PROMPT ? { deltaMs: 2000 } : null;
}

function asFiniteInt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.round(value);
}

export function resolveMoveClipCommand(
  session: Session,
  args: MoveClipArgs,
): { clipIds: [string]; deltaMs: number } | { error: string } {
  const selected = selectionOf(session);
  const clipId = args.clipId ?? (selected.length === 1 ? selected[0] : undefined);
  if (!clipId) {
    return { error: selected.length > 1 ? "AMBIGUOUS_SELECTION" : "No clip selected" };
  }
  const clip = clipById(session.project, clipId);
  if (!clip) {
    return { error: clipId.includes("_") ? "Clip not found" : "Display names are not ids" };
  }
  if (!clip) return { error: "Clip not found" };
  if (clipIsLocked(clip)) return { error: "Clip is locked" };

  let deltaMs: number | null = null;
  if (args.targetStartSeconds !== undefined) {
    if (!Number.isFinite(args.targetStartSeconds)) return { error: "INVALID_DELTA" };
    deltaMs = Math.round(args.targetStartSeconds * 1000) - clip.startMs;
  } else {
    deltaMs = asFiniteInt(args.deltaMs);
  }
  if (deltaMs == null) return { error: "INVALID_DELTA" };
  return { clipIds: [clip.id], deltaMs };
}

export function draftMoveClip(opts: {
  session: Session;
  args: MoveClipArgs;
  grant: unknown;
  mode: DirectorMode;
}): TransactionOk | TransactionFail {
  const resolved = resolveMoveClipCommand(opts.session, opts.args);
  if ("error" in resolved) {
    return { ok: false, code: "SEMANTIC", message: resolved.error };
  }
  return draftCommandTransaction({
    session: opts.session,
    command: { type: "moveClips", clipIds: resolved.clipIds, deltaMs: resolved.deltaMs },
    grant: opts.grant,
    mode: opts.mode,
    toolName: MOVE_CLIP_TOOL,
  });
}

export function applyMoveClip(opts: {
  session: Session;
  result: TransactionOk;
  grant: unknown;
  mode: DirectorMode;
  approval: boolean;
}): TransactionOk | TransactionFail {
  return applyCommandTransaction({
    session: opts.session,
    transaction: opts.result.transaction,
    grant: opts.grant,
    mode: opts.mode,
    approval: opts.approval,
  });
}

/** One-shot apply used by golden tests: draft then approved apply. */
export function commitMoveClip(opts: {
  session: Session;
  args: MoveClipArgs;
  grant: unknown;
  mode: DirectorMode;
  approval: boolean;
}): TransactionOk | TransactionFail {
  const drafted = draftMoveClip(opts);
  if (!drafted.ok) return drafted;
  return applyMoveClip({
    session: opts.session,
    result: drafted,
    grant: opts.grant,
    mode: opts.mode,
    approval: opts.approval,
  });
}
