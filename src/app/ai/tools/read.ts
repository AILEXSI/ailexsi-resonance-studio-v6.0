import { activeEditTrackIds, selectionOf, type Session } from "../../session";
import {
  audioTracksOf,
  clipIsEnabled,
  clipIsLocked,
  clipsOnTrack,
  isTrackId,
  projectDurationMs,
  videoTracksOf,
  type TrackId,
} from "../../../core/models";
import { toolErr, toolOk, type ToolResult } from "./result";

/** Counts, ids, and times. No names, paths, or media bytes. */
export interface ProjectSummary {
  schemaVersion: 5;
  projectId: string;
  clipCount: number;
  markerCount: number;
  audioTrackCount: number;
  videoTrackCount: number;
  durationMs: number;
  snap: boolean;
  playheadMs: number;
}

export interface SelectionSnapshot {
  clipIds: string[];
  primaryClipId: string | null;
  markerId: string | null;
  visSelected: boolean;
  visEventId: string | null;
  trackIds: TrackId[];
}

export interface PlayheadSnapshot {
  playheadMs: number;
  playing: boolean;
  shuttleRate: number;
}

export interface ClipSummary {
  id: string;
  trackId: TrackId;
  startMs: number;
  durationMs: number;
  locked: boolean;
  enabled: boolean;
  linkId: string | null;
}

export interface MarkerSummary {
  id: string;
  timeMs: number;
}

export interface AudioTrackSummary {
  id: TrackId;
  order: number;
  muted: boolean;
  solo: boolean;
}

export function getProjectSummary(session: Session): ToolResult<ProjectSummary> {
  const project = session.project;
  return toolOk({
    schemaVersion: project.schemaVersion,
    projectId: project.id,
    clipCount: project.clips.length,
    markerCount: project.markers.length,
    audioTrackCount: audioTracksOf(project).length,
    videoTrackCount: videoTracksOf(project).length,
    durationMs: projectDurationMs(project),
    snap: project.snap,
    playheadMs: project.playheadMs,
  });
}

export function getSelection(session: Session): ToolResult<SelectionSnapshot> {
  return toolOk({
    clipIds: selectionOf(session),
    primaryClipId: session.selectedClipId,
    markerId: session.selectedMarkerId,
    visSelected: session.selectedVis,
    visEventId: session.selectedVisEventId,
    trackIds: activeEditTrackIds(session),
  });
}

export function getPlayhead(session: Session): ToolResult<PlayheadSnapshot> {
  return toolOk({
    playheadMs: session.project.playheadMs,
    playing: session.playing,
    shuttleRate: session.shuttleRate,
  });
}

export function getClipsOnTrack(session: Session, trackId: unknown): ToolResult<ClipSummary[]> {
  if (typeof trackId !== "string" || trackId.trim().length === 0) {
    return toolErr("SCHEMA_INVALID", "Track id required");
  }
  if (!isTrackId(trackId) || !session.project.tracks.some((track) => track.id === trackId)) {
    return toolErr("TRACK_NOT_FOUND", "Track not found");
  }
  const clips = clipsOnTrack(session.project, trackId).map((clip) => ({
    id: clip.id,
    trackId: clip.trackId,
    startMs: clip.startMs,
    durationMs: clip.durationMs,
    locked: clipIsLocked(clip),
    enabled: clipIsEnabled(clip),
    linkId: clip.linkId ?? null,
  }));
  return toolOk(clips);
}

export function getMarkers(session: Session): ToolResult<MarkerSummary[]> {
  const markers = [...session.project.markers]
    .map((marker) => ({ id: marker.id, timeMs: marker.timeMs }))
    .sort((a, b) => a.timeMs - b.timeMs || a.id.localeCompare(b.id));
  return toolOk(markers);
}

export function listAudioTracks(session: Session): ToolResult<AudioTrackSummary[]> {
  return toolOk(
    audioTracksOf(session.project).map((track) => ({
      id: track.id,
      order: track.order,
      muted: track.muted,
      solo: track.solo,
    })),
  );
}
