import type { FrontVideoTrackId, TrackId } from "../core/models";
import type { TransitionAudioMode, TransitionSource, TransitionType } from "../core/transition";
import {
  applyClearInOut,
  applyCloseGap,
  applyCopy,
  applyCut,
  applyDuplicate,
  applyDelete,
  applyExtractRange,
  applyIn,
  applyLiftRange,
  applyMarker,
  applyRenameMarker,
  applyRenameProject,
  applyMoveClips,
  applyNudge,
  applyNudgePlayhead,
  applyOut,
  applyPaste,
  applyPause,
  applyPlay,
  applyGotoNextEdit,
  applyGotoPrevEdit,
  applyPlayPause,
  applyRedo,
  applyRelinkClips,
  applyRippleDelete,
  applyRippleTrim,
  applyRippleTrimToPlayhead,
  applyRoll,
  applySelect,
  applySelectAll,
  applySelectAllOnTrack,
  applySelectClips,
  applySelectVisEvent,
  applySetClipsEnabled,
  applySetClipsLocked,
  applySetFrontVideoTrack,
  applyInsertVisEvent,
  applyMoveVisEvent,
  applyStretchVisEvent,
  applyAddCrossfade,
  applySetClipFades,
  applySetSelectionFades,
  applySetClipRate,
  applySetTrackPan,
  applySetTransition,
  applySetTransitionAudio,
  applySetTransitionAudioDuration,
  applySetTransitionSource,
  applyShuttle,
  applySlideClip,
  applySlip,
  applySplit,
  applyStop,
  applyAddAudioTrack,
  applyRemoveAudioTrack,
  applyCreateTrackGroup,
  applyAssignTracksToGroup,
  applyRenameTrackGroup,
  applyAddVolumeAutomationPoint,
  applyDeleteVolumeAutomationPoint,
  applyMoveVolumeAutomationPoint,
  applySelectVolumeAutomationPoint,
  applySetVolumeAutomationEnabled,
  applyToggleVolumeWriteArm,
  applyToggleMute,
  applyToggleSolo,
  applyTrim,
  applyTrimToPlayhead,
  applyUndo,
  applyUnlinkClips,
  revertToLastSave,
  type Session,
} from "./session";

/**
 * Named editor commands. UI keys/toolbar and a future AI path share this dispatch.
 * Timeline math stays in core; this is only the session entry.
 */
export type EditorCommand =
  | { type: "undo" }
  | { type: "redo" }
  | { type: "revertToLastSave" }
  | { type: "copy" }
  | { type: "cut" }
  | { type: "paste" }
  | { type: "duplicate" }
  | { type: "split" }
  | { type: "addMarker"; label?: string }
  | { type: "renameMarker"; markerId: string; label: string }
  | { type: "renameProject"; name: string }
  | { type: "clearInOut" }
  | { type: "markIn" }
  | { type: "markOut" }
  | { type: "liftDelete" }
  | { type: "rippleDelete" }
  | { type: "closeGap" }
  | { type: "trimToPlayhead"; edge: "in" | "out" }
  | { type: "rippleTrimToPlayhead"; edge: "in" | "out" }
  | { type: "nudgeClip"; deltaMs: number }
  | { type: "nudgePlayhead"; deltaMs: number }
  | { type: "gotoNextEdit" }
  | { type: "gotoPrevEdit" }
  | { type: "play" }
  | { type: "pause" }
  | { type: "playPause" }
  | { type: "stop" }
  | { type: "shuttle"; dir: -1 | 0 | 1 }
  | { type: "toggleMute"; trackId: TrackId }
  | { type: "toggleSolo"; trackId: TrackId }
  | { type: "addAudioTrack" }
  | { type: "removeAudioTrack"; trackId?: TrackId }
  | { type: "createTrackGroup"; name?: string; trackIds?: readonly TrackId[] }
  | { type: "assignTracksToGroup"; trackIds: readonly TrackId[]; groupId: string | null }
  | { type: "renameTrackGroup"; groupId: string; name: string }
  | { type: "toggleVolumeWriteArm"; trackId: TrackId }
  | { type: "setVolumeAutomationEnabled"; trackId: TrackId; enabled: boolean }
  | { type: "addVolumeAutomationPoint"; trackId: TrackId; timeMs: number; value: number }
  | { type: "deleteVolumeAutomationPoint"; trackId: TrackId; timeMs: number }
  | {
      type: "moveVolumeAutomationPoint";
      trackId: TrackId;
      fromTimeMs: number;
      timeMs: number;
      value: number;
    }
  | { type: "selectVolumeAutomationPoint"; trackId: TrackId; timeMs: number }
  | { type: "clearVolumeAutomationPoint" }
  | { type: "liftTrim"; clipId: string; edge: "in" | "out"; nextEdgeMs: number }
  | { type: "rippleTrim"; clipId: string; edge: "in" | "out"; nextEdgeMs: number }
  | { type: "rollEdit"; clipId: string; edge: "in" | "out"; nextEdgeMs: number }
  | { type: "select"; clipId: string | null; toggle?: boolean; range?: boolean }
  | { type: "selectClips"; clipIds: readonly string[]; union?: boolean }
  | { type: "selectAll" }
  | { type: "selectAllOnTrack" }
  | { type: "setClipsEnabled"; enabled: boolean }
  | { type: "setClipsLocked"; locked: boolean }
  | { type: "moveClips"; clipIds: readonly string[]; deltaMs: number; trackId?: TrackId }
  | { type: "slip"; clipId: string; deltaMs: number; clipIds?: readonly string[] }
  | { type: "slideClip"; clipId: string; deltaMs: number; clipIds?: readonly string[] }
  | { type: "liftRange" }
  | { type: "extractRange" }
  | { type: "setClipFades"; clipId: string; fadeInMs: number; fadeOutMs: number }
  | { type: "setSelectionFades"; fadeInMs?: number; fadeOutMs?: number }
  | { type: "addCrossfade"; durationMs?: number }
  | { type: "setClipRate"; clipId: string; rate: number }
  | { type: "setTrackPan"; trackId: TrackId; pan: number }
  | { type: "unlinkClips"; clipId: string }
  | { type: "relinkClips"; clipIds: readonly string[]; assetId: string }
  | {
      type: "setTransition";
      transitionType?: TransitionType;
      durationMs?: number;
      audioMode?: TransitionAudioMode;
      audioDurationMs?: number;
      startMs?: number;
    }
  | { type: "setTransitionSource"; source: TransitionSource }
  | { type: "setTransitionAudio"; audio: TransitionAudioMode }
  | { type: "setTransitionAudioDuration"; audioDurationMs: number }
  | { type: "setFrontVideoTrack"; trackId: FrontVideoTrackId }
  | { type: "insertVisEvent" }
  | { type: "selectVisEvent"; eventId: string }
  | { type: "moveVisEvent"; eventId: string; startMs: number }
  | { type: "stretchVisEvent"; eventId: string; edge: "in" | "out"; nextEdgeMs: number };

export function applyCommand(session: Session, command: EditorCommand): Session {
  switch (command.type) {
    case "undo":
      return applyUndo(session);
    case "redo":
      return applyRedo(session);
    case "revertToLastSave":
      return revertToLastSave(session);
    case "copy":
      return applyCopy(session);
    case "cut":
      return applyCut(session);
    case "paste":
      return applyPaste(session);
    case "duplicate":
      return applyDuplicate(session);
    case "split":
      return applySplit(session);
    case "addMarker":
      return applyMarker(session, command.label);
    case "renameMarker":
      return applyRenameMarker(session, command.markerId, command.label);
    case "renameProject":
      return applyRenameProject(session, command.name);
    case "clearInOut":
      return applyClearInOut(session);
    case "markIn":
      return applyIn(session);
    case "markOut":
      return applyOut(session);
    case "liftDelete":
      return applyDelete(session);
    case "rippleDelete":
      return applyRippleDelete(session);
    case "closeGap":
      return applyCloseGap(session);
    case "rippleTrimToPlayhead":
      return applyRippleTrimToPlayhead(session, command.edge);
    case "nudgeClip":
      return applyNudge(session, command.deltaMs);
    case "nudgePlayhead":
      return applyNudgePlayhead(session, command.deltaMs);
    case "gotoNextEdit":
      return applyGotoNextEdit(session);
    case "gotoPrevEdit":
      return applyGotoPrevEdit(session);
    case "play":
      return applyPlay(session);
    case "pause":
      return applyPause(session);
    case "playPause":
      return applyPlayPause(session);
    case "stop":
      return applyStop(session);
    case "shuttle":
      return applyShuttle(session, command.dir);
    case "toggleMute":
      return applyToggleMute(session, command.trackId);
    case "toggleSolo":
      return applyToggleSolo(session, command.trackId);
    case "addAudioTrack":
      return applyAddAudioTrack(session);
    case "removeAudioTrack":
      return applyRemoveAudioTrack(session, command.trackId);
    case "createTrackGroup":
      return applyCreateTrackGroup(session, command.name, command.trackIds);
    case "assignTracksToGroup":
      return applyAssignTracksToGroup(session, command.trackIds, command.groupId);
    case "renameTrackGroup":
      return applyRenameTrackGroup(session, command.groupId, command.name);
    case "toggleVolumeWriteArm":
      return applyToggleVolumeWriteArm(session, command.trackId);
    case "setVolumeAutomationEnabled":
      return applySetVolumeAutomationEnabled(session, command.trackId, command.enabled);
    case "addVolumeAutomationPoint":
      return applyAddVolumeAutomationPoint(session, command.trackId, command.timeMs, command.value);
    case "deleteVolumeAutomationPoint":
      return applyDeleteVolumeAutomationPoint(session, command.trackId, command.timeMs);
    case "moveVolumeAutomationPoint":
      return applyMoveVolumeAutomationPoint(
        session,
        command.trackId,
        command.fromTimeMs,
        command.timeMs,
        command.value,
      );
    case "selectVolumeAutomationPoint":
      return applySelectVolumeAutomationPoint(session, {
        trackId: command.trackId,
        timeMs: command.timeMs,
      });
    case "clearVolumeAutomationPoint":
      return applySelectVolumeAutomationPoint(session, null);
    case "liftTrim":
      return applyTrim(session, command.clipId, command.edge, command.nextEdgeMs);
    case "rippleTrim":
      return applyRippleTrim(session, command.clipId, command.edge, command.nextEdgeMs);
    case "trimToPlayhead":
      return applyTrimToPlayhead(session, command.edge);
    case "rollEdit":
      return applyRoll(session, command.clipId, command.edge, command.nextEdgeMs);
    case "select":
      return applySelect(session, command.clipId, { toggle: command.toggle, range: command.range });
    case "selectClips":
      return applySelectClips(session, command.clipIds, { union: command.union });
    case "selectAll":
      return applySelectAll(session);
    case "selectAllOnTrack":
      return applySelectAllOnTrack(session);
    case "setClipsEnabled":
      return applySetClipsEnabled(session, command.enabled);
    case "setClipsLocked":
      return applySetClipsLocked(session, command.locked);
    case "moveClips":
      return applyMoveClips(session, command.clipIds, command.deltaMs, command.trackId);
    case "slip":
      return applySlip(session, command.clipId, command.deltaMs, command.clipIds);
    case "slideClip":
      return applySlideClip(session, command.clipId, command.deltaMs, command.clipIds);
    case "liftRange":
      return applyLiftRange(session);
    case "extractRange":
      return applyExtractRange(session);
    case "setClipFades":
      return applySetClipFades(session, command.clipId, command.fadeInMs, command.fadeOutMs);
    case "setSelectionFades":
      return applySetSelectionFades(session, command.fadeInMs, command.fadeOutMs);
    case "addCrossfade":
      return applyAddCrossfade(session, command.durationMs);
    case "setClipRate":
      return applySetClipRate(session, command.clipId, command.rate);
    case "setTrackPan":
      return applySetTrackPan(session, command.trackId, command.pan);
    case "unlinkClips":
      return applyUnlinkClips(session, command.clipId);
    case "relinkClips":
      return applyRelinkClips(session, command.clipIds, command.assetId);
    case "setTransition":
      return applySetTransition(session, {
        type: command.transitionType,
        durationMs: command.durationMs,
        audioMode: command.audioMode,
        audioDurationMs: command.audioDurationMs,
        startMs: command.startMs,
      });
    case "setTransitionSource":
      return applySetTransitionSource(session, command.source);
    case "setTransitionAudio":
      return applySetTransitionAudio(session, command.audio);
    case "setTransitionAudioDuration":
      return applySetTransitionAudioDuration(session, command.audioDurationMs);
    case "setFrontVideoTrack":
      return applySetFrontVideoTrack(session, command.trackId);
    case "insertVisEvent":
      return applyInsertVisEvent(session);
    case "selectVisEvent":
      return applySelectVisEvent(session, command.eventId);
    case "moveVisEvent":
      return applyMoveVisEvent(session, command.eventId, command.startMs);
    case "stretchVisEvent":
      return applyStretchVisEvent(session, command.eventId, command.edge, command.nextEdgeMs);
    default: {
      const _never: never = command;
      return _never;
    }
  }
}
