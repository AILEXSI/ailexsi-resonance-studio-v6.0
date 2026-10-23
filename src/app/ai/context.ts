import type { Session } from "../session";
import { clipIsEnabled, clipIsLocked, kindOfTrack, type TrackId } from "../../core/models";
import {
  getMarkers,
  getPlayhead,
  getProjectSummary,
  getSelection,
  listAudioTracks,
  type AudioTrackSummary,
  type PlayheadSnapshot,
  type ProjectSummary,
  type SelectionSnapshot,
} from "./tools/read";

/**
 * What Send includes. Names are included. Paths, object URLs, and media bytes are not.
 * The panel shows this object. The mock provider does not receive it.
 */
export interface SendContext {
  privacy: "SEND_STRUCTURE";
  includesNames: true;
  omits: ["file paths", "media urls", "media bytes", "pcm", "asset file names"];
  project: ProjectSummary & { name: string };
  selection: SelectionSnapshot;
  playhead: PlayheadSnapshot;
  markers: { id: string; timeMs: number; label: string }[];
  tracks: { id: TrackId; name: string; kind: "audio" | "video" }[];
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

function publicName(value: string): string {
  if (/sourcePath|objectUrl|blob:|[A-Za-z]:\\|\/home\/|\/Users\/|\\\\/.test(value)) return "(name withheld)";
  return value;
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
    includesNames: true,
    omits: ["file paths", "media urls", "media bytes", "pcm", "asset file names"],
    project: { ...project.data, name: publicName(session.project.name) },
    selection: selection.data,
    playhead: playhead.data,
    markers: [...session.project.markers]
      .map((marker) => ({ id: marker.id, timeMs: marker.timeMs, label: publicName(marker.label) }))
      .sort((a, b) => a.timeMs - b.timeMs || a.id.localeCompare(b.id)),
    tracks: session.project.tracks.map((track) => ({
      id: track.id,
      name: publicName(track.name),
      kind: kindOfTrack(track.id),
    })),
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
