import type { Project } from "../core/models";
import { pushHistory } from "../core/timeline";
import type { Session } from "./session";

/**
 * The only history push in the editor. Callers that change the project
 * for undo go through this function.
 */
export function withHistory(session: Session, nextProject: Project, status: string): Session {
  return {
    ...session,
    history: pushHistory(session.history, session.project),
    project: nextProject,
    status,
    error: null,
  };
}

/**
 * One undo step for a project already produced by `applyCommand` on a
 * scratch session. The scratch history is not copied.
 */
export function commitPreparedProject(session: Session, prepared: Session, status: string): Session {
  if (prepared.project === session.project) return session;
  const committed = withHistory(session, prepared.project, status);
  return {
    ...committed,
    selectedClipId: prepared.selectedClipId,
    selectedClipIds: prepared.selectedClipIds,
    selectionAnchorClipId: prepared.selectionAnchorClipId,
    selectedMarkerId: prepared.selectedMarkerId,
    selectedVis: prepared.selectedVis,
    selectedVisEventId: prepared.selectedVisEventId,
    selectedVisEventIds: prepared.selectedVisEventIds,
    selectedVolumeAutomation: prepared.selectedVolumeAutomation,
    targetTrackId: prepared.targetTrackId,
    selectedTrackIds: prepared.selectedTrackIds,
    error: null,
  };
}
