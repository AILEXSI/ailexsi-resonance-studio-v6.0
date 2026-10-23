import type { EditorCommand } from "../commands";
import type { Session } from "../session";
import { createHistory, setPlayhead } from "../../core/timeline";
import { applyCommand } from "../commands";

/** One step inside a scratch preview. Seek is not an editor command. */
export type PlanStep =
  | { kind: "seek"; timeMs: number }
  | { kind: "command"; command: EditorCommand };

export type PreviewPlan =
  | { ok: true; session: Session }
  | { ok: false; error: string };

function scratchFrom(session: Session): Session {
  return {
    ...session,
    project: structuredClone(session.project),
    history: createHistory(),
    selectedClipIds: [...session.selectedClipIds],
    selectedTrackIds: [...(session.selectedTrackIds ?? [])],
    selectedVisEventIds: [...(session.selectedVisEventIds ?? [])],
    clipboard: session.clipboard.map((clip) => ({ ...clip })),
    volumeWriteGesture: null,
    volumeWriteArmedIds: [],
  };
}

/**
 * Replay steps on a clone. The caller's session is not assigned and its
 * history is not pushed. This is a preview, not a commit.
 */
export function previewPlan(session: Session, steps: readonly PlanStep[]): PreviewPlan {
  let scratch = scratchFrom(session);
  for (const step of steps) {
    if (step.kind === "seek") {
      if (typeof step.timeMs !== "number" || !Number.isFinite(step.timeMs)) {
        return { ok: false, error: "Seek time is invalid" };
      }
      scratch = { ...scratch, project: setPlayhead(scratch.project, step.timeMs) };
      continue;
    }
    const before = scratch.project;
    const next = applyCommand(scratch, step.command);
    if (next.project === before) {
      return { ok: false, error: next.error ?? "Command made no change" };
    }
    scratch = {
      ...next,
      history: createHistory(),
      error: null,
    };
  }
  return { ok: true, session: scratch };
}
