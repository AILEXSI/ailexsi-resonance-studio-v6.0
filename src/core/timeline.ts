import { applyNormalizedFades } from "./fades";
import { createId } from "./ids";
import { assetFitsTrack } from "./media";
import {
  editableLinkedMate,
  expandLinkedClipIds,
  firstFreeAudioTrack,
  livingLinkedMate,
  remapPastedLinkIds,
} from "./link";
import {
  SPLIT_EDGE_GUARD_MS,
  SNAP_THRESHOLD_MS,
  clampClipRate,
  clipById,
  clipEndMs,
  clipIsEnabled,
  clipIsLocked,
  clipOnTrackAt,
  isTrackId,
  kindOfTrack,
  sourceDeltaToTimeline,
  sourceSpanMs,
  sourceTimeAt,
  timelineDeltaToSource,
  timelineDurationForRate,
  TRACK_IDS,
  trackIdsOf,
  type Clip,
  type Marker,
  type Project,
  type TrackId,
} from "./models";
import { visualizerEventsOf } from "./visualizer";

export interface HistoryStack {
  past: Project[];
  future: Project[];
}

export function createHistory(): HistoryStack {
  return { past: [], future: [] };
}

export function pushHistory(history: HistoryStack, project: Project): HistoryStack {
  return {
    past: [...history.past, structuredClone(project)],
    future: [],
  };
}

export function undo(history: HistoryStack, current: Project): {
  history: HistoryStack;
  project: Project;
} | null {
  if (history.past.length === 0) return null;
  const past = history.past.slice();
  const previous = past.pop()!;
  return {
    project: previous,
    history: { past, future: [structuredClone(current), ...history.future] },
  };
}

export function redo(history: HistoryStack, current: Project): {
  history: HistoryStack;
  project: Project;
} | null {
  if (history.future.length === 0) return null;
  const [next, ...rest] = history.future;
  return {
    project: next,
    history: { past: [...history.past, structuredClone(current)], future: rest },
  };
}

export function clampStartMs(startMs: number): number {
  return Math.max(0, startMs);
}

export function moveClip(
  project: Project,
  clipId: string,
  nextStartMs: number,
  nextTrackId?: TrackId,
  opts?: { skipLink?: boolean },
): { project: Project; error?: string } {
  const clip = clipById(project, clipId);
  if (!clip) return { project, error: "Clip not found" };
  if (clipIsLocked(clip)) return { project, error: "Clip is locked" };

  const trackId = nextTrackId ?? clip.trackId;
  if (!isTrackId(trackId) || kindOfTrack(trackId) !== kindOfTrack(clip.trackId)) {
    return { project, error: "Cannot move clip to a different kind of track" };
  }

  const startMs = clampStartMs(nextStartMs);
  const delta = startMs - clip.startMs;
  const mate = opts?.skipLink ? undefined : editableLinkedMate(project, clipId);
  return {
    project: {
      ...project,
      updatedAt: new Date().toISOString(),
      clips: project.clips.map((c) => {
        if (c.id === clipId) return { ...c, startMs, trackId };
        if (mate && c.id === mate.id) {
          return { ...c, startMs: clampStartMs(c.startMs + delta) };
        }
        return c;
      }),
    },
  };
}

function trimOneClip(
  project: Project,
  clip: Clip,
  edge: "in" | "out",
  nextEdgeMs: number,
): { clip: Clip } | { error: string } {
  const asset = project.assets.find((a) => a.id === clip.assetId);
  let edgeMs = Math.max(0, nextEdgeMs);
  if (project.snap) {
    edgeMs = snapTime(edgeMs, collectSnapTargets(project, clip.id)).timeMs;
    edgeMs = Math.max(0, edgeMs);
  }

  const minSourceSpan = timelineDeltaToSource(clip, SPLIT_EDGE_GUARD_MS);
  if (edge === "in") {
    const newStart = edgeMs;
    const newSourceIn = clip.sourceInMs + timelineDeltaToSource(clip, newStart - clip.startMs);
    const newDuration = clipEndMs(clip) - newStart;
    if (newSourceIn < 0) return { error: "sourceIn cannot go below 0" };
    if (newDuration < SPLIT_EDGE_GUARD_MS) return { error: "Trim would leave less than 50ms" };
    if (newSourceIn > clip.sourceOutMs - minSourceSpan) {
      return { error: "sourceIn cannot exceed sourceOut - 50ms" };
    }
    return {
      clip: applyNormalizedFades({
        ...clip,
        startMs: newStart,
        sourceInMs: newSourceIn,
        durationMs: newDuration,
      }),
    };
  }
  const newDuration = edgeMs - clip.startMs;
  const newSourceOut = clip.sourceOutMs + timelineDeltaToSource(clip, newDuration - clip.durationMs);
  if (newDuration < SPLIT_EDGE_GUARD_MS) return { error: "Trim would leave less than 50ms" };
  if (newSourceOut < clip.sourceInMs + minSourceSpan) {
    return { error: "Trim would leave less than 50ms" };
  }
  if (asset && newSourceOut > asset.durationMs) {
    return { error: "sourceOut cannot exceed asset duration" };
  }
  return {
    clip: applyNormalizedFades({
      ...clip,
      durationMs: newDuration,
      sourceOutMs: newSourceOut,
    }),
  };
}

export function trimClip(
  project: Project,
  clipId: string,
  edge: "in" | "out",
  nextEdgeMs: number,
): { project: Project; error?: string } {
  const clip = clipById(project, clipId);
  if (!clip) return { project, error: "Clip not found" };
  if (clipIsLocked(clip)) return { project, error: "Clip is locked" };
  const one = trimOneClip(project, clip, edge, nextEdgeMs);
  if ("error" in one) return { project, error: one.error };
  const mate = editableLinkedMate(project, clipId);
  let two: { clip: Clip } | undefined;
  if (mate) {
    const mateTrim = trimOneClip(project, mate, edge, nextEdgeMs);
    if ("error" in mateTrim) return { project, error: mateTrim.error };
    two = mateTrim;
  }
  const byId = new Map<string, Clip>([[one.clip.id, one.clip]]);
  if (two) byId.set(two.clip.id, two.clip);
  return {
    project: {
      ...project,
      updatedAt: new Date().toISOString(),
      clips: project.clips.map((c) => byId.get(c.id) ?? c),
    },
  };
}

export const ABUT_TOLERANCE_MS = 1;

/**
 * Neighbor that shares this edge (end of A == start of B within 1ms).
 * Disabled clips are not neighbors (same as G / Q/W / extract / rate).
 * After import+disable, roll/slide treat a dimmed take as a gap.
 */
export function abuttingNeighbor(
  project: Project,
  clipId: string,
  edge: "in" | "out",
): Clip | undefined {
  const clip = clipById(project, clipId);
  if (!clip) return undefined;
  if (edge === "out") {
    const end = clipEndMs(clip);
    return project.clips.find(
      (c) =>
        c.id !== clipId &&
        c.trackId === clip.trackId &&
        clipIsEnabled(c) &&
        Math.abs(c.startMs - end) <= ABUT_TOLERANCE_MS,
    );
  }
  return project.clips.find(
    (c) =>
      c.id !== clipId &&
      c.trackId === clip.trackId &&
      clipIsEnabled(c) &&
      Math.abs(clipEndMs(c) - clip.startMs) <= ABUT_TOLERANCE_MS,
  );
}

/**
 * Lift-trim, then shift the rest of the same track so there is no hole or overlap.
 * Out: later clips (start >= old end) follow (newEnd - oldEnd).
 * In: lift leaves a hole before the clip; the trimmed clip and later clips
 * slide by the duration delta (start returns to the original, end follows).
 * A living unlocked linked mate takes the same trim and pack. A locked mate
 * is skipped (same as split/slip/rate/roll/slide) so Q/W can trim the
 * unlocked clip. Later disabled clips stay parked (same as G / ArrowUp).
 * A disabled primary is refused (Shift+drag must not pack living clips).
 */
export function rippleTrimClip(
  project: Project,
  clipId: string,
  edge: "in" | "out",
  nextEdgeMs: number,
): { project: Project; error?: string } {
  const before = clipById(project, clipId);
  if (!before) return { project, error: "Clip not found" };
  if (clipIsLocked(before)) return { project, error: "Clip is locked" };
  if (!clipIsEnabled(before)) return { project, error: "Clip is disabled" };
  const liveMate = editableLinkedMate(project, clipId);
  const laterLocked = project.clips.some((c) => {
    if (c.id === clipId || c.id === liveMate?.id) return false;
    if (!clipIsEnabled(c) || !clipIsLocked(c)) return false;
    const laterPrimary =
      c.trackId === before.trackId && c.startMs + ABUT_TOLERANCE_MS >= clipEndMs(before);
    const laterMate =
      Boolean(liveMate) &&
      c.trackId === liveMate!.trackId &&
      c.startMs + ABUT_TOLERANCE_MS >= clipEndMs(liveMate!);
    return laterPrimary || laterMate;
  });
  if (laterLocked) return { project, error: "Clip is locked" };
  const oldEnd = clipEndMs(before);
  const mateOldEnd = liveMate ? clipEndMs(liveMate) : 0;
  const oldDur = before.durationMs;
  const trimmed = trimClip(project, clipId, edge, nextEdgeMs);
  if (trimmed.error) return trimmed;
  const after = clipById(trimmed.project, clipId);
  if (!after) return trimmed;
  const delta = after.durationMs - oldDur;
  if (delta === 0) return trimmed;
  const mateId = liveMate?.id;
  const mateTrack = liveMate?.trackId;
  return {
    project: {
      ...trimmed.project,
      clips: trimmed.project.clips.map((c) => {
        if (edge === "in" && (c.id === clipId || c.id === mateId)) {
          return { ...c, startMs: clampStartMs(c.startMs + delta) };
        }
        if (c.id === clipId || c.id === mateId) return c;
        const laterPrimary =
          c.trackId === before.trackId && c.startMs + ABUT_TOLERANCE_MS >= oldEnd;
        const laterMate =
          Boolean(mateTrack) &&
          c.trackId === mateTrack &&
          c.startMs + ABUT_TOLERANCE_MS >= mateOldEnd;
        if (laterPrimary || laterMate) {
          if (!clipIsEnabled(c)) return c;
          return { ...c, startMs: clampStartMs(c.startMs + delta) };
        }
        return c;
      }),
      updatedAt: new Date().toISOString(),
    },
  };
}

/**
 * Move many clips by the same delta. Clamps so no start goes below 0.
 * A 2+ selection skips disabled members (same as multi-select S / group
 * slip). A single selected disabled clip still moves.
 */
export function moveClipsByDelta(
  project: Project,
  clipIds: readonly string[],
  deltaMs: number,
  opts?: { skipLink?: boolean },
): { project: Project; error?: string } {
  const explicit = new Set(clipIds.filter(Boolean));
  const ids = opts?.skipLink ? [...explicit] : expandMovableClipIds(project, explicit);
  const found = ids
    .map((id) => clipById(project, id))
    .filter((c): c is Clip => Boolean(c));
  if (found.length === 0) return { project, error: "No clip selected" };
  const group = explicit.size >= 2;
  const targets = found.filter(
    (c) => !clipIsLocked(c) && (clipIsEnabled(c) || (!group && explicit.has(c.id))),
  );
  if (targets.length === 0) {
    return { project, error: found.some(clipIsLocked) ? "Clip is locked" : "No clip selected" };
  }
  const minStart = Math.min(...targets.map((c) => c.startMs));
  const delta = Math.max(deltaMs, -minStart);
  if (delta === 0) return { project };
  const starts = new Map(targets.map((c) => [c.id, c.startMs]));
  let next = project;
  for (const clip of targets) {
    const result = moveClip(
      next,
      clip.id,
      (starts.get(clip.id) ?? clip.startMs) + delta,
      undefined,
      { skipLink: true },
    );
    if (result.error) return result;
    next = result.project;
  }
  return { project: next };
}

/** Gap under the playhead on one track: later enabled clips pack left by −gapMs.
 * Disabled clips do not occupy or close the gap (same as ArrowUp / snap). */
export function findGapOnTrack(
  project: Project,
  trackId: TrackId,
  timeMs: number,
): { prevEnd: number; nextClip: Clip; gapMs: number } | null {
  const onTrack = project.clips.filter((c) => c.trackId === trackId && clipIsEnabled(c));
  if (onTrack.some((c) => timeMs >= c.startMs && timeMs < clipEndMs(c))) return null;
  const later = onTrack.filter((c) => c.startMs > timeMs).sort((a, b) => a.startMs - b.startMs);
  const nextClip = later[0];
  if (!nextClip) return null;
  const earlier = onTrack.filter((c) => clipEndMs(c) <= timeMs);
  const prevEnd = earlier.length === 0 ? 0 : Math.max(...earlier.map((c) => clipEndMs(c)));
  if (!(timeMs > prevEnd && timeMs < nextClip.startMs)) return null;
  const gapMs = nextClip.startMs - prevEnd;
  if (gapMs <= 0) return null;
  return { prevEnd, nextClip, gapMs };
}

export function resolveCloseGapTrack(
  project: Project,
  opts: { selectedClipId: string | null; selectedVis?: boolean },
): TrackId | null {
  if (!opts.selectedVis) {
    const primary = opts.selectedClipId ? clipById(project, opts.selectedClipId) : undefined;
    if (primary && isTrackId(primary.trackId)) return primary.trackId;
  }
  const timeMs = project.playheadMs;
  for (const id of trackIdsOf(project)) {
    if (findGapOnTrack(project, id, timeMs)) return id;
  }
  return null;
}

export function closeGapOnTrack(
  project: Project,
  trackId: TrackId,
  timeMs: number,
): { project: Project } | { unchanged: true } | { error: string } {
  const gap = findGapOnTrack(project, trackId, timeMs);
  if (!gap) return { unchanged: true };
  // The clip that would close THIS gap is locked — refuse. Do not pack
  // later unlocked clips that are not filling the playhead gap (P132).
  if (clipIsLocked(gap.nextClip)) return { error: "Clip is locked" };
  const onTrack = project.clips.filter((c) => c.trackId === trackId);
  const movers = onTrack.filter(
    (c) => clipIsEnabled(c) && c.startMs >= gap.nextClip.startMs,
  );
  if (movers.length === 0) return { unchanged: true };
  const lockedWalls = onTrack.filter((c) => clipIsLocked(c));
  const wouldOverlapLocked = movers.some((c) => {
    if (clipIsLocked(c)) return false;
    const nextStart = clampStartMs(c.startMs - gap.gapMs);
    const nextEnd = nextStart + c.durationMs;
    return lockedWalls.some((w) => nextStart < clipEndMs(w) && nextEnd > w.startMs);
  });
  if (wouldOverlapLocked) return { error: "Clip is locked" };
  const result = moveClipsByDelta(
    project,
    movers.map((c) => c.id),
    -gap.gapMs,
    { skipLink: true },
  );
  if (result.error) return { error: result.error };
  if (result.project === project) return { unchanged: true };
  const moverIds = new Set(movers.map((c) => c.id));
  const minMoved = Math.min(
    ...result.project.clips.filter((c) => moverIds.has(c.id)).map((c) => c.startMs),
  );
  if (minMoved < 0) return { unchanged: true };
  return { project: result.project };
}

/** Playhead strictly inside a clip (not on either edge). */
export function playheadStrictlyInsideClip(clip: Clip, timeMs: number): boolean {
  return timeMs > clip.startMs && timeMs < clipEndMs(clip);
}

/**
 * Clip to ripple-trim to the playhead: selected if playhead is strictly inside it;
 * else a covering clip on that track; else first of the project track collection. VIS is not a track.
 * Disabled and locked clips are skipped (same as P105 disable) so Q/W can hit
 * an unlocked mate after the picture is locked.
 */
export function resolveRippleTrimToPlayheadClip(
  project: Project,
  opts: { selectedClipId: string | null; selectedVis?: boolean },
): Clip | null {
  const timeMs = project.playheadMs;
  const canTrim = (c: Clip | undefined): c is Clip =>
    Boolean(c && isTrackId(c.trackId) && clipIsEnabled(c) && !clipIsLocked(c));
  if (!opts.selectedVis) {
    const primary = opts.selectedClipId ? clipById(project, opts.selectedClipId) : undefined;
    if (canTrim(primary)) {
      if (playheadStrictlyInsideClip(primary, timeMs)) return primary;
      const onTrack = clipOnTrackAt(project, primary.trackId, timeMs);
      if (canTrim(onTrack) && playheadStrictlyInsideClip(onTrack, timeMs)) return onTrack;
    }
  }
  for (const id of trackIdsOf(project)) {
    const hit = clipOnTrackAt(project, id, timeMs);
    if (canTrim(hit) && playheadStrictlyInsideClip(hit, timeMs)) return hit;
  }
  return null;
}

/**
 * Linked-pair expand, but an unselected locked or disabled mate is skipped
 * (same as split/slip/rate / delete). A locked or disabled clip that is
 * itself selected still copies, cuts, or deletes.
 * A selected disabled clip does not take a living mate (inverse of P141).
 * A selected locked clip still takes an unlocked enabled mate (P129).
 */
export function expandDeletableClipIds(project: Project, clipIds: readonly string[]): string[] {
  const explicit = new Set(clipIds.filter(Boolean));
  const ids = new Set<string>();
  for (const id of explicit) {
    const clip = clipById(project, id);
    if (!clip) continue;
    ids.add(id);
    if (!clipIsEnabled(clip)) continue;
    const mate = livingLinkedMate(project, id);
    if (!mate || clipIsLocked(mate) || !clipIsEnabled(mate)) continue;
    ids.add(mate.id);
  }
  return [...ids];
}

/** Expand to editable mates only. A disabled primary does not drag a living mate. */
function expandMovableClipIds(project: Project, explicit: ReadonlySet<string>): string[] {
  const ids = new Set(explicit);
  for (const id of explicit) {
    const mate = editableLinkedMate(project, id);
    if (mate) ids.add(mate.id);
  }
  return [...ids];
}

function dropClipsAndOrphanLinks(project: Project, dropIds: ReadonlySet<string>): Project {
  const remaining = project.clips.filter((c) => !dropIds.has(c.id));
  const linkCount = new Map<string, number>();
  for (const clip of remaining) {
    if (clip.linkId) linkCount.set(clip.linkId, (linkCount.get(clip.linkId) ?? 0) + 1);
  }
  return {
    ...project,
    clips: remaining.map((c) =>
      c.linkId && (linkCount.get(c.linkId) ?? 0) < 2 ? { ...c, linkId: undefined } : c,
    ),
    updatedAt: new Date().toISOString(),
  };
}

export function deleteClips(project: Project, clipIds: readonly string[]): Project {
  const drop = new Set(expandDeletableClipIds(project, clipIds));
  if (drop.size === 0) return project;
  return dropClipsAndOrphanLinks(project, drop);
}

/**
 * Ripple-delete many clips. Per track, later clips first so earlier
 * ripple shifts do not invalidate later selected starts.
 * A locked later clip on any affected track refuses the whole edit
 * (same wall as ripple-trim / G / extract).
 * An unselected locked or disabled mate is skipped (same as lift-delete).
 * A 2+ selection skips disabled members (same as group move / slip).
 * A single selected disabled clip is refused — it does not occupy the
 * living arrangement, so Shift+Delete must not pack later enabled clips.
 */
export function rippleDeleteClips(
  project: Project,
  clipIds: readonly string[],
): { project: Project; error?: string } {
  const explicit = new Set(clipIds.filter(Boolean));
  const group = explicit.size >= 2;
  const selected = expandDeletableClipIds(project, clipIds)
    .map((id) => clipById(project, id))
    .filter((c): c is Clip => c != null && (!group || clipIsEnabled(c)));
  if (selected.length === 0) return { project };
  const order = [...selected].sort((a, b) => {
    if (a.trackId !== b.trackId) return a.trackId.localeCompare(b.trackId);
    return b.startMs - a.startMs;
  });
  let next = project;
  for (const clip of order) {
    if (!clipById(next, clip.id)) continue;
    const step = rippleDeleteClip(next, clip.id);
    if (step.error) return { project, error: step.error };
    next = step.project;
  }
  return { project: next };
}

/**
 * Move the shared cut between two abutting clips. Total A+B span stays constant.
 * A living unlocked linked mate takes the same edge delta. A locked mate is
 * skipped (same as split/slip/rate/move/trim). A disabled endpoint is not
 * a roll (dimmed-handle drag must not move a living neighbor).
 */
export function rollEdit(
  project: Project,
  leftId: string,
  rightId: string,
  cutMs: number,
): { project: Project; error?: string } {
  const left = clipById(project, leftId);
  const right = clipById(project, rightId);
  if (!left || !right) return { project, error: "Clip not found" };
  if (clipIsLocked(left) || clipIsLocked(right)) return { project, error: "Clip is locked" };
  if (!clipIsEnabled(left) || !clipIsEnabled(right)) {
    return { project, error: "No abutting clip to roll" };
  }
  if (left.trackId !== right.trackId) {
    return { project, error: "Roll requires two clips on the same track" };
  }
  if (Math.abs(clipEndMs(left) - right.startMs) > ABUT_TOLERANCE_MS) {
    return { project, error: "Clips do not abut" };
  }

  const spanEnd = clipEndMs(right);
  let cut = Math.max(0, cutMs);
  if (project.snap) {
    cut = snapTime(cut, collectSnapTargets(project, leftId)).timeMs;
    cut = Math.max(0, cut);
  }

  const leftDur = cut - left.startMs;
  const rightDur = spanEnd - cut;
  if (leftDur < SPLIT_EDGE_GUARD_MS || rightDur < SPLIT_EDGE_GUARD_MS) {
    return { project, error: "Roll would leave less than 50ms" };
  }

  const leftSourceOut =
    left.sourceOutMs + timelineDeltaToSource(left, leftDur - left.durationMs);
  const rightSourceIn =
    right.sourceInMs + timelineDeltaToSource(right, cut - right.startMs);
  const leftAsset = project.assets.find((a) => a.id === left.assetId);
  const rightAsset = project.assets.find((a) => a.id === right.assetId);
  if (rightSourceIn < 0) {
    return { project, error: "sourceIn cannot go below 0" };
  }
  if (rightSourceIn > right.sourceOutMs - timelineDeltaToSource(right, SPLIT_EDGE_GUARD_MS)) {
    return { project, error: "sourceIn cannot exceed sourceOut - 50ms" };
  }
  if (leftSourceOut < left.sourceInMs + timelineDeltaToSource(left, SPLIT_EDGE_GUARD_MS)) {
    return { project, error: "Trim would leave less than 50ms" };
  }
  if (leftAsset && leftSourceOut > leftAsset.durationMs) {
    return { project, error: "sourceOut cannot exceed asset duration" };
  }
  if (rightAsset && right.sourceOutMs > rightAsset.durationMs) {
    return { project, error: "sourceOut cannot exceed asset duration" };
  }

  const nextLeft: Clip = applyNormalizedFades({
    ...left,
    durationMs: leftDur,
    sourceOutMs: leftSourceOut,
  });
  const nextRight: Clip = applyNormalizedFades({
    ...right,
    startMs: cut,
    durationMs: rightDur,
    sourceInMs: rightSourceIn,
  });
  const liveLeftMate = editableLinkedMate(project, leftId);
  const liveRightMate = editableLinkedMate(project, rightId);
  const nextLeftMate = liveLeftMate
    ? applyNormalizedFades({
        ...liveLeftMate,
        startMs: clampStartMs(liveLeftMate.startMs + (nextLeft.startMs - left.startMs)),
        durationMs: liveLeftMate.durationMs + (nextLeft.durationMs - left.durationMs),
        sourceInMs: liveLeftMate.sourceInMs + (nextLeft.sourceInMs - left.sourceInMs),
        sourceOutMs: liveLeftMate.sourceOutMs + (nextLeft.sourceOutMs - left.sourceOutMs),
      })
    : undefined;
  const nextRightMate = liveRightMate
    ? applyNormalizedFades({
        ...liveRightMate,
        startMs: clampStartMs(liveRightMate.startMs + (nextRight.startMs - right.startMs)),
        durationMs: liveRightMate.durationMs + (nextRight.durationMs - right.durationMs),
        sourceInMs: liveRightMate.sourceInMs + (nextRight.sourceInMs - right.sourceInMs),
        sourceOutMs: liveRightMate.sourceOutMs + (nextRight.sourceOutMs - right.sourceOutMs),
      })
    : undefined;
  const byId = new Map<string, Clip>([
    [nextLeft.id, nextLeft],
    [nextRight.id, nextRight],
  ]);
  if (nextLeftMate) byId.set(nextLeftMate.id, nextLeftMate);
  if (nextRightMate) byId.set(nextRightMate.id, nextRightMate);

  return {
    project: {
      ...project,
      updatedAt: new Date().toISOString(),
      clips: project.clips.map((c) => byId.get(c.id) ?? c),
    },
  };
}

function splitOneClip(
  clip: Clip,
  timeMs: number,
  edgeGuardMs: number,
): { left: Clip; right: Clip } | { error: string } {
  const offset = timeMs - clip.startMs;
  if (offset < edgeGuardMs || clip.durationMs - offset < edgeGuardMs) {
    return { error: "Split too close to clip edge" };
  }
  const cutSource = sourceTimeAt(clip, timeMs);
  if (clip.holdSourceMs != null && Number.isFinite(clip.holdSourceMs)) {
    const left: Clip = applyNormalizedFades({ ...clip, durationMs: offset });
    const right: Clip = applyNormalizedFades({
      ...clip,
      id: createId("clip"),
      startMs: timeMs,
      durationMs: clip.durationMs - offset,
    });
    return { left, right };
  }
  if (clip.reversed) {
    const left: Clip = applyNormalizedFades({
      ...clip,
      durationMs: offset,
      sourceInMs: cutSource,
      sourceOutMs: clip.sourceOutMs,
    });
    const right: Clip = applyNormalizedFades({
      ...clip,
      id: createId("clip"),
      startMs: timeMs,
      durationMs: clip.durationMs - offset,
      sourceInMs: clip.sourceInMs,
      sourceOutMs: cutSource,
    });
    return { left, right };
  }
  const left: Clip = applyNormalizedFades({
    ...clip,
    durationMs: offset,
    sourceOutMs: cutSource,
  });
  const right: Clip = applyNormalizedFades({
    ...clip,
    id: createId("clip"),
    startMs: timeMs,
    durationMs: clip.durationMs - offset,
    sourceInMs: cutSource,
    sourceOutMs: clip.sourceOutMs,
  });
  return { left, right };
}

export function splitClipAt(
  project: Project,
  clipId: string,
  timeMs: number,
  edgeGuardMs = SPLIT_EDGE_GUARD_MS,
  opts?: { includeLinkedMate?: boolean },
): { project: Project; leftId?: string; rightId?: string; error?: string } {
  const clip = clipById(project, clipId);
  if (!clip) return { project, error: "Clip not found" };
  if (clipIsLocked(clip)) return { project, error: "Clip is locked" };
  const first = splitOneClip(clip, timeMs, edgeGuardMs);
  if ("error" in first) return { project, error: first.error };
  const mate = livingLinkedMate(project, clipId);
  const forceSolo = opts?.includeLinkedMate === false;
  const liveMate = forceSolo ? undefined : editableLinkedMate(project, clipId);
  const skipParkedMate = forceSolo || Boolean(mate && !liveMate);
  let mateParts: { left: Clip; right: Clip } | undefined;
  if (liveMate) {
    const second = splitOneClip(liveMate, timeMs, edgeGuardMs);
    if ("error" in second) return { project, error: second.error };
    mateParts = second;
  }
  const rightLink = mateParts && clip.linkId ? createId("link") : undefined;
  const left = skipParkedMate ? { ...first.left, linkId: undefined } : first.left;
  const right = skipParkedMate
    ? { ...first.right, linkId: undefined }
    : rightLink
      ? { ...first.right, linkId: rightLink }
      : first.right;
  const mateLeft = mateParts?.left;
  const mateRight =
    mateParts && rightLink ? { ...mateParts.right, linkId: rightLink } : mateParts?.right;
  const parkedMateId = skipParkedMate ? mate?.id : undefined;

  return {
    project: {
      ...project,
      updatedAt: new Date().toISOString(),
      clips: project.clips.flatMap((c) => {
        if (c.id === clipId) return [left, right];
        if (liveMate && c.id === liveMate.id && mateLeft && mateRight) return [mateLeft, mateRight];
        if (parkedMateId && c.id === parkedMateId) return [{ ...c, linkId: undefined }];
        return [c];
      }),
    },
    leftId: left.id,
    rightId: right.id,
  };
}

export function splitAtPlayhead(
  project: Project,
  edgeGuardMs = SPLIT_EDGE_GUARD_MS,
  onlyClipIds?: readonly string[],
  opts?: { includeLinkedMate?: boolean },
): { project: Project; error?: string } {
  const allow = onlyClipIds ? new Set(onlyClipIds) : null;
  const hits = project.clips.filter(
    (c) =>
      (!allow || allow.has(c.id)) &&
      clipIsEnabled(c) &&
      project.playheadMs > c.startMs &&
      project.playheadMs < clipEndMs(c),
  );
  if (hits.length === 0) {
    return {
      project,
      error: allow ? "No selected clip under playhead" : "No clip under playhead",
    };
  }
  let next = project;
  let lastError: string | undefined;
  let splitAny = false;
  for (const clip of hits) {
    const result = splitClipAt(next, clip.id, next.playheadMs, edgeGuardMs, opts);
    if (result.error) lastError = result.error;
    else {
      next = result.project;
      splitAny = true;
    }
  }
  if (!splitAny) return { project, error: lastError ?? "Split rejected" };
  return { project: next };
}

/** Valid edit range [in, out) or null. */
export function editRangeOf(project: Project): { inMs: number; outMs: number } | null {
  const inMs = project.inPointMs;
  const outMs = project.outPointMs;
  if (inMs == null || outMs == null || outMs <= inMs) return null;
  return { inMs, outMs };
}

function splitAllAtTime(project: Project, timeMs: number): Project {
  const hits = project.clips.filter(
    (c) => clipIsEnabled(c) && c.startMs < timeMs && clipEndMs(c) > timeMs,
  );
  let next = project;
  for (const clip of hits) {
    const current = clipById(next, clip.id);
    if (!current) continue;
    if (!(current.startMs < timeMs && clipEndMs(current) > timeMs)) continue;
    const result = splitClipAt(next, current.id, timeMs);
    if (!result.error) next = result.project;
  }
  return next;
}

function clipsFullyInsideRange(project: Project, inMs: number, outMs: number): Clip[] {
  return project.clips.filter(
    (c) =>
      clipIsEnabled(c) &&
      !clipIsLocked(c) &&
      c.startMs >= inMs &&
      clipEndMs(c) <= outMs,
  );
}

/**
 * Range lift deletes unlocked enabled mids only. A locked mate stays
 * parked (P110). A disabled mate stays parked and is unlinked (same as
 * lift-delete skip locked mate).
 */
function deleteUnlockedClips(project: Project, clipIds: readonly string[]): Project {
  const drop = new Set(
    expandLinkedClipIds(project, clipIds).filter((id) => {
      const clip = clipById(project, id);
      return clip != null && !clipIsLocked(clip) && clipIsEnabled(clip);
    }),
  );
  if (drop.size === 0) return project;
  return dropClipsAndOrphanLinks(project, drop);
}

/** Split every clip that straddles IN or OUT (50ms guard). */
export function splitAtRangeBounds(project: Project): Project {
  const range = editRangeOf(project);
  if (!range) return project;
  return splitAllAtTime(splitAllAtTime(project, range.inMs), range.outMs);
}

/**
 * Split at IN/OUT, then lift pieces that lie fully inside [in, out).
 * Later clips stay. Invalid range is a no-op.
 * Locked clips are not split or deleted (lock is relocate-only; range lift
 * is not an explicit selection delete). Disabled clips stay parked
 * (same as G / extract later-disabled / roll-slide neighbor).
 */
export function liftRange(project: Project): { project: Project } {
  const range = editRangeOf(project);
  if (!range) return { project };
  const split = splitAtRangeBounds(project);
  const mids = clipsFullyInsideRange(split, range.inMs, range.outMs);
  if (mids.length === 0 && split === project) return { project };
  return { project: deleteUnlockedClips(split, mids.map((c) => c.id)) };
}

function clipStraddlesTime(clip: Clip, timeMs: number): boolean {
  return clip.startMs < timeMs && clipEndMs(clip) > timeMs;
}

/** Locked later enabled clip, locked straddler, or locked mid lift left parked. */
function lockedClipBlocksExtract(
  project: Project,
  range: { inMs: number; outMs: number },
): boolean {
  return project.clips.some((c) => {
    if (!clipIsLocked(c)) return false;
    if (c.startMs >= range.outMs) return clipIsEnabled(c);
    if (clipStraddlesTime(c, range.inMs) || clipStraddlesTime(c, range.outMs)) return true;
    return c.startMs >= range.inMs && clipEndMs(c) <= range.outMs;
  });
}

/**
 * liftRange, then on each track shift enabled clips that start at/after OUT
 * left by (out−in). Later disabled clips stay parked (same as G / Q/W /
 * ripple-delete). A locked enabled clip at/after OUT, one that straddles
 * IN/OUT, or one fully inside the window still blocks (P109–P112).
 */
export function extractRange(project: Project): { project: Project; error?: string } {
  const range = editRangeOf(project);
  if (!range) return { project };
  if (lockedClipBlocksExtract(project, range)) {
    return { project, error: "Clip is locked" };
  }
  const lifted = liftRange(project).project;
  const span = range.outMs - range.inMs;
  let moved = lifted !== project;
  const clips = lifted.clips.map((c) => {
    if (c.startMs < range.outMs) return c;
    if (!clipIsEnabled(c)) return c;
    moved = true;
    return { ...c, startMs: clampStartMs(c.startMs - span) };
  });
  if (!moved) return { project };
  return {
    project: {
      ...lifted,
      clips,
      updatedAt: new Date().toISOString(),
    },
  };
}

export interface SnapTarget {
  timeMs: number;
  kind: "clip-start" | "clip-end" | "playhead" | "in" | "out" | "zero" | "marker";
}

export function collectSnapTargets(
  project: Project,
  ignoreClipId?: string | readonly string[],
  ignoreMarkerId?: string,
): SnapTarget[] {
  const ignore = new Set(
    ignoreClipId == null ? [] : typeof ignoreClipId === "string" ? [ignoreClipId] : ignoreClipId,
  );
  const targets: SnapTarget[] = [{ timeMs: 0, kind: "zero" }];
  if (project.snap) {
    targets.push({ timeMs: project.playheadMs, kind: "playhead" });
    if (project.inPointMs != null) targets.push({ timeMs: project.inPointMs, kind: "in" });
    if (project.outPointMs != null) targets.push({ timeMs: project.outPointMs, kind: "out" });
    for (const clip of project.clips) {
      if (ignore.has(clip.id) || !clipIsEnabled(clip)) continue;
      targets.push({ timeMs: clip.startMs, kind: "clip-start" });
      targets.push({ timeMs: clipEndMs(clip), kind: "clip-end" });
    }
    for (const marker of project.markers) {
      if (marker.id === ignoreMarkerId) continue;
      targets.push({ timeMs: marker.timeMs, kind: "marker" });
    }
  }
  return targets;
}

/** Ruler/lane seek: same snap as clip move, but ignore current playhead so the needle is not sticky. */
export function snapPlayheadSeek(project: Project, timeMs: number): number {
  const raw = Math.max(0, timeMs);
  if (!project.snap) return raw;
  const targets = collectSnapTargets(project).filter((t) => t.kind !== "playhead");
  return Math.max(0, snapTime(raw, targets).timeMs);
}

/** Clip/IN/OUT/playhead/marker snaps plus other VIS event edges. */
export function collectVisEventSnapTargets(
  project: Project,
  ignoreEventId?: string,
): SnapTarget[] {
  const targets = collectSnapTargets(project);
  if (!project.snap) return targets;
  for (const event of visualizerEventsOf(project)) {
    if (event.id === ignoreEventId) continue;
    targets.push({ timeMs: event.startMs, kind: "clip-start" });
    targets.push({ timeMs: event.startMs + event.durationMs, kind: "clip-end" });
  }
  return targets;
}

/**
 * Deduped cut-list for CutStrip + ArrowUp/Down.
 * Clip edges, markers, IN/OUT, finite VIS window, VIS events, stored
 * fadeBlack/fadeWhite/crossfade/cut windows (video + audio duration ends).
 * durationMs<=0 VIS covers the whole timeline and is not a stop.
 */
export function collectEditPoints(project: Project): number[] {
  const times = new Set<number>();
  for (const clip of project.clips) {
    if (!clipIsEnabled(clip)) continue;
    times.add(clip.startMs);
    times.add(clipEndMs(clip));
  }
  for (const marker of project.markers) {
    times.add(marker.timeMs);
  }
  if (project.inPointMs != null) times.add(project.inPointMs);
  if (project.outPointMs != null) times.add(project.outPointMs);
  const visDur = project.visualizer.durationMs ?? 0;
  if (visDur > 0) {
    const visStart = Math.max(0, project.visualizer.startMs ?? 0);
    times.add(visStart);
    times.add(visStart + visDur);
  }
  for (const event of visualizerEventsOf(project)) {
    times.add(event.startMs);
    times.add(event.startMs + Math.max(0, event.durationMs));
  }
  for (const t of project.transitions ?? []) {
    times.add(t.startMs);
    if (t.durationMs > 0) times.add(t.startMs + t.durationMs);
    const audioDur = t.audioDurationMs ?? 0;
    if (audioDur > 0) times.add(t.startMs + audioDur);
  }
  return [...times].filter((t) => Number.isFinite(t)).sort((a, b) => a - b);
}

/** Nearest time in `collectEditPoints`. Empty project → undefined. */
export function nearestEditPointMs(project: Project, fromMs: number): number | undefined {
  const points = collectEditPoints(project);
  if (!points.length) return undefined;
  let best = points[0]!;
  let bestDist = Math.abs(best - fromMs);
  for (const t of points) {
    const d = Math.abs(t - fromMs);
    if (d < bestDist) {
      best = t;
      bestDist = d;
    }
  }
  return best;
}

export function nextEditPointMs(project: Project, fromMs: number): number | null {
  for (const t of collectEditPoints(project)) {
    if (t > fromMs) return t;
  }
  return null;
}

export function prevEditPointMs(project: Project, fromMs: number): number | null {
  const points = collectEditPoints(project);
  for (let i = points.length - 1; i >= 0; i--) {
    if (points[i]! < fromMs) return points[i]!;
  }
  return null;
}

export function snapTime(
  timeMs: number,
  targets: SnapTarget[],
  thresholdMs = SNAP_THRESHOLD_MS,
): { timeMs: number; snapped: boolean; target?: SnapTarget } {
  let best: SnapTarget | undefined;
  let bestDist = thresholdMs;
  for (const target of targets) {
    const dist = Math.abs(target.timeMs - timeMs);
    if (dist <= bestDist) {
      bestDist = dist;
      best = target;
    }
  }
  if (!best) return { timeMs, snapped: false };
  return { timeMs: best.timeMs, snapped: true, target: best };
}

export function setInPoint(
  project: Project,
  timeMs: number,
  opts?: { replace?: boolean },
): { project: Project; error?: string } {
  const t = Math.max(0, timeMs);
  if (opts?.replace) {
    if (project.outPointMs != null && t > project.outPointMs) {
      return {
        project: {
          ...project,
          inPointMs: project.outPointMs,
          outPointMs: t,
          updatedAt: new Date().toISOString(),
        },
      };
    }
    return { project: { ...project, inPointMs: t, updatedAt: new Date().toISOString() } };
  }
  if (project.outPointMs != null && t > project.outPointMs) {
    return { project, error: "IN cannot be after OUT" };
  }
  return { project: { ...project, inPointMs: t, updatedAt: new Date().toISOString() } };
}

export function setOutPoint(
  project: Project,
  timeMs: number,
  opts?: { replace?: boolean },
): { project: Project; error?: string } {
  const t = Math.max(0, timeMs);
  if (opts?.replace) {
    if (project.inPointMs != null && t < project.inPointMs) {
      return {
        project: {
          ...project,
          inPointMs: t,
          outPointMs: project.inPointMs,
          updatedAt: new Date().toISOString(),
        },
      };
    }
    return { project: { ...project, outPointMs: t, updatedAt: new Date().toISOString() } };
  }
  if (project.inPointMs != null && t < project.inPointMs) {
    return { project, error: "OUT cannot be before IN" };
  }
  return { project: { ...project, outPointMs: t, updatedAt: new Date().toISOString() } };
}

export function moveInOut(
  project: Project,
  deltaMs: number,
): { project: Project; error?: string } {
  if (project.inPointMs == null || project.outPointMs == null) {
    return { project, error: "No loop range" };
  }
  const duration = project.outPointMs - project.inPointMs;
  const inMs = Math.max(0, project.inPointMs + deltaMs);
  return {
    project: {
      ...project,
      inPointMs: inMs,
      outPointMs: inMs + duration,
      updatedAt: new Date().toISOString(),
    },
  };
}

/** VIS-only (no clips) is 0. Origin is the earliest clip start when clips exist. */
export function earliestClipStartMs(project: Project): number {
  if (project.clips.length === 0) return 0;
  let min = project.clips[0]!.startMs;
  for (const clip of project.clips) {
    if (clip.startMs < min) min = clip.startMs;
  }
  return min;
}

export const ORIGIN_LEAD_MS = 250;

export function originScrollMs(project: Project): number {
  return Math.max(0, earliestClipStartMs(project) - ORIGIN_LEAD_MS);
}

export function maybeScrollToOrigin(
  project: Project,
  opts: { prevScrollMs: number; prevClipCount: number },
): Project {
  if (project.clips.length === 0) return project;
  const firstPlace = opts.prevClipCount === 0;
  if (opts.prevScrollMs !== 0 && !firstPlace) return project;
  return { ...project, scrollMs: originScrollMs(project) };
}

export function clearInOut(project: Project): Project {
  return { ...project, inPointMs: null, outPointMs: null, updatedAt: new Date().toISOString() };
}

export function setPlayhead(project: Project, timeMs: number): Project {
  return { ...project, playheadMs: Math.max(0, timeMs) };
}

export function toggleLoop(project: Project): Project {
  return { ...project, loop: !project.loop };
}

export function toggleSnap(project: Project): Project {
  return { ...project, snap: !project.snap };
}

export function setTrackVolume(project: Project, trackId: TrackId, volume: number): Project {
  const v = Math.max(0, Math.min(2, Number(volume) || 0));
  return {
    ...project,
    tracks: project.tracks.map((t) => (t.id === trackId ? { ...t, volume: v } : t)),
    updatedAt: new Date().toISOString(),
  };
}

export function setTrackPan(project: Project, trackId: TrackId, pan: number): Project {
  const p = Math.max(-1, Math.min(1, Number.isFinite(pan) ? pan : 0));
  return {
    ...project,
    tracks: project.tracks.map((t) => (t.id === trackId ? { ...t, pan: p } : t)),
    updatedAt: new Date().toISOString(),
  };
}

export function setMasterVolume(project: Project, volume: number): Project {
  const v = Math.max(0, Math.min(2, Number(volume) || 0));
  return { ...project, masterVolume: v, updatedAt: new Date().toISOString() };
}

export function toggleTrackMute(project: Project, trackId: TrackId): Project {
  return {
    ...project,
    tracks: project.tracks.map((t) =>
      t.id === trackId ? { ...t, muted: !t.muted } : t,
    ),
    updatedAt: new Date().toISOString(),
  };
}

export function toggleTrackSolo(project: Project, trackId: TrackId): Project {
  return {
    ...project,
    tracks: project.tracks.map((t) =>
      t.id === trackId ? { ...t, solo: !t.solo } : t,
    ),
    updatedAt: new Date().toISOString(),
  };
}

export function addMarker(project: Project, timeMs: number, label?: string): Project {
  const marker: Marker = {
    id: createId("mk"),
    timeMs: Math.max(0, timeMs),
    label: label ?? `M${project.markers.length + 1}`,
  };
  return {
    ...project,
    markers: [...project.markers, marker],
    updatedAt: new Date().toISOString(),
  };
}

export function moveMarker(
  project: Project,
  markerId: string,
  timeMs: number,
): { project: Project; error?: string } {
  if (!project.markers.some((m) => m.id === markerId)) {
    return { project, error: "Marker not found" };
  }
  const nextTime = Math.max(0, timeMs);
  return {
    project: {
      ...project,
      markers: project.markers.map((m) => (m.id === markerId ? { ...m, timeMs: nextTime } : m)),
      updatedAt: new Date().toISOString(),
    },
  };
}

export function deleteMarker(
  project: Project,
  markerId: string,
): { project: Project; error?: string } {
  if (!project.markers.some((m) => m.id === markerId)) {
    return { project, error: "Marker not found" };
  }
  return {
    project: {
      ...project,
      markers: project.markers.filter((m) => m.id !== markerId),
      updatedAt: new Date().toISOString(),
    },
  };
}

export function renameMarker(
  project: Project,
  markerId: string,
  label: string,
): { project: Project; error?: string } {
  const marker = project.markers.find((m) => m.id === markerId);
  if (!marker) return { project, error: "Marker not found" };
  const nextLabel = label.trim();
  if (!nextLabel || nextLabel === marker.label) return { project };
  return {
    project: {
      ...project,
      markers: project.markers.map((m) => (m.id === markerId ? { ...m, label: nextLabel } : m)),
      updatedAt: new Date().toISOString(),
    },
  };
}

/** Same-kind track, clamped to the project's video or audio collection. `delta` is a lane step within that kind. */
export function clampSameKindTrack(
  trackId: TrackId,
  delta = 0,
  project?: Pick<Project, "tracks">,
): TrackId {
  const kind = kindOfTrack(trackId);
  const lane = (project ? trackIdsOf(project) : TRACK_IDS).filter((id) => kindOfTrack(id) === kind);
  const idx = Math.max(0, lane.indexOf(trackId));
  return lane[Math.max(0, Math.min(lane.length - 1, idx + delta))] ?? trackId;
}

/**
 * Place clipboard snapshots at `atMs`. Earliest clip lands on the playhead;
 * others keep relative start and same-kind track offsets. New ids.
 */
export function pasteClips(
  project: Project,
  clips: readonly Clip[],
  atMs: number,
): { project: Project; clipIds: string[]; error?: string } {
  if (clips.length === 0) return { project, clipIds: [], error: "Clipboard empty" };
  const origin = Math.min(...clips.map((c) => c.startMs));
  const rawStarts = clips.map((c) => atMs + (c.startMs - origin));
  const pad = Math.max(0, -Math.min(...rawStarts));
  const nextClips = [...project.clips];
  const clipIds: string[] = [];
  clips.forEach((clip, i) => {
    const copy: Clip = {
      ...clip,
      id: createId("clip"),
      startMs: clampStartMs((rawStarts[i] ?? atMs) + pad),
      trackId: clampSameKindTrack(clip.trackId, 0, project),
    };
    nextClips.push(copy);
    clipIds.push(copy.id);
  });
  const remapped = remapPastedLinkIds(nextClips.slice(project.clips.length));
  const merged = [...project.clips, ...remapped];
  return {
    project: {
      ...project,
      clips: merged,
      updatedAt: new Date().toISOString(),
    },
    clipIds,
  };
}

export type SlideBlock =
  | { mids: Clip[]; left: Clip; right: Clip }
  | { error: string };

/**
 * One clip, or 2+ same-track clips that abut (≤1ms) with outer neighbors on
 * both sides. Cross-track, internal gap, or missing outer neighbor → error.
 */
export function resolveSlideBlock(
  project: Project,
  clipIds: readonly string[],
): SlideBlock {
  const unique = [...new Set(clipIds.filter(Boolean))];
  if (unique.length === 0) return { error: "Clip not found" };
  const found: Clip[] = [];
  for (const id of unique) {
    const clip = clipById(project, id);
    if (!clip) return { error: "Clip not found" };
    found.push(clip);
  }
  const trackId = found[0]!.trackId;
  if (found.some((c) => c.trackId !== trackId)) {
    return { error: "Slide block must be on one track" };
  }
  const mids = [...found].sort((a, b) => a.startMs - b.startMs || a.id.localeCompare(b.id));
  for (let i = 1; i < mids.length; i++) {
    if (Math.abs(clipEndMs(mids[i - 1]!) - mids[i]!.startMs) > ABUT_TOLERANCE_MS) {
      return { error: "Slide requires a contiguous block" };
    }
  }
  const left = abuttingNeighbor(project, mids[0]!.id, "in");
  const right = abuttingNeighbor(project, mids[mids.length - 1]!.id, "out");
  if (!left || !right) {
    return { error: "Slide requires abutting clips on both sides" };
  }
  return { mids, left, right };
}

export function isSlideBlock(project: Project, clipIds: readonly string[]): boolean {
  const living = enabledSelectedIds(project, clipIds);
  return living.length >= 2 && !("error" in resolveSlideBlock(project, living));
}

/** 2+ selection: only enabled members participate (same as multi-select S). */
function enabledSelectedIds(project: Project, clipIds: readonly string[]): string[] {
  return [...new Set(clipIds.filter(Boolean))].filter((id) => {
    const clip = clipById(project, id);
    return clip != null && clipIsEnabled(clip);
  });
}

function applySlideThroughNeighbors(
  project: Project,
  mids: readonly Clip[],
  left: Clip,
  right: Clip,
  deltaMs: number,
): { project: Project; error?: string } {
  if (!Number.isFinite(deltaMs) || deltaMs === 0) return { project };

  const leftAsset = project.assets.find((a) => a.id === left.assetId);
  const maxGrowLeft = leftAsset
    ? Math.max(0, sourceDeltaToTimeline(left, leftAsset.durationMs - left.sourceOutMs))
    : Number.POSITIVE_INFINITY;
  const maxPos = Math.max(
    0,
    Math.min(right.durationMs - SPLIT_EDGE_GUARD_MS, maxGrowLeft),
  );
  const maxNeg = Math.max(
    0,
    Math.min(left.durationMs - SPLIT_EDGE_GUARD_MS, sourceDeltaToTimeline(right, right.sourceInMs)),
  );
  const delta = Math.max(-maxNeg, Math.min(maxPos, deltaMs));
  if (delta === 0) return { project, error: "Cannot slide further" };

  const nextLeft = applyNormalizedFades({
    ...left,
    durationMs: left.durationMs + delta,
    sourceOutMs: left.sourceOutMs + timelineDeltaToSource(left, delta),
  });
  const nextMids = mids.map((mid) => ({
    ...mid,
    startMs: mid.startMs + delta,
  }));
  const nextRight = applyNormalizedFades({
    ...right,
    startMs: right.startMs + delta,
    durationMs: right.durationMs - delta,
    sourceInMs: right.sourceInMs + timelineDeltaToSource(right, delta),
  });
  const byId = new Map<string, Clip>([
    [nextLeft.id, nextLeft],
    ...nextMids.map((c) => [c.id, c] as const),
    [nextRight.id, nextRight],
  ]);
  const before = [left, ...mids, right];
  const after = [nextLeft, ...nextMids, nextRight];
  for (let i = 0; i < before.length; i++) {
    const mate = editableLinkedMate(project, before[i]!.id);
    if (!mate || byId.has(mate.id)) continue;
    const next = after[i]!;
    const orig = before[i]!;
    byId.set(
      mate.id,
      applyNormalizedFades({
        ...mate,
        startMs: clampStartMs(mate.startMs + (next.startMs - orig.startMs)),
        durationMs: mate.durationMs + (next.durationMs - orig.durationMs),
        sourceInMs: mate.sourceInMs + (next.sourceInMs - orig.sourceInMs),
        sourceOutMs: mate.sourceOutMs + (next.sourceOutMs - orig.sourceOutMs),
      }),
    );
  }

  return {
    project: {
      ...project,
      updatedAt: new Date().toISOString(),
      clips: project.clips.map((c) => byId.get(c.id) ?? c),
    },
  };
}

/**
 * Classic slide: middle clip keeps duration and source in/out and moves on
 * the timeline. The previous abutting clip absorbs the left delta (duration /
 * source out). The next abutting clip absorbs the right delta (start / source in).
 * The three-clip span stays constant. A missing or non-abutting neighbor is a
 * hard stop on that side (no hole, no overlap). Delta is clamped so neither
 * neighbor drops below SPLIT_EDGE_GUARD_MS and source windows stay in media.
 * A living unlocked linked mate takes the same edge/start delta. A locked
 * mate is skipped (same as roll/split/slip/rate).
 * A disabled mid is refused (Ctrl+Alt-drag must not trim living neighbors).
 */
export function slideClip(
  project: Project,
  clipId: string,
  deltaMs: number,
): { project: Project; error?: string } {
  const mid = clipById(project, clipId);
  if (!mid) return { project, error: "Clip not found" };
  if (clipIsLocked(mid)) return { project, error: "Clip is locked" };
  if (!clipIsEnabled(mid)) return { project, error: "Clip is disabled" };
  if (!Number.isFinite(deltaMs) || deltaMs === 0) return { project };

  const left = abuttingNeighbor(project, clipId, "in");
  const right = abuttingNeighbor(project, clipId, "out");
  if (!left || !right) {
    return { project, error: "Slide requires abutting clips on both sides" };
  }
  if (clipIsLocked(left) || clipIsLocked(right)) return { project, error: "Clip is locked" };
  return applySlideThroughNeighbors(project, [mid], left, right, deltaMs);
}

/**
 * Slide one clip (`slideClip`) or a contiguous same-track selection as one
 * middle block. Inner clips keep relative starts and source in/out. Outer
 * previous absorbs left; outer next absorbs right. Rate is unchanged.
 */
export function slideClips(
  project: Project,
  clipIds: readonly string[],
  deltaMs: number,
): { project: Project; error?: string } {
  const unique = [...new Set(clipIds.filter(Boolean))];
  if (unique.length <= 1) return slideClip(project, unique[0] ?? "", deltaMs);
  const living = enabledSelectedIds(project, unique);
  if (living.length <= 1) return slideClip(project, living[0] ?? "", deltaMs);
  if (!Number.isFinite(deltaMs) || deltaMs === 0) return { project };
  const block = resolveSlideBlock(project, living);
  if ("error" in block) return { project, error: block.error };
  if (
    block.mids.some(clipIsLocked) ||
    clipIsLocked(block.left) ||
    clipIsLocked(block.right)
  ) {
    return { project, error: "Clip is locked" };
  }
  return applySlideThroughNeighbors(project, block.mids, block.left, block.right, deltaMs);
}

function slipSourceWindow(
  clip: Clip,
  sourceDelta: number,
  maxOut: number,
): { sourceInMs: number; sourceOutMs: number } | { error: string } {
  const span = sourceSpanMs(clip);
  const sourceInMs = clip.sourceInMs + sourceDelta;
  const sourceOutMs = sourceInMs + span;
  if (sourceInMs < 0 || sourceOutMs > maxOut) return { error: "Cannot slip further" };
  return { sourceInMs, sourceOutMs };
}

export type SlipBlock = { clips: Clip[] } | { error: string };

/**
 * 2+ same-track clips that abut (≤1ms). Cross-track or internal gap → error.
 * Outer neighbors are not required (slip does not move them).
 */
export function resolveSlipBlock(
  project: Project,
  clipIds: readonly string[],
): SlipBlock {
  const unique = [...new Set(clipIds.filter(Boolean))];
  if (unique.length === 0) return { error: "Clip not found" };
  const found: Clip[] = [];
  for (const id of unique) {
    const clip = clipById(project, id);
    if (!clip) return { error: "Clip not found" };
    found.push(clip);
  }
  const trackId = found[0]!.trackId;
  if (found.some((c) => c.trackId !== trackId)) {
    return { error: "Slip block must be on one track" };
  }
  const clips = [...found].sort((a, b) => a.startMs - b.startMs || a.id.localeCompare(b.id));
  for (let i = 1; i < clips.length; i++) {
    if (Math.abs(clipEndMs(clips[i - 1]!) - clips[i]!.startMs) > ABUT_TOLERANCE_MS) {
      return { error: "Slip requires a contiguous block" };
    }
  }
  return { clips };
}

export function isSlipBlock(project: Project, clipIds: readonly string[]): boolean {
  const living = enabledSelectedIds(project, clipIds);
  return living.length >= 2 && !("error" in resolveSlipBlock(project, living));
}

function applySlipSourceDelta(
  project: Project,
  clips: readonly Clip[],
  sourceDelta: number,
): { project: Project; error?: string } {
  const targets = new Map<string, Clip>();
  for (const clip of clips) {
    if (clipIsLocked(clip)) return { project, error: "Clip is locked" };
    targets.set(clip.id, clip);
    const mate = editableLinkedMate(project, clip.id);
    if (mate) targets.set(mate.id, mate);
  }
  const nextById = new Map<string, Clip>();
  for (const clip of targets.values()) {
    const asset = project.assets.find((a) => a.id === clip.assetId);
    const maxOut = asset?.durationMs ?? Number.POSITIVE_INFINITY;
    const window = slipSourceWindow(clip, sourceDelta, maxOut);
    if ("error" in window) return { project, error: "Cannot slip further" };
    nextById.set(clip.id, { ...clip, sourceInMs: window.sourceInMs, sourceOutMs: window.sourceOutMs });
  }
  if ([...nextById.values()].every((next) => next.sourceInMs === targets.get(next.id)!.sourceInMs)) {
    return { project };
  }
  return {
    project: {
      ...project,
      clips: project.clips.map((c) => nextById.get(c.id) ?? c),
      updatedAt: new Date().toISOString(),
    },
  };
}

/**
 * Slide source in/out. Timeline start and duration stay put.
 * Clamps sourceIn ≥ 0 and sourceOut ≤ asset duration.
 * A living linked mate takes the same source delta or both no-op.
 */
export function slipClip(
  project: Project,
  clipId: string,
  deltaMs: number,
): { project: Project; error?: string } {
  const clip = clipById(project, clipId);
  if (!clip) return { project, error: "Clip not found" };
  if (clipIsLocked(clip)) return { project, error: "Clip is locked" };
  const asset = project.assets.find((a) => a.id === clip.assetId);
  const maxOut = asset?.durationMs ?? Number.POSITIVE_INFINITY;
  const span = sourceSpanMs(clip);
  const sourceDelta = timelineDeltaToSource(clip, deltaMs);
  const liveMate = editableLinkedMate(project, clipId);
  if (!liveMate) {
    const maxIn = maxOut - span;
    const sourceInMs = Math.min(Math.max(0, clip.sourceInMs + sourceDelta), Math.max(0, maxIn));
    if (sourceInMs === clip.sourceInMs) return { project };
    const next: Clip = {
      ...clip,
      sourceInMs,
      sourceOutMs: sourceInMs + span,
    };
    return {
      project: {
        ...project,
        clips: project.clips.map((c) => (c.id === clipId ? next : c)),
        updatedAt: new Date().toISOString(),
      },
    };
  }
  const mateAsset = project.assets.find((a) => a.id === liveMate.assetId);
  const mateMax = mateAsset?.durationMs ?? Number.POSITIVE_INFINITY;
  const one = slipSourceWindow(clip, sourceDelta, maxOut);
  const two = slipSourceWindow(liveMate, sourceDelta, mateMax);
  if ("error" in one || "error" in two) {
    return { project, error: "Cannot slip further" };
  }
  if (one.sourceInMs === clip.sourceInMs && two.sourceInMs === liveMate.sourceInMs) return { project };
  const next: Clip = { ...clip, sourceInMs: one.sourceInMs, sourceOutMs: one.sourceOutMs };
  const nextMate: Clip = { ...liveMate, sourceInMs: two.sourceInMs, sourceOutMs: two.sourceOutMs };
  return {
    project: {
      ...project,
      clips: project.clips.map((c) => {
        if (c.id === clipId) return next;
        if (c.id === liveMate.id) return nextMate;
        return c;
      }),
      updatedAt: new Date().toISOString(),
    },
  };
}

/**
 * Slip one clip (`slipClip`) or a contiguous same-track selection as one
 * source-clock block. Start and duration stay. Neighbors do not move.
 * Every member and any living linked mate take the same source delta, or
 * the whole group no-ops. Mixed tracks or an internal gap no-op.
 */
export function slipClips(
  project: Project,
  clipIds: readonly string[],
  deltaMs: number,
): { project: Project; error?: string } {
  const unique = [...new Set(clipIds.filter(Boolean))];
  if (unique.length <= 1) return slipClip(project, unique[0] ?? "", deltaMs);
  const living = enabledSelectedIds(project, unique);
  if (living.length <= 1) return slipClip(project, living[0] ?? "", deltaMs);
  if (!Number.isFinite(deltaMs) || deltaMs === 0) return { project };
  const block = resolveSlipBlock(project, living);
  if ("error" in block) return { project, error: block.error };
  const primary = clipById(project, unique[0]!) ?? block.clips[0]!;
  const sourceDelta = timelineDeltaToSource(primary, deltaMs);
  return applySlipSourceDelta(project, block.clips, sourceDelta);
}

export function duplicateClip(
  project: Project,
  clipId: string,
  atMs?: number,
): { project: Project; clip?: Clip; error?: string } {
  const clip = clipById(project, clipId);
  if (!clip) return { project, error: "Clip not found" };
  const copy: Clip = {
    ...clip,
    id: createId("clip"),
    startMs: clampStartMs(atMs ?? clipEndMs(clip)),
  };
  return {
    project: {
      ...project,
      clips: [...project.clips, copy],
      updatedAt: new Date().toISOString(),
    },
    clip: copy,
  };
}

export function updateClip(
  project: Project,
  clipId: string,
    patch: Partial<Pick<Clip, "startMs" | "durationMs" | "sourceInMs" | "sourceOutMs" | "gain" | "trackId" | "fadeInMs" | "fadeOutMs" | "enabled" | "locked">>,
): { project: Project; error?: string } {
  const clip = clipById(project, clipId);
  if (!clip) return { project, error: "Clip not found" };
  const relocates =
    patch.startMs != null ||
    patch.durationMs != null ||
    patch.sourceInMs != null ||
    patch.sourceOutMs != null ||
    patch.trackId != null;
  if (clipIsLocked(clip) && relocates) return { project, error: "Clip is locked" };
  if (
    patch.trackId &&
    (!isTrackId(patch.trackId) || kindOfTrack(patch.trackId) !== kindOfTrack(clip.trackId))
  ) {
    return { project, error: "Cannot change clip to a different kind of track" };
  }

  let next: Clip = { ...clip, ...patch };
  if (patch.sourceInMs != null || patch.sourceOutMs != null) {
    const asset = project.assets.find((a) => a.id === clip.assetId);
    const maxOut = asset?.durationMs ?? next.sourceOutMs;
    next.sourceInMs = Math.max(0, next.sourceInMs);
    next.sourceOutMs = Math.max(next.sourceInMs + 1, Math.min(maxOut, next.sourceOutMs));
    next.durationMs = Math.max(1, sourceDeltaToTimeline(next, next.sourceOutMs - next.sourceInMs));
  }
  if (patch.durationMs != null) {
    next.durationMs = Math.max(1, patch.durationMs);
    next.sourceOutMs = next.sourceInMs + timelineDeltaToSource(next, next.durationMs);
  }
  next.startMs = clampStartMs(next.startMs);
  next.gain = Math.max(0, Math.min(4, next.gain));
  next.rate = clampClipRate(next.rate);
  next = applyNormalizedFades(next);

  return {
    project: {
      ...project,
      clips: project.clips.map((c) => (c.id === clipId ? next : c)),
      updatedAt: new Date().toISOString(),
    },
  };
}

/**
 * Fade in/out on one clip. A living unlocked linked mate gets the same
 * fade lengths (clamped to its duration). A locked mate is skipped
 * (same as split/slip/rate/roll/slide/ripple-trim). Lock does not block
 * fades on the clip itself.
 */
export function setClipFades(
  project: Project,
  clipId: string,
  fadeInMs: number,
  fadeOutMs: number,
): { project: Project; error?: string } {
  const clip = clipById(project, clipId);
  if (!clip) return { project, error: "Clip not found" };
  const one = updateClip(project, clipId, { fadeInMs, fadeOutMs });
  if (one.error) return one;
  const liveMate = editableLinkedMate(one.project, clipId);
  if (!liveMate) return one;
  const two = updateClip(one.project, liveMate.id, { fadeInMs, fadeOutMs });
  if (two.error) return { project: one.project, error: two.error };
  return two;
}

function planClipRate(
  project: Project,
  clip: Clip,
  rate: number,
): { clip: Clip } | { error: string } | { unchanged: true } {
  const nextRate = clampClipRate(rate);
  const wanted = timelineDurationForRate(sourceSpanMs(clip), nextRate);
  const nextNeighbor = project.clips
    .filter(
      (c) =>
        c.trackId === clip.trackId &&
        c.id !== clip.id &&
        c.startMs > clip.startMs &&
        (clipIsEnabled(c) || clipIsLocked(c)),
    )
    .sort((a, b) => a.startMs - b.startMs)[0];
  const available = nextNeighbor
    ? Math.max(0, nextNeighbor.startMs - clip.startMs)
    : Number.POSITIVE_INFINITY;
  if (wanted > available + ABUT_TOLERANCE_MS) {
    const clamped = Math.max(1, available);
    if (Math.abs(clamped * nextRate - sourceSpanMs(clip)) > 1) {
      return { error: "Rate would overlap the next clip" };
    }
  }
  const durationMs = Math.min(wanted, available);
  if (durationMs < 1) return { error: "Rate would overlap the next clip" };
  if (nextRate === clip.rate && durationMs === clip.durationMs) return { unchanged: true };
  return {
    clip: applyNormalizedFades({
      ...clip,
      rate: nextRate,
      durationMs,
    }),
  };
}

/**
 * Classic NLE speed: source in/out stay. durationMs = sourceSpan / rate.
 * Grows/shrinks to the right. Overlap with the next same-track enabled
 * or locked clip is a hard reject (no auto-ripple). A disabled unlocked
 * later take is not a neighbor (same as G / Q/W / ripple-delete).
 * Fades re-clamp to the new duration.
 * A living unlocked linked mate gets the same rate or both no-op.
 * A locked mate is skipped (same as split/slip/move/trim).
 */
export function setClipRate(
  project: Project,
  clipId: string,
  rate: number,
): { project: Project; error?: string } {
  const clip = clipById(project, clipId);
  if (!clip) return { project, error: "Clip not found" };
  if (clipIsLocked(clip)) return { project, error: "Clip is locked" };
  const one = planClipRate(project, clip, rate);
  if ("error" in one) return { project, error: one.error };
  const liveMate = editableLinkedMate(project, clipId);
  if (!liveMate) {
    if ("unchanged" in one) return { project };
    return {
      project: {
        ...project,
        clips: project.clips.map((c) => (c.id === clipId ? one.clip : c)),
        updatedAt: new Date().toISOString(),
      },
    };
  }
  const two = planClipRate(project, liveMate, rate);
  if ("error" in two) return { project, error: two.error };
  if ("unchanged" in one && "unchanged" in two) return { project };
  const next = "unchanged" in one ? clip : one.clip;
  const nextMate = "unchanged" in two ? liveMate : two.clip;
  return {
    project: {
      ...project,
      clips: project.clips.map((c) => {
        if (c.id === clipId) return next;
        if (c.id === liveMate.id) return nextMate;
        return c;
      }),
      updatedAt: new Date().toISOString(),
    },
  };
}

export const FREEZE_HOLD_MS = 2000;

/** Toggle reversed on the selection and each editable linked mate. Duration stays. One project. */
export function toggleClipReversed(
  project: Project,
  clipIds: readonly string[],
): { project: Project; error?: string } {
  const ids = new Set<string>();
  for (const id of clipIds) {
    if (!clipById(project, id)) continue;
    ids.add(id);
    const mate = editableLinkedMate(project, id);
    if (mate) ids.add(mate.id);
  }
  if (ids.size === 0) return { project, error: "No clip selected" };
  const targets = project.clips.filter((c) => ids.has(c.id));
  if (targets.every(clipIsLocked)) return { project, error: "Clip is locked" };
  let changed = false;
  const clips = project.clips.map((c) => {
    if (!ids.has(c.id) || clipIsLocked(c)) return c;
    changed = true;
    return c.reversed ? { ...c, reversed: undefined } : { ...c, reversed: true };
  });
  if (!changed) return { project };
  return { project: { ...project, clips, updatedAt: new Date().toISOString() } };
}

function videoUnderPlayhead(project: Project, selectedIds: readonly string[]): Clip | undefined {
  const timeMs = project.playheadMs;
  const covers = (c: Clip | undefined): c is Clip =>
    Boolean(
      c &&
        clipIsEnabled(c) &&
        !clipIsLocked(c) &&
        kindOfTrack(c.trackId) === "video" &&
        timeMs >= c.startMs &&
        timeMs < clipEndMs(c),
    );
  for (const id of selectedIds) {
    const clip = clipById(project, id);
    if (covers(clip)) return clip;
  }
  for (const id of trackIdsOf(project)) {
    if (kindOfTrack(id) !== "video") continue;
    const hit = clipOnTrackAt(project, id, timeMs);
    if (covers(hit)) return hit;
  }
  return undefined;
}

/**
 * Insert a 2s freeze of the video frame under the playhead.
 * Later clips on that video track shift right. Linked audio is not moved.
 * A cut strictly inside the clip splits the picture only.
 */
export function freezeFrameAtPlayhead(
  project: Project,
  selectedIds: readonly string[],
): { project: Project; error?: string } {
  const clip = videoUnderPlayhead(project, selectedIds);
  if (!clip) return { project, error: "No video clip under playhead" };
  const playhead = project.playheadMs;
  const hold = sourceTimeAt(clip, playhead);
  const distIn = playhead - clip.startMs;
  const distOut = clipEndMs(clip) - playhead;
  let working = project;
  let insertAt = playhead;
  if (distIn >= SPLIT_EDGE_GUARD_MS && distOut >= SPLIT_EDGE_GUARD_MS) {
    const split = splitClipAt(working, clip.id, playhead, SPLIT_EDGE_GUARD_MS, {
      includeLinkedMate: false,
    });
    if (split.error) return { project, error: split.error };
    working = split.project;
  } else if (distIn < SPLIT_EDGE_GUARD_MS) {
    insertAt = clip.startMs;
  } else {
    insertAt = clipEndMs(clip);
  }
  const asset = working.assets.find((a) => a.id === clip.assetId);
  const cap = asset?.durationMs;
  const sourceOutMs = cap != null && cap > hold ? Math.min(cap, hold + 1) : hold + 1;
  const freeze: Clip = {
    id: createId("clip"),
    assetId: clip.assetId,
    trackId: clip.trackId,
    startMs: insertAt,
    durationMs: FREEZE_HOLD_MS,
    sourceInMs: hold,
    sourceOutMs,
    gain: clip.gain,
    fadeInMs: 0,
    fadeOutMs: 0,
    rate: 1,
    holdSourceMs: hold,
  };
  const clips = working.clips.map((c) =>
    c.trackId === clip.trackId && c.startMs >= insertAt - 0.001
      ? { ...c, startMs: c.startMs + FREEZE_HOLD_MS }
      : c,
  );
  clips.push(freeze);
  return {
    project: { ...working, clips, updatedAt: new Date().toISOString() },
  };
}

export function deleteClip(project: Project, clipId: string): Project {
  return {
    ...project,
    clips: project.clips.filter((c) => c.id !== clipId),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Lift the clip, then shift later enabled clips on the same track left
 * by its duration. Disabled later clips stay parked (same as G / Q/W).
 * Other tracks are unchanged. A locked later enabled clip is a wall —
 * refuse (same as ripple-trim / closeGap / extract). Deleting the clip
 * itself is still allowed even when it is locked.
 * A disabled primary is refused (Shift+Delete must not pack living clips).
 */
function rippleDeleteOne(
  project: Project,
  clipId: string,
): { project: Project; error?: string } {
  const clip = clipById(project, clipId);
  if (!clip) return { project };
  if (!clipIsEnabled(clip)) return { project, error: "Clip is disabled" };
  const shift = clip.durationMs;
  const cutoff = clip.startMs;
  const trackId = clip.trackId;
  const laterLocked = project.clips.some(
    (c) =>
      c.id !== clipId &&
      c.trackId === trackId &&
      c.startMs + ABUT_TOLERANCE_MS >= cutoff &&
      clipIsEnabled(c) &&
      clipIsLocked(c),
  );
  if (laterLocked) return { project, error: "Clip is locked" };
  return {
    project: {
      ...project,
      clips: project.clips
        .filter((c) => c.id !== clipId)
        .map((c) => {
          if (c.trackId !== trackId || c.startMs < cutoff) return c;
          if (!clipIsEnabled(c)) return c;
          return { ...c, startMs: clampStartMs(c.startMs - shift) };
        }),
      updatedAt: new Date().toISOString(),
    },
  };
}

/** Refuse a disabled primary (same as ripple-trim). Lift-delete still removes it. */
export function rippleDeleteClip(
  project: Project,
  clipId: string,
): { project: Project; error?: string } {
  const mate = livingLinkedMate(project, clipId);
  const liveMate = editableLinkedMate(project, clipId);
  const one = rippleDeleteOne(project, clipId);
  if (one.error) return one;
  if (mate && !liveMate) {
    return {
      project: {
        ...one.project,
        clips: one.project.clips.map((c) =>
          c.id === mate.id ? { ...c, linkId: undefined } : c,
        ),
        updatedAt: new Date().toISOString(),
      },
    };
  }
  if (!liveMate || !clipById(one.project, liveMate.id)) return one;
  const two = rippleDeleteOne(one.project, liveMate.id);
  if (two.error) return { project, error: two.error };
  return two;
}

/** End of the last clip on `trackId`, or 0 if that track is empty. */
export function lastClipEndMsOnTrack(project: Project, trackId: TrackId): number {
  let end = 0;
  for (const clip of project.clips) {
    if (clip.trackId === trackId) end = Math.max(end, clipEndMs(clip));
  }
  return end;
}

export function placeAsset(
  project: Project,
  assetId: string,
  trackId: TrackId,
  startMs = 0,
): { project: Project; clip?: Clip; audioClip?: Clip; error?: string } {
  const asset = project.assets.find((a) => a.id === assetId);
  if (!asset) return { project, error: "Asset not found" };
  if (!assetFitsTrack(asset.kind, trackId)) {
    return { project, error: `Asset kind ${asset.kind} cannot go on ${trackId}` };
  }
  let clip: Clip = {
    id: createId("clip"),
    assetId: asset.id,
    trackId,
    startMs: clampStartMs(startMs),
    durationMs: asset.durationMs,
    sourceInMs: 0,
    sourceOutMs: asset.durationMs,
    gain: 1,
    fadeInMs: 0,
    fadeOutMs: 0,
    rate: 1,
  };
  let clips = [...project.clips, clip];
  let audioClip: Clip | undefined;
  if (asset.kind === "video" && asset.hasAudio === true) {
    const aTrack = firstFreeAudioTrack({ ...project, clips }, clip.startMs, clip.durationMs);
    if (aTrack) {
      const linkId = createId("link");
      clip = { ...clip, linkId };
      audioClip = {
        ...clip,
        id: createId("clip"),
        trackId: aTrack,
        linkId,
      };
      clips = [...project.clips, clip, audioClip];
    }
  }
  return {
    project: {
      ...project,
      clips,
      updatedAt: new Date().toISOString(),
    },
    clip,
    audioClip,
  };
}

/** Last enabled clip or finite VIS window/event. Disabled clips and muted VIS do not pad export. */
export function exportContentEndMs(project: Project): number {
  let end = 0;
  for (const clip of project.clips) {
    if (!clipIsEnabled(clip)) continue;
    end = Math.max(end, clipEndMs(clip));
  }
  const vis = project.visualizer;
  if (vis && vis.enabled && !vis.muted) {
    const windowDur = vis.durationMs ?? 0;
    if (windowDur > 0) end = Math.max(end, (vis.startMs ?? 0) + windowDur);
    for (const event of vis.events ?? []) {
      end = Math.max(end, event.startMs + Math.max(0, event.durationMs));
    }
  }
  return end;
}

export function exportRangeMs(project: Project): { startMs: number; endMs: number } {
  const startMs = project.inPointMs ?? 0;
  const endMs = project.outPointMs ?? exportContentEndMs(project);
  return { startMs, endMs };
}
