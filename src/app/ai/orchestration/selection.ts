/**
 * Request-time Resonance selection. Not the Advanced Context dropdown.
 * Stable clip ids are resolved from the live Project. Stale UI is never proof.
 */
import { clipById } from "../../../core/models";
import { canonicalClipSelection, type Session } from "../../session";
import { toolRequiresSingleClip, type ToolRequirement } from "../tools/requirements";

export type SelectionResolveError = "NO_SELECTION" | "AMBIGUOUS_SELECTION";

export interface ResolvedToolSelection {
  readonly clipIds: readonly string[];
  readonly clipId: string | null;
  readonly error: SelectionResolveError | null;
}

export function resolveToolSelection(
  session: Session | undefined,
  requirement: ToolRequirement | null,
): ResolvedToolSelection {
  if (!session) {
    return {
      clipIds: [],
      clipId: null,
      error: toolRequiresSingleClip(requirement) ? "NO_SELECTION" : null,
    };
  }
  const canonical = canonicalClipSelection(session);
  const clipIds = canonical.clipIds.filter((id) => Boolean(clipById(session.project, id)));
  if (!toolRequiresSingleClip(requirement)) {
    return {
      clipIds,
      clipId: clipIds.length === 1 ? clipIds[0]! : canonical.usableMoveTarget,
      error: null,
    };
  }
  if (clipIds.length === 0) {
    return { clipIds, clipId: null, error: "NO_SELECTION" };
  }
  if (clipIds.length > 1) {
    return { clipIds, clipId: null, error: "AMBIGUOUS_SELECTION" };
  }
  const clipId = clipIds[0]!;
  if (!clipById(session.project, clipId)) {
    return { clipIds: [], clipId: null, error: "NO_SELECTION" };
  }
  return { clipIds, clipId, error: null };
}
