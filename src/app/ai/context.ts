import type { Session } from "../session";
import { clipIsEnabled, clipIsLocked, type TrackId } from "../../core/models";
import {
  getMarkers,
  getPlayhead,
  getProjectSummary,
  getSelection,
  listAudioTracks,
  type AudioTrackSummary,
  type MarkerSummary,
  type PlayheadSnapshot,
  type ProjectSummary,
  type SelectionSnapshot,
} from "./tools/read";

/** Narrowest context that still describes the edit. No names, paths, or media. */
export interface SendContext {
  privacy: "SEND_STRUCTURE";
  project: ProjectSummary;
  selection: SelectionSnapshot;
  playhead: PlayheadSnapshot;
  markers: MarkerSummary[];
  audioTracks: AudioTrackSummary[];
  clips: {
    id: string;
    trackId: TrackId;
    startMs: number;
    durationMs: number;
    locked: boolean;
    enabled: boolean;
  }[];
}

export function buildSendContext(session: Session): SendContext | null {
  const project = getProjectSummary(session);
  const selection = getSelection(session);
  const playhead = getPlayhead(session);
  const markers = getMarkers(session);
  const audioTracks = listAudioTracks(session);
  if (!project.ok || !selection.ok || !playhead.ok || !markers.ok || !audioTracks.ok) return null;
  return {
    privacy: "SEND_STRUCTURE",
    project: project.data,
    selection: selection.data,
    playhead: playhead.data,
    markers: markers.data,
    audioTracks: audioTracks.data,
    clips: session.project.clips.map((clip) => ({
      id: clip.id,
      trackId: clip.trackId,
      startMs: clip.startMs,
      durationMs: clip.durationMs,
      locked: clipIsLocked(clip),
      enabled: clipIsEnabled(clip),
    })),
  };
}

/** Last-line filter. A path must not be shown or sent onward. */
export function redactSensitiveText(text: string): string {
  if (/sourcePath|objectUrl|blob:|[A-Za-z]:\\|\/home\/|\/Users\//.test(text)) {
    return "Result withheld because it looked like a path or media URL.";
  }
  return text;
}
