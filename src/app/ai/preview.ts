import type { EditorCommand } from "../commands";
import type { Session } from "../session";
import { kindOfTrack, type Clip } from "../../core/models";
import { createHistory, setPlayhead } from "../../core/timeline";
import { applyCommand } from "../commands";

/** One step inside a scratch preview. Seek is not an editor command. */
export type PlanStep =
  | { kind: "seek"; timeMs: number }
  | { kind: "command"; command: EditorCommand }
  | { kind: "audio-crossfade"; durationMs: number; boundariesMs: number[] };

export interface PreviewOptions {
  /**
   * Marker adds use the existing `addMarker` command, which snaps.
   * Detected times must stay put, so the scratch turns snap off for the
   * replay and restores the original value before the preview is returned.
   */
  exactMarkerTimes?: boolean;
}

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
function nearBoundary(boundaries: readonly number[], timeMs: number): boolean {
  return boundaries.some((boundary) => Math.abs(boundary - timeMs) <= 2);
}

/**
 * Same-track audio crossfade. Clip ids are resolved at replay time because
 * split assigns new ids. Each piece is changed with `setClipFades`.
 */
function applyAudioCrossfade(scratch: Session, durationMs: number, boundariesMs: readonly number[]): Session {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return { ...scratch, error: "Crossfade length is invalid" };
  }
  const byTrack = new Map<string, Clip[]>();
  for (const clip of scratch.project.clips) {
    if (kindOfTrack(clip.trackId) !== "audio") continue;
    const list = byTrack.get(clip.trackId) ?? [];
    list.push(clip);
    byTrack.set(clip.trackId, list);
  }
  const desired = new Map<string, { fadeInMs: number; fadeOutMs: number }>();
  for (const pieces of byTrack.values()) {
    pieces.sort((a, b) => a.startMs - b.startMs || a.id.localeCompare(b.id));
    for (let index = 0; index < pieces.length - 1; index += 1) {
      const left = pieces[index]!;
      const right = pieces[index + 1]!;
      if (Math.abs(left.startMs + left.durationMs - right.startMs) > 2) continue;
      if (!nearBoundary(boundariesMs, right.startMs)) continue;
      const leftWant = desired.get(left.id) ?? { fadeInMs: left.fadeInMs, fadeOutMs: left.fadeOutMs };
      const rightWant = desired.get(right.id) ?? { fadeInMs: right.fadeInMs, fadeOutMs: right.fadeOutMs };
      leftWant.fadeOutMs = durationMs;
      rightWant.fadeInMs = durationMs;
      desired.set(left.id, leftWant);
      desired.set(right.id, rightWant);
    }
  }
  if (desired.size === 0) return { ...scratch, error: "No abutting audio pieces to crossfade" };
  let next = scratch;
  for (const [clipId, fades] of desired) {
    const before = next.project;
    const applied = applyCommand(next, {
      type: "setClipFades",
      clipId,
      fadeInMs: fades.fadeInMs,
      fadeOutMs: fades.fadeOutMs,
    });
    if (applied.project === before) return { ...next, error: applied.error ?? "Fade made no change" };
    next = { ...applied, history: createHistory(), error: null };
  }
  return next;
}

export function previewPlan(session: Session, steps: readonly PlanStep[], opts?: PreviewOptions): PreviewPlan {
  let scratch = scratchFrom(session);
  const originalSnap = scratch.project.snap;
  if (opts?.exactMarkerTimes && originalSnap) {
    scratch = { ...scratch, project: { ...scratch.project, snap: false } };
  }
  for (const step of steps) {
    if (step.kind === "seek") {
      if (typeof step.timeMs !== "number" || !Number.isFinite(step.timeMs)) {
        return { ok: false, error: "Seek time is invalid" };
      }
      scratch = { ...scratch, project: setPlayhead(scratch.project, step.timeMs) };
      continue;
    }
    if (step.kind === "audio-crossfade") {
      const faded = applyAudioCrossfade(scratch, step.durationMs, step.boundariesMs);
      if (faded.error || faded.project === scratch.project) {
        return { ok: false, error: faded.error ?? "No abutting audio pieces to crossfade" };
      }
      scratch = { ...faded, history: createHistory(), error: null };
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
  if (opts?.exactMarkerTimes && originalSnap && scratch.project.snap !== originalSnap) {
    scratch = { ...scratch, project: { ...scratch.project, snap: originalSnap } };
  }
  return { ok: true, session: scratch };
}
