import { unlinkClips } from "../core/link";
import {
  editPairAtProbe,
  findTransitionForPair,
  resolveEditPair,
  setTransitionSource,
  transitionAtProbe,
  transitionAudioDurationMs,
  transitionAudioOf,
  transitionSourceOf,
  upsertTransition,
  type Transition,
  type TransitionAudioMode,
  type TransitionSource,
} from "../core/transition";
import {
  classifyFile,
  importMediaFile,
  ImportError,
  missingAssetFromImport,
  defaultTrackForKind,
  preferredTrackForAsset,
  type ProbeFn,
} from "../core/media";
import {
  clipById,
  clipIsEnabled,
  clipIsLocked,
  clipOnTrackAt,
  isTrackId,
  kindOfTrack,
  trackById,
  MAX_AUDIO_TRACKS,
  projectDurationMs,
  type Clip,
  type FrontVideoTrackId,
  type MediaAsset,
  type MediaKind,
  type Project,
  type TrackId,
  type VisualizerSceneId,
} from "../core/models";
import { relinkClipsOnProject, relinkSelectionOf } from "../core/relink";
import {
  createIndexedDbBlobStore,
  hydrateProject,
  type SourcePathReader,
  persistAssetBlob,
  type BlobStore,
} from "../core/persistence";
import { createEmptyProject, deserializeProject, renameProject, serializeProject } from "../core/project";
import {
  addMarker,
  clearInOut,
  deleteMarker,
  renameMarker,
  closeGapOnTrack,
  collectSnapTargets,
  collectVisEventSnapTargets,
  createHistory,
  resolveCloseGapTrack,
  playheadStrictlyInsideClip,
  resolveRippleTrimToPlayheadClip,
  nextEditPointMs,
  prevEditPointMs,
  deleteClips,
  expandDeletableClipIds,
  pasteClips,
  slipClips,
  slideClips,
  setClipRate,
  setClipFades,
  maybeScrollToOrigin,
  moveClip,
  moveClipsByDelta,
  moveMarker,
  moveInOut,
  lastClipEndMsOnTrack,
  placeAsset,
  pushHistory,
  redo as redoHistory,
  setInPoint,
  setOutPoint,
  setPlayhead,
  snapPlayheadSeek,
  snapTime,
  splitAtPlayhead,
  toggleLoop,
  toggleSnap,
  setMasterVolume,
  setTrackPan,
  setTrackVolume,
  rippleDeleteClips,
  rippleTrimClip,
  liftRange,
  extractRange,
  editRangeOf,
  rollEdit,
  abuttingNeighbor,
  toggleTrackMute,
  toggleTrackSolo,
  trimClip,
  undo as undoHistory,
  updateClip,
  type HistoryStack,
} from "../core/timeline";
import { addAudioTrack, canAddAudioTrack, canRemoveAudioTrack, removeAudioTrack } from "../core/audio-tracks";
import {
  assignTracksToGroup,
  createTrackGroup,
  nextTrackGroupName,
  renameTrackGroup,
  syncTrackGroups,
} from "../core/track-groups";
import {
  allocateAudioTracksForStems,
  inferStemGroupId,
  nameStemTrack,
  stemStartMs,
} from "../core/stem-import";
import { expandImportFiles } from "../core/zip-audio";
import { nextShuttleRate } from "../core/playback";
import {
  cycleVisualizerScene,
  deleteVisualizerEvent,
  insertCueAtPlayhead,
  insertVisualizerEvent,
  setVisualizerSceneAt,
  moveVisualizerEvent,
  pasteVisualizerEvent,
  setVisualizer,
  splitVisualizerAtPlayhead,
  stretchVisualizerEvent,
  toggleVisualizerMute,
  updateVisualizerEvent,
  visEventClipboardOf,
  visualizerEventsOf,
  type VisEventClipboard,
} from "../core/visualizer";
import type { VisualizerState } from "../core/models";
import { formatDb, formatPan, linearToDb } from "../core/volume";
import {
  addVolumeAutomationPoint,
  deleteVolumeAutomationPoint,
  moveVolumeAutomationPoint,
  setTrackVolumeAutomation,
  setVolumeAutomationEnabled,
  volumeAutomationOf,
  type VolumeAutomationPoint,
} from "../core/volume-automation";
import {
  appendWriteSample,
  gestureSamplesForCommit,
  isMeaningfulWriteMove,
  punchVolumeWrite,
  writeGestureIsIdle,
  WRITE_IDLE_END_MS,
  type VolumeWriteGesture,
} from "../core/volume-write";
import {
  clampScrollMs,
  clampZoomPxPerSec,
  fitZoomPxPerSec,
  LANE_LABEL_PX,
  minZoomPxPerSec,
  scrollFollowPlayhead,
  scrollKeepPlayheadInView,
  scrollZoomAroundPlayhead,
} from "../core/zoom";

export interface Session {
  project: Project;
  history: HistoryStack;
  selectedClipId: string | null;
  /** Source of truth for clip selection. `selectedClipId` is the primary (first). */
  selectedClipIds: string[];
  selectedMarkerId: string | null;
  /** VIS overlay selected for inspector (not a TrackId / clip). */
  selectedVis: boolean;
  /** Selected VIS event id. Null = fallback sceneId+window. */
  selectedVisEventId: string | null;
  /** VIS multi-select. Empty = use `selectedVisEventId` alone. */
  selectedVisEventIds: string[];
  /** Last plain-clicked clip. Shift+click ranges from here. View state only. */
  selectionAnchorClipId: string | null;
  /** Snapshot of copied clips. Empty = none. One-clip copy is a single-item array. */
  clipboard: Clip[];
  /** VIS event copy. Separate from clip clipboard. */
  visClipboard: VisEventClipboard | null;
  /** Which clipboard Ctrl+V prefers when no clip is selected. */
  lastClipboardKind: "clip" | "vis" | null;
  targetTrackId: TrackId;
  /** Mixer / lane multi-select. Empty = use `targetTrackId`. Clip selection wins for S. */
  selectedTrackIds: TrackId[];
  /** Selected volume-automation point (track + time). View state only. */
  selectedVolumeAutomation?: { trackId: TrackId; timeMs: number } | null;
  /**
   * H write-arm. Session chrome only — not project JSON.
   * Defaults OFF on new / open / reopen. Envelope data persists; arm does not.
   */
  volumeWriteArmedIds: TrackId[];
  /** In-progress write gesture. Null when not capturing. */
  volumeWriteGesture: VolumeWriteGesture | null;
  status: string;
  error: string | null;
  playing: boolean;
  /** 0 = paused. Space uses ±1. J/L step 1→2→4 (signed). */
  shuttleRate: number;
  /** Last measured Arrange width. View state; used to keep the playhead on screen. */
  timelineWidthPx: number;
  /** Last measured lane-label gutter. View state. */
  timelineLaneLabelPx: number;
  /** When true, transport pins the playhead at ~65% and scrolls the shared timeline. */
  followPlayhead: boolean;
  store: BlobStore;
  /** History lengths at last save / open / new. Dirty when they differ. */
  savedPastLength: number;
  savedFutureLength: number;
  /**
   * Runtime monotonic edit counter. Not schemaVersion, not updatedAt.
   * Not persisted in Project JSON. Missing treated as 0.
   */
  projectRevision?: number;
}

export function createSession(store?: BlobStore): Session {
  return {
    project: createEmptyProject(),
    history: createHistory(),
    selectedClipId: null,
    selectedClipIds: [],
    selectedMarkerId: null,
    selectedVis: false,
    selectedVisEventId: null,
    selectedVisEventIds: [],
    selectionAnchorClipId: null,
    clipboard: [],
    visClipboard: null,
    lastClipboardKind: null,
    targetTrackId: "V1",
    selectedTrackIds: ["V1"],
    selectedVolumeAutomation: null,
    volumeWriteArmedIds: [],
    volumeWriteGesture: null,
    status: "New project",
    error: null,
    playing: false,
    shuttleRate: 0,
    timelineWidthPx: 1000,
    timelineLaneLabelPx: LANE_LABEL_PX,
    followPlayhead: true,
    store: store ?? createIndexedDbBlobStore(),
    savedPastLength: 0,
    savedFutureLength: 0,
    projectRevision: 0,
  };
}

/** Runtime revision. Never schemaVersion / updatedAt. */
export function projectRevisionOf(session: Session): number {
  return session.projectRevision ?? 0;
}

export function bumpProjectRevision(session: Session): Session {
  return { ...session, projectRevision: projectRevisionOf(session) + 1 };
}

/** True when undo/redo stacks differ from the last clean checkpoint. */
export function isProjectDirty(session: Session): boolean {
  return (
    session.history.past.length !== session.savedPastLength ||
    session.history.future.length !== session.savedFutureLength
  );
}

/** Mark the current history stack as saved (clean). */
export function markProjectClean(session: Session): Session {
  return {
    ...session,
    savedPastLength: session.history.past.length,
    savedFutureLength: session.history.future.length,
  };
}

/**
 * Walk the existing undo/redo stacks back to the last save checkpoint.
 * Does not invent a second history. Drops redo of discarded edits.
 */
export function revertToLastSave(session: Session): Session {
  if (!isProjectDirty(session)) return session;
  let next = session;
  let guard = 0;
  while (next.history.past.length > next.savedPastLength && guard < 10_000) {
    guard += 1;
    const undone = applyUndo(next);
    if (undone.history.past.length === next.history.past.length) break;
    next = undone;
  }
  while (next.history.past.length < next.savedPastLength && guard < 10_000) {
    guard += 1;
    const redone = applyRedo(next);
    if (redone.history.past.length === next.history.past.length) break;
    next = redone;
  }
  const future = next.history.future.slice(0, next.savedFutureLength);
  return {
    ...next,
    history: { past: next.history.past, future },
    status: "Reverted to last save",
    error: null,
  };
}

const REVERT_CONFIRM = "Discard unsaved changes and revert to the last save? Undo cannot restore them.";

function defaultRevertConfirm(): boolean {
  if (typeof window === "undefined" || typeof window.confirm !== "function") return true;
  return window.confirm(REVERT_CONFIRM);
}

/** Revert only when dirty. Confirms because the walk drops discarded redo. */
export function confirmRevertToLastSave(
  session: Session,
  confirmDiscard: () => boolean = defaultRevertConfirm,
): Session {
  if (!isProjectDirty(session)) return session;
  if (!confirmDiscard()) return session;
  return revertToLastSave(session);
}

/** Browser beforeunload: warn only when history is past the last save. */
export function beforeUnloadIfDirty(
  session: Session,
  event: { preventDefault: () => void; returnValue: string },
): boolean {
  if (!isProjectDirty(session)) return false;
  event.preventDefault();
  event.returnValue = "";
  return true;
}

/** Clip ids currently selected. Falls back to `selectedClipId` so older tests stay valid. */
export function selectionOf(session: Session): string[] {
  if (session.selectedClipIds && session.selectedClipIds.length > 0) {
    return [...new Set(session.selectedClipIds)];
  }
  return session.selectedClipId ? [session.selectedClipId] : [];
}

/**
 * Canonical Resonance clip selection. Not a second store — filters `selectionOf`
 * to ids that still exist on the live Project. Director AUTO must consume this.
 */
export interface CanonicalClipSelection {
  readonly clipIds: readonly string[];
  readonly primaryId: string | null;
  /** Exactly one existing unlocked clip — the only legal AUTO move target. */
  readonly usableMoveTarget: string | null;
}

export function canonicalClipSelection(session: Session): CanonicalClipSelection {
  const raw = selectionOf(session);
  const clipIds = raw.filter((id) => Boolean(clipById(session.project, id)));
  const unlocked = clipIds.filter((id) => {
    const clip = clipById(session.project, id);
    return Boolean(clip && !clipIsLocked(clip));
  });
  return {
    clipIds,
    primaryId: clipIds[0] ?? null,
    usableMoveTarget: unlocked.length === 1 ? unlocked[0]! : null,
  };
}

/** In/Out edit range is NOT clip selection. Never a move target. */
export function hasInOutRange(session: Session): boolean {
  const inMs = session.project.inPointMs;
  const outMs = session.project.outPointMs;
  return inMs != null && outMs != null && outMs > inMs;
}

export function withClipSelection(session: Session, ids: string[]): Session {
  const unique = [...new Set(ids)];
  return {
    ...session,
    selectedClipIds: unique,
    selectedClipId: unique[0] ?? null,
    selectedVis: false,
    selectedVisEventId: null,
    selectedVisEventIds: [],
    selectedVolumeAutomation: unique.length > 0 ? null : session.selectedVolumeAutomation,
  };
}

function withHistory(session: Session, nextProject: Project, status: string): Session {
  return {
    ...session,
    history: pushHistory(session.history, session.project),
    project: nextProject,
    projectRevision: projectRevisionOf(session) + 1,
    status,
    error: null,
  };
}

export function newProject(session: Session): Session {
  return {
    ...createSession(session.store),
    projectRevision: projectRevisionOf(session) + 1,
    status: "New project",
  };
}

const NEW_PROJECT_CONFIRM = "Discard unsaved changes and start a new project?";

function defaultNewProjectConfirm(): boolean {
  if (typeof window === "undefined" || typeof window.confirm !== "function") return true;
  return window.confirm(NEW_PROJECT_CONFIRM);
}

/** Empty timeline, same IDB store. Confirms only when dirty. */
export function confirmNewProject(
  session: Session,
  confirmDiscard: () => boolean = defaultNewProjectConfirm,
): Session {
  if (!isProjectDirty(session)) return newProject(session);
  if (!confirmDiscard()) return session;
  return newProject(session);
}

const OPEN_PROJECT_CONFIRM = "Discard unsaved changes and open another project?";

function defaultOpenProjectConfirm(): boolean {
  if (typeof window === "undefined" || typeof window.confirm !== "function") return true;
  return window.confirm(OPEN_PROJECT_CONFIRM);
}

/** Proceed with Open / last / recent. Confirms only when dirty. */
export function confirmOpenProject(
  session: Session,
  confirmDiscard: () => boolean = defaultOpenProjectConfirm,
): boolean {
  if (!isProjectDirty(session)) return true;
  return confirmDiscard();
}

function mergeImportNotes(session: Session, extra: string[]): Session {
  if (extra.length === 0) return session;
  const extraNote = extra.join(" · ");
  return {
    ...session,
    error: session.error ? `${session.error} · ${extraNote}` : extraNote,
  };
}

export async function importFiles(
  session: Session,
  files: FileList | File[],
  probe?: ProbeFn,
): Promise<Session> {
  const list = Array.from(files);
  if (list.length === 0) {
    return { ...session, error: "No files selected", status: "Import failed" };
  }
  const expanded = await expandImportFiles(list);
  const work = expanded.files;
  if (work.length === 0) {
    return {
      ...session,
      error: expanded.errors.join(" · ") || "No files selected",
      status: "Import failed",
    };
  }
  const audioFiles: File[] = [];
  const otherFiles: File[] = [];
  for (const file of work) {
    try {
      if (classifyFile(file) === "audio") audioFiles.push(file);
      else otherFiles.push(file);
    } catch {
      otherFiles.push(file);
    }
  }
  if (audioFiles.length >= 2) {
    let next = await importStemAudioFiles(session, audioFiles, probe);
    if (otherFiles.length > 0) {
      next = await importFilesSequential(next, otherFiles, probe);
    }
    return mergeImportNotes(next, expanded.errors);
  }
  return mergeImportNotes(await importFilesSequential(session, work, probe), expanded.errors);
}

async function importFilesSequential(
  session: Session,
  files: readonly File[],
  probe?: ProbeFn,
): Promise<Session> {
  let next = session;
  const errors: string[] = [];
  const probeMsgs: string[] = [];
  let imported = 0;
  let recovered = 0;
  const prevScrollMs = session.project.scrollMs;
  const prevClipCount = session.project.clips.length;
  for (const file of files) {
    try {
      const asset = await importMediaFile(file, probe);
      const placedNext = await placeImportedAsset(next, asset, file, { persist: !asset.missing });
      if ("error" in placedNext) {
        errors.push(placedNext.error);
        continue;
      }
      next = placedNext.session;
      imported += 1;
    } catch (e) {
      if (e instanceof ImportError && e.code === "PROBE_FAILED") {
        try {
          const asset = missingAssetFromImport(file);
          const placedNext = await placeImportedAsset(next, asset, file, { persist: false });
          if ("error" in placedNext) {
            errors.push(placedNext.error);
            continue;
          }
          next = placedNext.session;
          probeMsgs.push(e.message);
          recovered += 1;
        } catch (inner) {
          errors.push(inner instanceof Error ? inner.message : String(inner));
        }
      } else if (e instanceof ImportError) {
        errors.push(e.message);
      } else {
        errors.push(e instanceof Error ? e.message : String(e));
      }
    }
  }
  if (imported === 0 && recovered === 0) {
    return {
      ...next,
      error: errors.join(" · ") || "Import failed",
      status: "Import failed",
    };
  }
  const failNote = [recovered ? `${recovered} need Relink` : null, errors.length ? `${errors.length} failed` : null]
    .filter(Boolean)
    .join(", ");
  const project = maybeScrollToOrigin(next.project, { prevScrollMs, prevClipCount });
  const parked = applyPlayhead({ ...next, project }, next.project.playheadMs);
  return {
    ...parked,
    error: [...probeMsgs, ...errors].join(" · ") || null,
    status:
      imported === 0 && recovered
        ? `Marked ${recovered} missing — Relink`
        : failNote
          ? `Imported ${imported}, ${failNote}`
          : `Imported ${imported} file(s)`,
  };
}

async function prepareImportedAudio(
  file: File,
  probe?: ProbeFn,
): Promise<{ asset: MediaAsset; file: File; persist: boolean; probe?: string } | { error: string }> {
  try {
    const asset = await importMediaFile(file, probe);
    return { asset, file, persist: !asset.missing };
  } catch (e) {
    if (e instanceof ImportError && e.code === "PROBE_FAILED") {
      try {
        return { asset: missingAssetFromImport(file), file, persist: false, probe: e.message };
      } catch (inner) {
        return { error: inner instanceof Error ? inner.message : String(inner) };
      }
    }
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

async function importStemAudioFiles(
  session: Session,
  files: readonly File[],
  probe?: ProbeFn,
): Promise<Session> {
  const errors: string[] = [];
  const probeMsgs: string[] = [];
  const prepared: { asset: MediaAsset; file: File; persist: boolean }[] = [];
  for (const file of files) {
    const item = await prepareImportedAudio(file, probe);
    if ("error" in item) {
      errors.push(item.error);
      continue;
    }
    prepared.push(item);
    if (item.probe) probeMsgs.push(item.probe);
  }
  if (prepared.length === 0) {
    return {
      ...session,
      error: errors.join(" · ") || "Import failed",
      status: "Import failed",
    };
  }

  const rawStart = session.project.playheadMs;
  const startMs = session.project.snap
    ? snapPlayheadSeek(session.project, rawStart)
    : stemStartMs(rawStart);
  const groupId = inferStemGroupId(prepared.map((p) => p.file.name));
  const allocated = allocateAudioTracksForStems(session.project, prepared.length);
  const take = allocated.trackIds.length;
  let project = allocated.project;
  const placedIds: string[] = [];
  let imported = 0;
  let recovered = 0;
  let lastTrackId = session.targetTrackId;

  for (let i = 0; i < take; i += 1) {
    const item = prepared[i]!;
    const trackId = allocated.trackIds[i]!;
    project = {
      ...project,
      assets: [...project.assets, item.asset],
      updatedAt: new Date().toISOString(),
    };
    const placed = placeAsset(project, item.asset.id, trackId, startMs);
    if (placed.error || !placed.clip) {
      errors.push(placed.error ?? "Place failed");
      continue;
    }
    project = nameStemTrack(placed.project, trackId, item.file.name, groupId);
    if (item.persist && !item.asset.missing) {
      await persistAssetBlob(session.store, item.asset, item.file);
    }
    placedIds.push(placed.clip.id);
    if (placed.audioClip) placedIds.push(placed.audioClip.id);
    if (item.asset.missing) recovered += 1;
    else imported += 1;
    lastTrackId = trackId;
  }

  const skipped = allocated.skipped;
  if (imported === 0 && recovered === 0) {
    const capNote = skipped ? `${skipped} skipped (audio track limit ${MAX_AUDIO_TRACKS})` : "";
    return {
      ...session,
      error: [errors.join(" · "), capNote].filter(Boolean).join(" · ") || "Import failed",
      status: capNote ? `Imported 0 stems, ${capNote}` : "Import failed",
    };
  }

  const failNote = [
    recovered ? `${recovered} need Relink` : null,
    skipped ? `${skipped} skipped (audio track limit ${MAX_AUDIO_TRACKS})` : null,
    errors.length ? `${errors.length} failed` : null,
  ]
    .filter(Boolean)
    .join(", ");
  const prevScrollMs = session.project.scrollMs;
  const prevClipCount = session.project.clips.length;
  project = maybeScrollToOrigin(project, { prevScrollMs, prevClipCount });
  const stemCount = imported + recovered;
  const status =
    imported === 0 && recovered
      ? `Marked ${recovered} missing — Relink`
      : failNote
        ? `Imported ${stemCount} stem(s), ${failNote}`
        : `Imported ${stemCount} stem(s)`;
  const parked = applyPlayhead(
    {
      ...withClipSelection(withHistory(session, project, status), placedIds),
      targetTrackId: lastTrackId,
      selectedTrackIds: [lastTrackId],
    },
    startMs,
  );
  return {
    ...parked,
    error: [...probeMsgs, ...errors].join(" · ") || null,
    status,
  };
}

async function placeImportedAsset(
  session: Session,
  asset: MediaAsset,
  file: File,
  opts: { persist: boolean },
): Promise<{ session: Session } | { error: string }> {
  const projectWithAsset = {
    ...session.project,
    assets: [...session.project.assets, asset],
    updatedAt: new Date().toISOString(),
  };
  const preferred = preferredTrackForAsset(asset.kind, session.targetTrackId);
  const placed = placeAsset(
    projectWithAsset,
    asset.id,
    preferred,
    lastClipEndMsOnTrack(projectWithAsset, preferred),
  );
  if (placed.error || !placed.clip) {
    return { error: placed.error ?? "Place failed" };
  }
  if (opts.persist && !asset.missing) {
    await persistAssetBlob(session.store, asset, file);
  }
  const placedIds = placed.audioClip
    ? [placed.clip.id, placed.audioClip.id]
    : [placed.clip.id];
  const placedSession = {
    ...withClipSelection(
      withHistory(session, placed.project, asset.missing ? `Missing ${asset.name}` : `Imported ${asset.name}`),
      placedIds,
    ),
    targetTrackId: preferred,
    selectedTrackIds: [preferred],
  };
  return { session: applyPlayhead(placedSession, placed.clip.startMs) };
}

export function applyPlaceAsset(
  session: Session,
  assetId: string,
  trackId: TrackId,
  startMs?: number,
): Session {
  const prevScrollMs = session.project.scrollMs;
  const prevClipCount = session.project.clips.length;
  const rawStart = startMs ?? session.project.playheadMs;
  const placedStart = !session.project.snap
    ? rawStart
    : startMs == null
      ? snapPlayheadSeek(session.project, rawStart)
      : snapTime(rawStart, collectSnapTargets(session.project)).timeMs;
  const result = placeAsset(
    session.project,
    assetId,
    trackId,
    placedStart,
  );
  if (result.error || !result.clip) {
    return { ...session, error: result.error ?? "Place failed", status: "Place failed" };
  }
  const project = maybeScrollToOrigin(result.project, { prevScrollMs, prevClipCount });
  const asset = project.assets.find((a) => a.id === assetId);
  const placedIds = result.audioClip ? [result.clip.id, result.audioClip.id] : [result.clip.id];
  const placed = {
    ...withClipSelection(
      withHistory(session, project, `Placed ${asset?.name ?? "clip"}`),
      placedIds,
    ),
    error: null,
  };
  return applyPlayhead(placed, result.clip.startMs);
}

export function applyMove(
  session: Session,
  clipId: string,
  startMs: number,
  trackId?: TrackId,
): Session {
  const snapped = session.project.snap
    ? snapTime(startMs, collectSnapTargets(session.project, clipId)).timeMs
    : startMs;
  const result = moveClip(session.project, clipId, snapped, trackId);
  if (result.error) return { ...session, error: result.error };
  return withHistory(session, result.project, "Moved clip");
}

export function applyCloseGap(session: Session): Session {
  const trackId = resolveCloseGapTrack(session.project, {
    selectedClipId: session.selectedClipId,
    selectedVis: session.selectedVis,
  });
  if (!trackId) return session;
  const result = closeGapOnTrack(session.project, trackId, session.project.playheadMs);
  if ("unchanged" in result) return session;
  if ("error" in result) return { ...session, error: result.error };
  const playheadMs = session.project.playheadMs;
  if (result.project.playheadMs !== playheadMs) {
    return withHistory(
      session,
      { ...result.project, playheadMs },
      "Closed gap",
    );
  }
  return withHistory(session, result.project, "Closed gap");
}

export function applyMoveClips(
  session: Session,
  clipIds: readonly string[],
  deltaMs: number,
  trackId?: TrackId,
): Session {
  const ids = [...new Set(clipIds)];
  if (ids.length === 0) return { ...session, error: "No clip selected" };
  if (ids.length === 1 && trackId) {
    const clip = clipById(session.project, ids[0]!);
    if (!clip) return { ...session, error: "Clip not found" };
    const result = moveClip(session.project, clip.id, clip.startMs + deltaMs, trackId);
    if (result.error) return { ...session, error: result.error };
    return withHistory(session, result.project, "Moved clip");
  }
  const result = moveClipsByDelta(session.project, ids, deltaMs);
  if (result.error) return { ...session, error: result.error };
  if (result.project === session.project) return session;
  return withHistory(session, result.project, ids.length > 1 ? "Moved clips" : "Moved clip");
}

export function applyTrim(
  session: Session,
  clipId: string,
  edge: "in" | "out",
  nextEdgeMs: number,
): Session {
  const result = trimClip(session.project, clipId, edge, nextEdgeMs);
  if (result.error) return { ...session, error: result.error };
  return withHistory(session, result.project, "Trimmed clip");
}

export function applyRippleTrim(
  session: Session,
  clipId: string,
  edge: "in" | "out",
  nextEdgeMs: number,
): Session {
  const result = rippleTrimClip(session.project, clipId, edge, nextEdgeMs);
  if (result.error) return { ...session, error: result.error };
  return withHistory(session, result.project, "Ripple trimmed");
}

export function applyRippleTrimToPlayhead(session: Session, edge: "in" | "out"): Session {
  const clip = resolveRippleTrimToPlayheadClip(session.project, {
    selectedClipId: session.selectedClipId,
    selectedVis: session.selectedVis,
  });
  if (!clip) return session;
  const playheadMs = session.project.playheadMs;
  if (!playheadStrictlyInsideClip(clip, playheadMs)) return session;
  let next = applyRippleTrim(session, clip.id, edge, playheadMs);
  if (next.project.playheadMs !== playheadMs) {
    next = { ...next, project: { ...next.project, playheadMs } };
  }
  if (clipById(next.project, clip.id) && next.selectedClipId !== clip.id) {
    return {
      ...next,
      selectedClipId: clip.id,
      selectedClipIds: [clip.id],
      selectedVis: false,
      selectedVisEventId: null,
    };
  }
  return next;
}

export function applyRoll(
  session: Session,
  clipId: string,
  edge: "in" | "out",
  nextEdgeMs: number,
): Session {
  const clip = session.project.clips.find((c) => c.id === clipId);
  if (!clip) return { ...session, error: "Clip not found" };
  if (!clipIsEnabled(clip)) return { ...session, error: "No abutting clip to roll" };
  const neighbor = abuttingNeighbor(session.project, clipId, edge);
  if (!neighbor) return { ...session, error: "No abutting clip to roll" };
  const leftId = edge === "out" ? clipId : neighbor.id;
  const rightId = edge === "out" ? neighbor.id : clipId;
  const result = rollEdit(session.project, leftId, rightId, nextEdgeMs);
  if (result.error) return { ...session, error: result.error };
  return withHistory(session, result.project, "Rolled edit");
}

/** Tracks of selected clips, else mixer/lane multi-select, else `targetTrackId`. VIS-only = none. */
export function activeEditTrackIds(session: Session): TrackId[] {
  const fromClips: TrackId[] = [];
  for (const id of selectionOf(session)) {
    const clip = clipById(session.project, id);
    if (clip && isTrackId(clip.trackId) && !fromClips.includes(clip.trackId)) {
      fromClips.push(clip.trackId);
    }
  }
  if (fromClips.length > 0) return fromClips;
  if (visEventFocused(session)) return [];
  const selected = (session.selectedTrackIds ?? []).filter(isTrackId);
  if (selected.length > 0) return [...new Set(selected)];
  return session.targetTrackId ? [session.targetTrackId] : [];
}

/** Last mixer/lane click. Ctrl/Cmd toggles a track into the S-cut set. */
export function applySelectTracks(
  session: Session,
  trackId: TrackId,
  opts?: { toggle?: boolean },
): Session {
  if (!isTrackId(trackId)) return session;
  const current =
    session.selectedTrackIds?.length > 0 ? [...session.selectedTrackIds] : [session.targetTrackId];
  const next = opts?.toggle
    ? current.includes(trackId)
      ? current.filter((id) => id !== trackId)
      : [...current, trackId]
    : [trackId];
  const ids = next.length > 0 ? next : [trackId];
  return {
    ...withClipSelection(session, []),
    selectedMarkerId: null,
    selectionAnchorClipId: null,
    targetTrackId: trackId,
    selectedTrackIds: ids,
  };
}

export function applySplit(session: Session): Session {
  if (visEventFocused(session) && selectionOf(session).length === 0) {
    const result = splitVisualizerAtPlayhead(session.project);
    if (result.error) return { ...session, error: result.error, status: "Split rejected" };
    return {
      ...withHistory(session, result.project, "Split at playhead"),
      selectedVis: true,
    };
  }
  const trackIds = new Set(activeEditTrackIds(session));
  if (trackIds.size === 0) {
    return { ...session, status: "Split", error: null };
  }
  const allow = session.project.clips.filter((c) => trackIds.has(c.trackId)).map((c) => c.id);
  const result = splitAtPlayhead(session.project, undefined, allow, { includeLinkedMate: false });
  if (result.error) return { ...session, error: result.error, status: "Split rejected" };
  return withHistory(session, result.project, "Split at playhead");
}

export function applyUndo(session: Session): Session {
  const cleared = applyAbortVolumeWrite(session);
  const result = undoHistory(cleared.history, cleared.project);
  if (!result) return { ...cleared, status: "Nothing to undo" };
  return {
    ...cleared,
    project: result.project,
    history: result.history,
    projectRevision: projectRevisionOf(cleared) + 1,
    status: "Undo",
    error: null,
  };
}

export function applyRedo(session: Session): Session {
  const cleared = applyAbortVolumeWrite(session);
  const result = redoHistory(cleared.history, cleared.project);
  if (!result) return { ...cleared, status: "Nothing to redo" };
  return {
    ...cleared,
    project: result.project,
    history: result.history,
    projectRevision: projectRevisionOf(cleared) + 1,
    status: "Redo",
    error: null,
  };
}

export function applyIn(session: Session): Session {
  const ms = snapPlayheadSeek(session.project, session.project.playheadMs);
  const result = setInPoint(session.project, ms);
  if (result.error) return { ...session, error: result.error };
  return { ...session, project: result.project, status: "IN set", error: null };
}

export function applyOut(session: Session): Session {
  const ms = snapPlayheadSeek(session.project, session.project.playheadMs);
  const result = setOutPoint(session.project, ms);
  if (result.error) return { ...session, error: result.error };
  return { ...session, project: result.project, status: "OUT set", error: null };
}

export function applyInAt(session: Session, ms: number): Session {
  const bothSet = session.project.inPointMs != null && session.project.outPointMs != null;
  const base = bothSet
    ? { ...session.project, inPointMs: null, outPointMs: null }
    : session.project;
  const result = setInPoint(base, ms);
  if (result.error) return { ...session, error: result.error };
  return { ...session, project: result.project, status: "IN set", error: null };
}

export function applyOutAt(session: Session, ms: number): Session {
  const t = Math.max(0, ms);
  if (session.project.inPointMs != null && t < session.project.inPointMs) {
    return applyLoopRange(session, session.project.inPointMs, t);
  }
  const result = setOutPoint(session.project, t);
  if (result.error) return { ...session, error: result.error };
  const complete = result.project.inPointMs != null && result.project.outPointMs != null;
  return {
    ...session,
    project: complete ? { ...result.project, loop: true } : result.project,
    status: complete ? "Loop range set" : "OUT set",
    error: null,
  };
}

export function applyLoopRange(session: Session, aMs: number, bMs: number): Session {
  const a = Math.max(0, aMs);
  const b = Math.max(0, bMs);
  const inMs = Math.min(a, b);
  const outMs = Math.max(a, b);
  const cleared = { ...session.project, inPointMs: null, outPointMs: null };
  const withIn = setInPoint(cleared, inMs);
  if (withIn.error) return { ...session, error: withIn.error };
  const withOut = setOutPoint(withIn.project, outMs);
  if (withOut.error) return { ...session, error: withOut.error };
  return {
    ...session,
    project: { ...withOut.project, loop: true },
    status: "Loop range set",
    error: null,
  };
}

export function applyMoveInOut(session: Session, deltaMs: number): Session {
  const result = moveInOut(session.project, deltaMs);
  if (result.error) return { ...session, error: result.error };
  return { ...session, project: result.project, status: "Loop range moved", error: null };
}

export function applyInPointReplace(session: Session, ms: number): Session {
  const result = setInPoint(session.project, ms, { replace: true });
  if (result.error) return { ...session, error: result.error };
  return { ...session, project: result.project, error: null };
}

export function applyOutPointReplace(session: Session, ms: number): Session {
  const result = setOutPoint(session.project, ms, { replace: true });
  if (result.error) return { ...session, error: result.error };
  return { ...session, project: result.project, error: null };
}

export function applyClearInOut(session: Session): Session {
  return { ...session, project: clearInOut(session.project), status: "IN/OUT cleared", error: null };
}

export function applyMarker(session: Session): Session {
  const at = snapPlayheadSeek(session.project, session.project.playheadMs);
  const next = addMarker(session.project, at);
  const added = next.markers[next.markers.length - 1];
  return {
    ...withClipSelection(withHistory(session, next, "Marker added"), []),
    selectedMarkerId: added?.id ?? null,
  };
}

function selectedVisEvent(session: Session) {
  if (selectionOf(session).length > 0) return undefined;
  if (!session.selectedVisEventId) return undefined;
  return visualizerEventsOf(session.project).find((e) => e.id === session.selectedVisEventId);
}

function shouldPasteVisEvent(session: Session): boolean {
  if (!session.visClipboard) return false;
  if (selectionOf(session).length > 0) return false;
  if (session.selectedVisEventId || session.selectedVis) return true;
  return session.lastClipboardKind === "vis";
}

/** Copy the selection plus living unlocked enabled mates (same expand as delete). */
export function applyCopy(session: Session): Session {
  const vis = selectedVisEvent(session);
  if (vis) {
    return {
      ...session,
      visClipboard: visEventClipboardOf(vis),
      lastClipboardKind: "vis",
      status: "Copied VIS event",
      error: null,
    };
  }
  const ids = expandDeletableClipIds(session.project, selectionOf(session));
  const clips = ids
    .map((id) => clipById(session.project, id))
    .filter((c): c is Clip => Boolean(c));
  if (clips.length === 0) return { ...session, error: "No clip selected to copy" };
  return {
    ...session,
    clipboard: clips.map((c) => ({ ...c })),
    lastClipboardKind: "clip",
    status: clips.length > 1 ? "Copied clips" : "Copied clip",
    error: null,
  };
}

/** Copy then lift-delete the selection. One history entry. */
export function applyCut(session: Session): Session {
  const vis = selectedVisEvent(session);
  if (vis) {
    const copied = applyCopy(session);
    const next = deleteVisualizerEvent(session.project, vis.id);
    return {
      ...withHistory(copied, next, "Cut VIS event"),
      selectedVisEventId: null,
      selectedVis: true,
    };
  }
  const ids = selectionOf(session);
  const copied = applyCopy(session);
  if (copied.error || copied.clipboard.length === 0) {
    return { ...session, error: copied.error ?? "No clip selected to cut" };
  }
  const next = deleteClips(session.project, ids);
  return withClipSelection(
    withHistory(
      { ...copied, project: session.project },
      next,
      ids.length > 1 ? "Cut clips" : "Cut clip",
    ),
    [],
  );
}

export function applyPaste(session: Session): Session {
  const at = snapPlayheadSeek(session.project, session.project.playheadMs);
  if (shouldPasteVisEvent(session) && session.visClipboard) {
    const { project, event } = pasteVisualizerEvent(
      session.project,
      session.visClipboard,
      at,
    );
    return {
      ...withHistory(session, project, "Pasted VIS event"),
      selectedClipId: null,
      selectedClipIds: [],
      selectedMarkerId: null,
      selectedVis: true,
      selectedVisEventId: event.id,
      selectionAnchorClipId: null,
    };
  }
  if (selectionOf(session).length === 0 && (session.selectedVisEventId || session.selectedVis)) {
    return { ...session, error: "Clipboard empty" };
  }
  if (session.clipboard.length === 0) return { ...session, error: "Clipboard empty" };
  const result = pasteClips(session.project, session.clipboard, at);
  if (result.error) return { ...session, error: result.error };
  const many = result.clipIds.length > 1;
  return withClipSelection(
    withHistory(session, result.project, many ? "Pasted clips" : "Pasted clip"),
    result.clipIds,
  );
}

/** Clone the selection at the playhead. Does not write `session.clipboard`.
 * A disabled take clones as enabled so the new instance is audible. */
export function applyDuplicate(session: Session): Session {
  const ids = expandDeletableClipIds(session.project, selectionOf(session));
  const clips = ids
    .map((id) => clipById(session.project, id))
    .filter((c): c is Clip => c != null && !clipIsLocked(c));
  if (clips.length === 0) return session;
  const result = pasteClips(
    session.project,
    clips.map((c) => (c.enabled === false ? { ...c, enabled: true } : { ...c })),
    snapPlayheadSeek(session.project, session.project.playheadMs),
  );
  if (result.error) return { ...session, error: result.error };
  const many = result.clipIds.length > 1;
  return withClipSelection(
    withHistory(session, result.project, many ? "Duplicated clips" : "Duplicated clip"),
    result.clipIds,
  );
}

export function applySlip(
  session: Session,
  clipId: string,
  deltaMs: number,
  clipIds?: readonly string[],
): Session {
  const ids = clipIds && clipIds.length > 0 ? [...clipIds] : [clipId];
  if (clipId && ids.includes(clipId)) {
    ids.splice(ids.indexOf(clipId), 1);
    ids.unshift(clipId);
  }
  const result = slipClips(session.project, ids, deltaMs);
  if (result.error) return { ...session, error: result.error };
  if (result.project === session.project) return session;
  return withHistory(session, result.project, ids.length > 1 ? "Slipped clips" : "Slipped clip");
}

export async function ingestRelinkFile(
  session: Session,
  file: File,
  expectedKind: MediaKind,
  probe?: ProbeFn,
): Promise<{ session: Session; assetId: string } | { error: string }> {
  try {
    const kind = classifyFile(file);
    if (kind !== expectedKind) {
      return { error: `Relink rejected: expected ${expectedKind}, got ${kind}` };
    }
    const asset = await importMediaFile(file, probe);
    if (asset.kind !== expectedKind) {
      return { error: `Relink rejected: expected ${expectedKind}, got ${asset.kind}` };
    }
    await persistAssetBlob(session.store, asset, file);
    const project = {
      ...session.project,
      assets: [...session.project.assets, asset],
      updatedAt: new Date().toISOString(),
    };
    return { session: { ...session, project, error: null }, assetId: asset.id };
  } catch (e) {
    if (e instanceof ImportError) return { error: e.message };
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export function applyRelinkClips(
  session: Session,
  clipIds: readonly string[],
  assetId: string,
): Session {
  const sel = relinkSelectionOf(session.project, clipIds);
  if (!sel) return session;
  const result = relinkClipsOnProject(session.project, sel.clipIds, assetId);
  if ("unchanged" in result) return session;
  if ("error" in result) return { ...session, error: result.error, status: "Relink failed" };
  return withHistory(session, result.project, sel.clipIds.length > 1 ? "Relinked clips" : "Relinked clip");
}

export function applyUnlinkClips(session: Session, clipId: string): Session {
  const result = unlinkClips(session.project, clipId);
  if (result.error) return { ...session, error: result.error };
  if (result.project === session.project) return session;
  return withHistory(session, result.project, "Unlinked clips");
}

export function applySlideClip(
  session: Session,
  clipId: string,
  deltaMs: number,
  clipIds?: readonly string[],
): Session {
  const ids = clipIds && clipIds.length > 0 ? clipIds : [clipId];
  const result = slideClips(session.project, ids, deltaMs);
  if (result.error) return { ...session, error: result.error };
  if (result.project === session.project) return session;
  return withHistory(session, result.project, ids.length > 1 ? "Slid clips" : "Slid clip");
}

export function applyUpdateClip(
  session: Session,
  clipId: string,
  patch: Parameters<typeof updateClip>[2],
): Session {
  const result = updateClip(session.project, clipId, patch);
  if (result.error) return { ...session, error: result.error };
  return withHistory(session, result.project, "Clip updated");
}

export function applySetClipsEnabled(session: Session, enabled: boolean): Session {
  const ids = selectionOf(session);
  if (ids.length === 0) return session;
  let nextProject = session.project;
  let changed = 0;
  for (const id of ids) {
    const existing = clipById(nextProject, id);
    if (!existing || clipIsEnabled(existing) === enabled) continue;
    const result = updateClip(nextProject, id, { enabled });
    if (result.error) continue;
    nextProject = result.project;
    changed += 1;
  }
  if (changed === 0 || nextProject === session.project) return session;
  const noun = changed === 1 ? "Clip" : "Clips";
  return withHistory(session, nextProject, enabled ? `${noun} enabled` : `${noun} disabled`);
}

export function applySetClipsLocked(session: Session, locked: boolean): Session {
  const ids = selectionOf(session);
  if (ids.length === 0) return session;
  let nextProject = session.project;
  let changed = 0;
  for (const id of ids) {
    const existing = clipById(nextProject, id);
    if (!existing || clipIsLocked(existing) === locked) continue;
    const result = updateClip(nextProject, id, { locked: locked ? true : undefined });
    if (result.error) continue;
    nextProject = result.project;
    changed += 1;
  }
  if (changed === 0 || nextProject === session.project) return session;
  const noun = changed === 1 ? "Clip" : "Clips";
  return withHistory(session, nextProject, locked ? `${noun} locked` : `${noun} unlocked`);
}

export function applySetClipFades(
  session: Session,
  clipId: string,
  fadeInMs: number,
  fadeOutMs: number,
): Session {
  const result = setClipFades(session.project, clipId, fadeInMs, fadeOutMs);
  if (result.error) return { ...session, error: result.error };
  return withHistory(session, result.project, "Clip fades");
}

export function applySetClipRate(session: Session, clipId: string, rate: number): Session {
  const result = setClipRate(session.project, clipId, rate);
  if (result.error) return { ...session, error: result.error };
  if (result.project === session.project) return session;
  return withHistory(session, result.project, "Clip rate");
}

export function applySetTransition(
  session: Session,
  patch: Partial<Pick<Transition, "type" | "durationMs" | "audioMode" | "audio" | "audioDurationMs" | "startMs" | "source">>,
): Session {
  const pair =
    resolveEditPair(session.project, selectionOf(session)) ??
    editPairAtProbe(session.project, snapPlayheadSeek(session.project, session.project.playheadMs));
  if (!pair) return session;
  const mapped = {
    ...patch,
    audio: patch.audio ?? patch.audioMode,
    audioMode: patch.audioMode ?? patch.audio,
  };
  const { project } = upsertTransition(session.project, pair, mapped);
  return withHistory(session, project, "Set transition");
}

function resolveAudioPair(session: Session) {
  const probe = snapPlayheadSeek(session.project, session.project.playheadMs);
  return (
    resolveEditPair(session.project, selectionOf(session)) ?? editPairAtProbe(session.project, probe)
  );
}

function audioStatus(audio: TransitionAudioMode): string {
  if (audio === "crossfade") return "Audio CROSSFADE";
  if (audio === "keepA") return "Audio KEEP A";
  if (audio === "keepB") return "Audio KEEP B";
  return "Audio CUT";
}

export function applySetTransitionAudio(session: Session, audio: TransitionAudioMode): Session {
  const pair = resolveAudioPair(session);
  if (!pair) return session;
  const existing = findTransitionForPair(session.project.transitions ?? [], pair.sourceA.id, pair.sourceB.id);
  const currentDur = transitionAudioDurationMs(existing);
  let audioDurationMs = currentDur;
  if (audio === "cut" && currentDur <= 0) audioDurationMs = 1;
  if (audio === "crossfade" && currentDur <= 0) {
    audioDurationMs = Math.max(1, existing?.durationMs ?? pair.overlapDurationMs);
  }
  if (existing && transitionAudioOf(existing) === audio && transitionAudioDurationMs(existing) === audioDurationMs) {
    return session;
  }
  const { project } = upsertTransition(session.project, pair, {
    audio,
    audioMode: audio,
    audioDurationMs,
    durationMs: existing?.durationMs ?? Math.max(1, pair.overlapDurationMs),
  });
  return withHistory(session, project, audioStatus(audio));
}

export function applySetTransitionAudioDuration(session: Session, audioDurationMs: number): Session {
  const pair = resolveAudioPair(session);
  if (!pair) return session;
  const existing = findTransitionForPair(session.project.transitions ?? [], pair.sourceA.id, pair.sourceB.id);
  const nextDur = Math.max(0, Number.isFinite(audioDurationMs) ? audioDurationMs : 0);
  if (existing && transitionAudioDurationMs(existing) === nextDur) return session;
  const { project } = upsertTransition(session.project, pair, {
    audioDurationMs: nextDur,
    durationMs: existing?.durationMs ?? Math.max(1, pair.overlapDurationMs),
  });
  return withHistory(session, project, "Audio duration");
}

function sourceStatus(source: TransitionSource): string {
  if (source === "auto") return "Source AUTO";
  if (source === "vis") return "Source VIS";
  if (source === "black") return "Source BLACK";
  return `Source ${source}`;
}

export function applySetTransitionSource(session: Session, source: TransitionSource): Session {
  const probe = snapPlayheadSeek(session.project, session.project.playheadMs);
  const pair =
    resolveEditPair(session.project, selectionOf(session)) ?? editPairAtProbe(session.project, probe);
  if (pair) {
    const existing = findTransitionForPair(session.project.transitions ?? [], pair.sourceA.id, pair.sourceB.id);
    if (existing && transitionSourceOf(existing) === source) return session;
    const { project } = upsertTransition(session.project, pair, {
      source,
      durationMs: existing?.durationMs ?? Math.max(1, pair.overlapDurationMs),
    });
    return withHistory(session, project, sourceStatus(source));
  }
  const existing = transitionAtProbe(session.project.transitions ?? [], probe);
  if (existing) {
    const project = setTransitionSource(session.project, existing.id, source);
    if (project === session.project) return session;
    return withHistory(session, project, sourceStatus(source));
  }
  const cover = clipOnTrackAt(session.project, "V1", probe) ?? clipOnTrackAt(session.project, "V2", probe);
  if (!cover) return session;
  const { project } = upsertTransition(
    session.project,
    {
      sourceA: cover,
      sourceB: cover,
      overlapStartMs: cover.startMs,
      overlapDurationMs: Math.max(1, cover.durationMs),
    },
    { source, type: "cut" },
  );
  return withHistory(session, project, sourceStatus(source));
}

export function applyLiftRange(session: Session): Session {
  if (!editRangeOf(session.project)) return session;
  const result = liftRange(session.project);
  if (result.project === session.project) return session;
  return withClipSelection(withHistory(session, result.project, "Lifted range"), []);
}

export function applyExtractRange(session: Session): Session {
  if (!editRangeOf(session.project)) return session;
  const result = extractRange(session.project);
  if (result.error) return { ...session, error: result.error };
  if (result.project === session.project) return session;
  return withClipSelection(withHistory(session, result.project, "Extracted range"), []);
}

export function applyDelete(session: Session): Session {
  if (session.selectedVolumeAutomation) {
    return applyDeleteVolumeAutomationPoint(
      session,
      session.selectedVolumeAutomation.trackId,
      session.selectedVolumeAutomation.timeMs,
    );
  }
  const ids = selectionOf(session);
  if (ids.length > 0) {
    const next = deleteClips(session.project, ids);
    return withClipSelection(
      withHistory(session, next, ids.length > 1 ? "Clips deleted" : "Clip deleted"),
      [],
    );
  }
  if (session.selectedVisEventId) {
    const next = deleteVisualizerEvent(session.project, session.selectedVisEventId);
    if (next === session.project) return session;
    return {
      ...withHistory(session, next, "Deleted VIS event"),
      selectedVisEventId: null,
      selectedVis: true,
    };
  }
  if (session.selectedMarkerId) {
    const result = deleteMarker(session.project, session.selectedMarkerId);
    if (result.error) return { ...session, error: result.error };
    return { ...withHistory(session, result.project, "Marker deleted"), selectedMarkerId: null };
  }
  if (editRangeOf(session.project)) return applyLiftRange(session);
  return { ...session, error: "No clip selected" };
}

export function applyRippleDelete(session: Session): Session {
  const ids = selectionOf(session);
  if (ids.length > 0) {
    const next = rippleDeleteClips(session.project, ids);
    if (next.error) return { ...session, error: next.error };
    if (next.project === session.project) return session;
    return withClipSelection(withHistory(session, next.project, "Ripple deleted"), []);
  }
  if (session.selectedVisEventId) return applyDelete(session);
  if (editRangeOf(session.project)) return applyExtractRange(session);
  return { ...session, error: "No clip selected" };
}

export function applyNudge(session: Session, deltaMs: number): Session {
  const ids = selectionOf(session);
  if (ids.length === 0) return { ...session, error: "No clip selected" };
  let moveBy = deltaMs;
  if (session.project.snap && deltaMs !== 0) {
    const primary = clipById(session.project, ids[0]!);
    if (primary) {
      const intended = primary.startMs + deltaMs;
      const snapped = snapTime(intended, collectSnapTargets(session.project, ids)).timeMs;
      const toward = deltaMs > 0 ? snapped > primary.startMs : snapped < primary.startMs;
      if (toward) moveBy = snapped - primary.startMs;
    }
  }
  const result = moveClipsByDelta(session.project, ids, moveBy);
  if (result.error) return { ...session, error: result.error };
  const verb = deltaMs < 0 ? "Nudged left" : "Nudged right";
  return withHistory(session, result.project, verb);
}

export function applyRenameProject(session: Session, name: string): Session {
  const next = renameProject(session.project, name);
  if (next === session.project) return session;
  return withHistory(session, next, "Project renamed");
}

export function applyRenameMarker(session: Session, markerId: string, label: string): Session {
  const result = renameMarker(session.project, markerId, label);
  if (result.error) return { ...session, error: result.error };
  if (result.project === session.project) return session;
  return {
    ...withHistory(session, result.project, "Marker renamed"),
    selectedMarkerId: markerId,
  };
}

export function applyDeleteMarker(session: Session, markerId: string): Session {
  const result = deleteMarker(session.project, markerId);
  if (result.error) return { ...session, error: result.error };
  return {
    ...withHistory(session, result.project, "Marker deleted"),
    selectedMarkerId: session.selectedMarkerId === markerId ? null : session.selectedMarkerId,
  };
}

export function applyMoveMarker(session: Session, markerId: string, timeMs: number): Session {
  const snapped = session.project.snap
    ? snapTime(timeMs, collectSnapTargets(session.project, undefined, markerId)).timeMs
    : timeMs;
  const result = moveMarker(session.project, markerId, snapped);
  if (result.error) return { ...session, error: result.error };
  return {
    ...withClipSelection(session, []),
    project: result.project,
    selectedMarkerId: markerId,
    error: null,
  };
}

export type PlayheadApplyMode = "seek" | "transport";

export function applyPlayhead(
  session: Session,
  timeMs: number,
  mode: PlayheadApplyMode = "seek",
): Session {
  let nextSession = session;
  if (session.volumeWriteGesture) {
    const prev = session.project.playheadMs;
    const wrapped = Number.isFinite(timeMs) && Number.isFinite(prev) && timeMs + 50 < prev;
    if (mode === "seek") {
      nextSession = applyCommitVolumeWrite(session);
    } else if (mode === "transport" && wrapped) {
      nextSession = applyCommitVolumeWrite(session);
    }
  }
  session = nextSession;
  const project = setPlayhead(session.project, timeMs);
  if (!session.followPlayhead) return { ...session, project };
  const scrollMs =
    mode === "transport"
      ? scrollFollowPlayhead(
          project.playheadMs,
          project.scrollMs,
          project.zoomPxPerSec,
          session.timelineWidthPx,
          projectDurationMs(project),
          session.timelineLaneLabelPx,
        )
      : scrollKeepPlayheadInView(
          project.playheadMs,
          project.scrollMs,
          project.zoomPxPerSec,
          session.timelineWidthPx,
          session.timelineLaneLabelPx,
        );
  if (scrollMs === project.scrollMs) return { ...session, project };
  return { ...session, project: { ...project, scrollMs } };
}

/** Frame-step the needle. Snap toward nearby edits; do not stick to the current playhead. */
export function applyNudgePlayhead(session: Session, deltaMs: number): Session {
  const intended = session.project.playheadMs + deltaMs;
  let nextMs = intended;
  if (session.project.snap && deltaMs !== 0) {
    const snapped = snapPlayheadSeek(session.project, intended);
    const toward = deltaMs > 0 ? snapped > session.project.playheadMs : snapped < session.project.playheadMs;
    if (toward) nextMs = snapped;
  }
  return applyPlayhead(session, nextMs);
}

export function applyTimelineViewport(
  session: Session,
  timelineWidthPx: number,
  laneLabelPx?: number,
): Session {
  const width = Math.max(1, timelineWidthPx);
  const label = laneLabelPx != null && laneLabelPx > 0 ? laneLabelPx : session.timelineLaneLabelPx;
  if (session.timelineWidthPx === width && session.timelineLaneLabelPx === label) return session;
  return { ...session, timelineWidthPx: width, timelineLaneLabelPx: label };
}

export function applyToggleFollow(session: Session): Session {
  return { ...session, followPlayhead: !session.followPlayhead };
}

export function applyGotoNextEdit(session: Session): Session {
  const next = nextEditPointMs(session.project, session.project.playheadMs);
  if (next == null) return session;
  return applyPlayhead(session, next);
}

export function applyGotoPrevEdit(session: Session): Session {
  const prev = prevEditPointMs(session.project, session.project.playheadMs);
  if (prev == null) return session;
  return applyPlayhead(session, prev);
}

export function applyToggleLoop(session: Session): Session {
  return { ...session, project: toggleLoop(session.project) };
}

export function applyToggleSnap(session: Session): Session {
  return { ...session, project: toggleSnap(session.project) };
}

export function applyTrackVolume(session: Session, trackId: TrackId, volume: number): Session {
  return {
    ...session,
    project: setTrackVolume(session.project, trackId, volume),
    status: `${trackId} ${formatDb(linearToDb(volume))}`,
    error: null,
  };
}

export function volumeWriteIsArmed(session: Session, trackId: TrackId): boolean {
  return session.volumeWriteArmedIds.includes(trackId);
}

/** W ON + forward playback + audio track. Movement is checked separately. */
export function volumeWriteCanCapture(session: Session, trackId: TrackId): boolean {
  if (!volumeWriteIsArmed(session, trackId)) return false;
  if (!session.playing) return false;
  if (session.shuttleRate <= 0) return false;
  if (kindOfTrack(trackId) !== "audio") return false;
  if (!trackById(session.project, trackId)) return false;
  return Number.isFinite(session.project.playheadMs);
}

/** Focused/selected audio track for bare W. Video/VIS-only = none — never trim. */
export function volumeWriteArmTarget(session: Session): TrackId | null {
  return activeEditTrackIds(session).find((id) => kindOfTrack(id) === "audio") ?? null;
}

export function applyToggleVolumeWriteArm(session: Session, trackId: TrackId): Session {
  if (kindOfTrack(trackId) !== "audio" || !trackById(session.project, trackId)) return session;
  if (session.volumeWriteArmedIds.includes(trackId)) {
    const committed = applyCommitVolumeWrite(session);
    return {
      ...committed,
      volumeWriteArmedIds: committed.volumeWriteArmedIds.filter((id) => id !== trackId),
      status: "Write off",
      error: null,
    };
  }
  return {
    ...session,
    volumeWriteArmedIds: [...session.volumeWriteArmedIds, trackId],
    status: "Write armed",
    error: null,
  };
}

export function applyAbortVolumeWrite(session: Session): Session {
  if (!session.volumeWriteGesture) return session;
  return { ...session, volumeWriteGesture: null };
}

export function applyCommitVolumeWrite(session: Session): Session {
  const gesture = session.volumeWriteGesture;
  if (!gesture) return session.volumeWriteGesture ? { ...session, volumeWriteGesture: null } : session;
  const samples = gestureSamplesForCommit(gesture, session.project.playheadMs);
  if (samples.length === 0) return { ...session, volumeWriteGesture: null };
  const punched = punchVolumeWrite(gesture.before, samples);
  const pre = session.project;
  const final = setTrackVolumeAutomation(pre, gesture.trackId, punched);
  if (final === pre) return { ...session, volumeWriteGesture: null };
  return {
    ...withHistory({ ...session, volumeWriteGesture: null }, final, "Volume write"),
    volumeWriteGesture: null,
  };
}

export function applyCommitVolumeWriteIfIdle(
  session: Session,
  nowMs = Date.now(),
  idleMs = WRITE_IDLE_END_MS,
): Session {
  if (!session.volumeWriteGesture) return session;
  if (!writeGestureIsIdle(session.volumeWriteGesture, nowMs, idleMs)) return session;
  return applyCommitVolumeWrite(session);
}

/**
 * First / later fader samples: session chrome only.
 * Must not clone `project`, push history, persist, or punch G.
 * Live audible gain is `gesture.liveValue` — Preview must not rebind media.
 */
export function applyVolumeWriteSample(
  session: Session,
  trackId: TrackId,
  timeMs: number,
  value: number,
  nowMs = Date.now(),
): Session {
  if (!volumeWriteCanCapture(session, trackId)) return session;
  const track = trackById(session.project, trackId);
  if (!track) return session;

  let working = session;
  if (working.volumeWriteGesture && working.volumeWriteGesture.trackId !== trackId) {
    working = applyCommitVolumeWrite(working);
  }

  const currentGesture = working.volumeWriteGesture?.trackId === trackId ? working.volumeWriteGesture : null;
  if (
    currentGesture &&
    Number.isFinite(timeMs) &&
    timeMs + 80 < currentGesture.endMs
  ) {
    working = applyCommitVolumeWrite(working);
  }

  const gesture = working.volumeWriteGesture?.trackId === trackId ? working.volumeWriteGesture : null;
  const liveTrack = trackById(working.project, trackId);
  if (!liveTrack) return working;
  if (!volumeWriteCanCapture(working, trackId)) return working;

  if (!gesture && !isMeaningfulWriteMove(liveTrack.volume ?? 1, value)) return working;

  const appended = appendWriteSample(
    gesture,
    trackId,
    timeMs,
    value,
    gesture?.before ?? volumeAutomationOf(liveTrack),
    nowMs,
  );
  if (!appended) return working;
  if (appended.wrapped) {
    const committed = applyCommitVolumeWrite(working);
    if (!volumeWriteCanCapture(committed, trackId)) return committed;
    return applyVolumeWriteSample(committed, trackId, timeMs, value, nowMs);
  }

  return {
    ...working,
    project: working.project,
    volumeWriteGesture: appended.gesture,
    status: "Writing volume",
    error: null,
  };
}

/** Mixer fader: write into G while armed+playing; otherwise static track volume. */
export function applyMixerVolume(session: Session, trackId: TrackId, volume: number): Session {
  if (volumeWriteCanCapture(session, trackId)) {
    return applyVolumeWriteSample(session, trackId, session.project.playheadMs, volume);
  }
  return applyTrackVolume(session, trackId, volume);
}

export function applySetTrackPan(session: Session, trackId: TrackId, pan: number): Session {
  return {
    ...session,
    project: setTrackPan(session.project, trackId, pan),
    status: `${trackId} ${formatPan(pan)}`,
    error: null,
  };
}

export function applyMasterVolume(session: Session, volume: number): Session {
  return {
    ...session,
    project: setMasterVolume(session.project, volume),
    status: `Master ${formatDb(linearToDb(volume))}`,
    error: null,
  };
}

export function applyToggleMute(session: Session, trackId: TrackId): Session {
  const next = toggleTrackMute(session.project, trackId);
  const track = next.tracks.find((t) => t.id === trackId);
  const verb = track?.muted ? "Muted" : "Unmuted";
  return { ...session, project: next, status: `${verb} ${trackId}`, error: null };
}

export function applyToggleSolo(session: Session, trackId: TrackId): Session {
  const next = toggleTrackSolo(session.project, trackId);
  const track = next.tracks.find((t) => t.id === trackId);
  const verb = track?.solo ? "Solo" : "Unsolo";
  return { ...session, project: next, status: `${verb} ${trackId}`, error: null };
}

export function applyAddAudioTrack(session: Session): Session {
  if (!canAddAudioTrack(session.project)) {
    return { ...session, error: "Audio track limit is 64", status: session.status };
  }
  const result = addAudioTrack(session.project);
  if (result.error || !result.track) {
    return { ...session, error: result.error ?? "Could not add audio track" };
  }
  return {
    ...withHistory(session, result.project, `Added ${result.track.name}`),
    targetTrackId: result.track.id,
    selectedTrackIds: [result.track.id],
  };
}

export function applyRemoveAudioTrack(session: Session, trackId?: TrackId): Session {
  const id = trackId ?? session.targetTrackId;
  if (!canRemoveAudioTrack(session.project, kindOfTrack(id) === "audio" ? id : undefined)) {
    return { ...session, error: "Need at least two audio tracks", status: session.status };
  }
  let working = session;
  if (working.volumeWriteGesture?.trackId === id) {
    working = applyCommitVolumeWrite(working);
  }
  const result = removeAudioTrack(
    working.project,
    kindOfTrack(id) === "audio" ? id : undefined,
  );
  if (result.error || !result.removedId) {
    return { ...working, error: result.error ?? "Could not remove audio track" };
  }
  const nextTarget =
    result.project.tracks.find((t) => t.id === session.targetTrackId)?.id ??
    result.project.tracks.find((t) => t.kind === "audio")?.id ??
    "V1";
  return {
    ...withHistory(working, syncTrackGroups(result.project), `Removed audio track`),
    targetTrackId: nextTarget,
    selectedTrackIds: [nextTarget],
    selectedClipId: working.selectedClipId && result.project.clips.some((c) => c.id === working.selectedClipId)
      ? working.selectedClipId
      : null,
    selectedClipIds: working.selectedClipIds.filter((cid) =>
      result.project.clips.some((c) => c.id === cid),
    ),
    volumeWriteArmedIds: working.volumeWriteArmedIds.filter((tid) => tid !== result.removedId),
    volumeWriteGesture:
      working.volumeWriteGesture?.trackId === result.removedId ? null : working.volumeWriteGesture,
  };
}

function audioIdsForGroup(session: Session, trackIds?: readonly TrackId[]): TrackId[] {
  const raw =
    trackIds && trackIds.length > 0
      ? trackIds
      : (session.selectedTrackIds ?? []).filter((id) => kindOfTrack(id) === "audio");
  const audio = raw.filter((id) => kindOfTrack(id) === "audio");
  if (audio.length > 0) return audio;
  if (kindOfTrack(session.targetTrackId) === "audio") return [session.targetTrackId];
  const last = session.project.tracks.filter((t) => t.kind === "audio").at(-1);
  return last ? [last.id] : [];
}

export function applyCreateTrackGroup(session: Session, name?: string, trackIds?: readonly TrackId[]): Session {
  const ids = audioIdsForGroup(session, trackIds);
  const result = createTrackGroup(session.project, {
    name: name ?? nextTrackGroupName(session.project),
    trackIds: ids,
  });
  if (result.error || !result.group) {
    return { ...session, error: result.error ?? "Could not create group" };
  }
  return withHistory(session, result.project, `Grouped ${result.group.name}`);
}

export function applyAssignTracksToGroup(
  session: Session,
  trackIds: readonly TrackId[],
  groupId: string | null,
): Session {
  const ids = trackIds.filter((id) => kindOfTrack(id) === "audio");
  if (ids.length === 0) return session;
  const next = assignTracksToGroup(session.project, ids, groupId);
  if (next === session.project) return session;
  const status = groupId ? "Assigned to group" : "Ungrouped track";
  return withHistory(session, next, status);
}

export function applyRenameTrackGroup(session: Session, groupId: string, name: string): Session {
  const next = renameTrackGroup(session.project, groupId, name);
  if (next === session.project) return session;
  return withHistory(session, next, "Group renamed");
}

export function applySelectVolumeAutomationPoint(
  session: Session,
  sel: { trackId: TrackId; timeMs: number } | null,
): Session {
  if (!sel) {
    return session.selectedVolumeAutomation ? { ...session, selectedVolumeAutomation: null } : session;
  }
  return {
    ...session,
    selectedVolumeAutomation: sel,
    selectedClipId: null,
    selectedClipIds: [],
    selectedMarkerId: null,
    selectedVis: false,
    selectedVisEventId: null,
    selectedVisEventIds: [],
    targetTrackId: sel.trackId,
    selectedTrackIds: [sel.trackId],
  };
}

export function applySetVolumeAutomationEnabled(
  session: Session,
  trackId: TrackId,
  enabled: boolean,
): Session {
  const next = setVolumeAutomationEnabled(session.project, trackId, enabled);
  if (next === session.project) return session;
  return withHistory(session, next, enabled ? "Volume automation on" : "Volume automation off");
}

export function applyAddVolumeAutomationPoint(
  session: Session,
  trackId: TrackId,
  timeMs: number,
  value: number,
): Session {
  const result = addVolumeAutomationPoint(session.project, trackId, timeMs, value);
  if (result.project === session.project || !result.point) return session;
  return {
    ...withHistory(session, result.project, "Volume point added"),
    selectedVolumeAutomation: { trackId, timeMs: result.point.timeMs },
    selectedClipId: null,
    selectedClipIds: [],
    targetTrackId: trackId,
    selectedTrackIds: [trackId],
  };
}

export function applyDeleteVolumeAutomationPoint(
  session: Session,
  trackId: TrackId,
  timeMs: number,
): Session {
  const next = deleteVolumeAutomationPoint(session.project, trackId, timeMs);
  if (next === session.project) return session;
  const selected =
    session.selectedVolumeAutomation?.trackId === trackId &&
    session.selectedVolumeAutomation.timeMs === timeMs
      ? null
      : session.selectedVolumeAutomation;
  return { ...withHistory(session, next, "Volume point deleted"), selectedVolumeAutomation: selected };
}

export function applyMoveVolumeAutomationPoint(
  session: Session,
  trackId: TrackId,
  fromTimeMs: number,
  timeMs: number,
  value: number,
): Session {
  const result = moveVolumeAutomationPoint(session.project, trackId, fromTimeMs, timeMs, value);
  if (result.project === session.project || !result.point) return session;
  return {
    ...withHistory(session, result.project, "Volume point moved"),
    selectedVolumeAutomation: { trackId, timeMs: result.point.timeMs },
  };
}

export function previewMoveVolumeAutomationPoint(
  session: Session,
  trackId: TrackId,
  fromTimeMs: number,
  timeMs: number,
  value: number,
): { project: Project; point?: VolumeAutomationPoint } {
  return moveVolumeAutomationPoint(session.project, trackId, fromTimeMs, timeMs, value);
}

export function applyPlay(session: Session): Session {
  return { ...session, playing: true, shuttleRate: 1, status: "Playing", error: null };
}

export function applyPause(session: Session): Session {
  const committed = applyCommitVolumeWrite(session);
  return { ...committed, playing: false, shuttleRate: 0, status: "Paused", error: null };
}

export function applyStop(session: Session): Session {
  const committed = applyCommitVolumeWrite(session);
  return applyPlayhead(
    { ...committed, playing: false, shuttleRate: 0, status: "Stopped", error: null },
    committed.project.inPointMs ?? 0,
  );
}

export function applyPlayPause(session: Session): Session {
  return session.playing || session.shuttleRate !== 0 ? applyPause(session) : applyPlay(session);
}

export function applyShuttle(session: Session, dir: -1 | 0 | 1): Session {
  const rate = nextShuttleRate(session.shuttleRate, dir);
  const base = rate <= 0 ? applyCommitVolumeWrite(session) : session;
  if (rate === 0) {
    return { ...base, playing: false, shuttleRate: 0, status: "Paused", error: null };
  }
  const label = rate < 0 ? `Shuttle ${rate}x` : `Shuttle +${rate}x`;
  return { ...base, playing: true, shuttleRate: rate, status: label, error: null };
}

export function applyToggleVisualizerMute(session: Session): Session {
  const next = toggleVisualizerMute(session.project);
  const verb = next.visualizer.muted ? "Muted" : "Unmuted";
  return { ...session, project: next, status: `${verb} VIS`, error: null };
}

/** Menu pick — same visible-scene path as cycle (selected event, else cue rematerialize). */
export function applyPickVisualizerScene(session: Session, sceneId: VisualizerSceneId): Session {
  const eventId = session.selectedVisEventId;
  if (eventId) {
    const selected = visualizerEventsOf(session.project).find((e) => e.id === eventId);
    if (selected) {
      const updated = updateVisualizerEvent(session.project, eventId, { sceneId });
      const project = {
        ...updated,
        visualizer: { ...updated.visualizer, sceneId },
      };
      const event = visualizerEventsOf(project).find((e) => e.id === eventId);
      return {
        ...session,
        project,
        status: `Visualizer ${event?.sceneId ?? sceneId}`,
        error: null,
      };
    }
  }
  const at = snapPlayheadSeek(session.project, session.project.playheadMs);
  const { project, event } = setVisualizerSceneAt(session.project, at, sceneId);
  return {
    ...session,
    project,
    selectedClipId: null,
    selectedClipIds: [],
    selectedMarkerId: null,
    selectedVis: true,
    selectedVisEventId: event?.id ?? null,
    selectedVisEventIds: event ? [event.id] : [],
    status: `Visualizer ${sceneId}`,
    error: null,
  };
}

export function applyCycleVisualizerScene(session: Session): Session {
  const eventId = session.selectedVisEventId;
  if (eventId) {
    const selected = visualizerEventsOf(session.project).find((e) => e.id === eventId);
    if (selected) {
      const next = cycleVisualizerScene(session.project, eventId);
      const event = visualizerEventsOf(next).find((e) => e.id === eventId);
      return {
        ...session,
        project: next,
        status: `Visualizer ${event?.sceneId ?? next.visualizer.sceneId}`,
        error: null,
      };
    }
  }
  const at = snapPlayheadSeek(session.project, session.project.playheadMs);
  const { project, event } = insertCueAtPlayhead(session.project, at);
  return {
    ...session,
    project,
    selectedClipId: null,
    selectedClipIds: [],
    selectedMarkerId: null,
    selectedVis: true,
    selectedVisEventId: event?.id ?? null,
    selectedVisEventIds: event ? [event.id] : [],
    status: `Visualizer ${event?.sceneId ?? project.visualizer.sceneId}`,
    error: null,
  };
}

export function applySelectVis(session: Session): Session {
  return {
    ...session,
    selectedClipId: null,
    selectedClipIds: [],
    selectedMarkerId: null,
    selectedVis: true,
    selectedVisEventId: null,
    selectedVisEventIds: [],
    selectedTrackIds: [],
    selectionAnchorClipId: null,
  };
}

export function applySelectVisEvent(session: Session, eventId: string): Session {
  const event = visualizerEventsOf(session.project).find((e) => e.id === eventId);
  if (!event) return applySelectVis(session);
  return {
    ...session,
    selectedClipId: null,
    selectedClipIds: [],
    selectedMarkerId: null,
    selectedVis: true,
    selectedVisEventId: event.id,
    selectedVisEventIds: [event.id],
    selectedTrackIds: [],
    selectionAnchorClipId: null,
  };
}

export function applyInsertVisEvent(session: Session): Session {
  const at = snapPlayheadSeek(session.project, session.project.playheadMs);
  const { project, event, inserted } = insertVisualizerEvent(
    session.project,
    at,
  );
  if (!inserted) return applySelectVisEvent(session, event.id);
  return {
    ...withHistory(session, project, "VIS event"),
    selectedClipId: null,
    selectedClipIds: [],
    selectedMarkerId: null,
    selectedVis: true,
    selectedVisEventId: event.id,
    selectionAnchorClipId: null,
  };
}

export function applyMoveVisEvent(session: Session, eventId: string, startMs: number): Session {
  const snapped = session.project.snap
    ? snapTime(startMs, collectVisEventSnapTargets(session.project, eventId)).timeMs
    : startMs;
  const project = moveVisualizerEvent(session.project, eventId, snapped);
  if (project === session.project) return session;
  return {
    ...withHistory(session, project, "Moved VIS event"),
    selectedVis: true,
    selectedVisEventId: eventId,
    selectedClipId: null,
    selectedClipIds: [],
  };
}

export function applyStretchVisEvent(
  session: Session,
  eventId: string,
  edge: "in" | "out",
  nextEdgeMs: number,
): Session {
  const snapped = session.project.snap
    ? snapTime(nextEdgeMs, collectVisEventSnapTargets(session.project, eventId)).timeMs
    : nextEdgeMs;
  const project = stretchVisualizerEvent(session.project, eventId, edge, snapped);
  if (project === session.project) return session;
  return {
    ...withHistory(session, project, "Stretched VIS event"),
    selectedVis: true,
    selectedVisEventId: eventId,
    selectedClipId: null,
    selectedClipIds: [],
  };
}

export function applySetFrontVideoTrack(session: Session, trackId: FrontVideoTrackId): Session {
  const next = trackId === "V1" ? "V1" : "V2";
  const current = session.project.frontVideoTrackId === "V1" ? "V1" : "V2";
  if (current === next) return session;
  return withHistory(
    session,
    { ...session.project, frontVideoTrackId: next, updatedAt: new Date().toISOString() },
    `Front ${next}`,
  );
}

export function applySetVisualizer(
  session: Session,
  patch: Partial<Pick<VisualizerState, "sceneId" | "startMs" | "durationMs">>,
): Session {
  if (patch.sceneId) {
    const picked = applyPickVisualizerScene(session, patch.sceneId);
    const rest = { startMs: patch.startMs, durationMs: patch.durationMs };
    if (rest.startMs == null && rest.durationMs == null) return picked;
    return {
      ...picked,
      project: setVisualizer(picked.project, rest),
      status: `Visualizer ${picked.project.visualizer.sceneId}`,
      error: null,
    };
  }
  if (session.selectedVisEventId) {
    const project = updateVisualizerEvent(session.project, session.selectedVisEventId, patch);
    const event = visualizerEventsOf(project).find((e) => e.id === session.selectedVisEventId);
    return {
      ...session,
      project,
      status: `Visualizer ${event?.sceneId ?? project.visualizer.sceneId}`,
      error: null,
    };
  }
  const project = setVisualizer(session.project, patch);
  return {
    ...session,
    project,
    status: `Visualizer ${project.visualizer.sceneId}`,
    error: null,
  };
}

function compareClipOrder(a: Clip, b: Clip): number {
  return a.startMs - b.startMs || a.id.localeCompare(b.id);
}

function earliestSelectedClipId(session: Session): string | null {
  const clips = selectionOf(session)
    .map((id) => clipById(session.project, id))
    .filter((c): c is Clip => !!c)
    .sort(compareClipOrder);
  return clips[0]?.id ?? null;
}

/** Inclusive same-track range. Empty when tracks/kinds differ. VIS is not a clip. */
export function clipsInShiftRange(project: Project, fromId: string, toId: string): string[] {
  const from = clipById(project, fromId);
  const to = clipById(project, toId);
  if (!from || !to) return [];
  if (from.trackId !== to.trackId) return [];
  if (kindOfTrack(from.trackId) !== kindOfTrack(to.trackId)) return [];
  const onTrack = project.clips.filter((c) => c.trackId === from.trackId).sort(compareClipOrder);
  const i = onTrack.findIndex((c) => c.id === from.id);
  const j = onTrack.findIndex((c) => c.id === to.id);
  if (i < 0 || j < 0) return [];
  const lo = Math.min(i, j);
  const hi = Math.max(i, j);
  return onTrack.slice(lo, hi + 1).map((c) => c.id);
}

export function applySelect(
  session: Session,
  clipId: string | null,
  opts?: { toggle?: boolean; range?: boolean },
): Session {
  if (clipId == null) {
    return { ...withClipSelection(session, []), selectedMarkerId: null, selectionAnchorClipId: null };
  }
  if (opts?.range) {
    const clicked = clipById(session.project, clipId);
    if (!clicked) return session;
    const stored = session.selectionAnchorClipId;
    const anchorId =
      stored && clipById(session.project, stored) ? stored : earliestSelectedClipId(session);
    if (!anchorId) {
      return {
        ...withClipSelection(session, [clipId]),
        selectedMarkerId: null,
        selectionAnchorClipId: clipId,
      };
    }
    const ids = clipsInShiftRange(session.project, anchorId, clipId);
    if (ids.length === 0) return session;
    return {
      ...withClipSelection(session, ids),
      selectedMarkerId: null,
      selectionAnchorClipId: stored ?? anchorId,
    };
  }
  if (opts?.toggle) {
    const current = selectionOf(session);
    const hadNone = current.length === 0;
    const next = current.includes(clipId)
      ? current.filter((id) => id !== clipId)
      : [clipId, ...current];
    const anchor = hadNone ? clipId : session.selectionAnchorClipId;
    return { ...withClipSelection(session, next), selectedMarkerId: null, selectionAnchorClipId: anchor };
  }
  const clicked = clipById(session.project, clipId);
  return {
    ...withClipSelection(session, [clipId]),
    selectedMarkerId: null,
    selectionAnchorClipId: clipId,
    targetTrackId: clicked?.trackId ?? session.targetTrackId,
    selectedTrackIds: clicked?.trackId ? [clicked.trackId] : session.selectedTrackIds,
  };
}

/** Marquee / multi-select. Union keeps existing ids (Shift+marquee). */
export function applySelectClips(
  session: Session,
  clipIds: readonly string[],
  opts?: { union?: boolean },
): Session {
  if (opts?.union) {
    const next = [...selectionOf(session)];
    for (const id of clipIds) {
      if (!next.includes(id)) next.push(id);
    }
    return { ...withClipSelection(session, next), selectedMarkerId: null };
  }
  return { ...withClipSelection(session, [...clipIds]), selectedMarkerId: null };
}

function visEventFocused(session: Session): boolean {
  if (selectionOf(session).length > 0) return false;
  return Boolean(session.selectedVisEventId || session.selectedVis);
}

/** All clips on the project track collection. VIS-focused: all VIS events, no clips. Empty = no-op. Selection-only (no history). */
export function applySelectAll(session: Session): Session {
  if (visEventFocused(session)) {
    const events = visualizerEventsOf(session.project);
    if (events.length === 0) return session;
    const ids = events.map((e) => e.id);
    return {
      ...session,
      selectedClipId: null,
      selectedClipIds: [],
      selectedMarkerId: null,
      selectedVis: true,
      selectedVisEventId: session.selectedVisEventId && ids.includes(session.selectedVisEventId)
        ? session.selectedVisEventId
        : ids[0]!,
      selectedVisEventIds: ids,
      selectionAnchorClipId: null,
    };
  }
  const ids = session.project.clips.map((c) => c.id);
  if (ids.length === 0) return session;
  return { ...withClipSelection(session, ids), selectedMarkerId: null };
}

/** Clips on the primary clip’s track, else `targetTrackId` (last mixer/bin/track click). */
export function applySelectAllOnTrack(session: Session): Session {
  const primary = session.selectedClipId
    ? clipById(session.project, session.selectedClipId)
    : undefined;
  const trackId = primary?.trackId ?? session.targetTrackId;
  const ids = session.project.clips.filter((c) => c.trackId === trackId).map((c) => c.id);
  if (ids.length === 0) return session;
  return { ...withClipSelection(session, ids), selectedMarkerId: null };
}

export function applySelectMarker(session: Session, markerId: string | null): Session {
  if (markerId) {
    const marker = session.project.markers.find((m) => m.id === markerId);
    const selected = { ...withClipSelection(session, []), selectedMarkerId: markerId };
    if (!marker) return selected;
    return applyPlayhead(selected, marker.timeMs);
  }
  return { ...session, selectedMarkerId: null };
}

export function applyZoom(
  session: Session,
  zoomPxPerSec: number,
  timelineWidthPx = 1000,
  laneLabelPx?: number,
): Session {
  const minZ = minZoomPxPerSec(session.project, timelineWidthPx, laneLabelPx);
  const zoomOld = session.project.zoomPxPerSec;
  const zoomNew = clampZoomPxPerSec(zoomPxPerSec, minZ);
  return {
    ...session,
    timelineWidthPx,
    timelineLaneLabelPx: laneLabelPx ?? session.timelineLaneLabelPx,
    project: {
      ...session.project,
      zoomPxPerSec: zoomNew,
      scrollMs: scrollZoomAroundPlayhead({
        playheadMs: session.project.playheadMs,
        scrollMs: session.project.scrollMs,
        zoomOld,
        zoomNew,
        timelineWidthPx,
        laneLabelPx,
      }),
    },
  };
}

/** Fit the whole project in the lane and reset scroll to t=0. */
export function applyFit(session: Session, timelineWidthPx: number, laneLabelPx?: number): Session {
  const z = fitZoomPxPerSec(session.project, timelineWidthPx, laneLabelPx);
  const minZ = minZoomPxPerSec(session.project, timelineWidthPx, laneLabelPx);
  return {
    ...session,
    timelineWidthPx,
    timelineLaneLabelPx: laneLabelPx ?? session.timelineLaneLabelPx,
    project: {
      ...session.project,
      zoomPxPerSec: clampZoomPxPerSec(z, minZ),
      scrollMs: 0,
    },
    status: "Fit timeline",
    error: null,
  };
}

export function applyScroll(session: Session, scrollMs: number): Session {
  const next = clampScrollMs(
    scrollMs,
    projectDurationMs(session.project),
    session.project.zoomPxPerSec,
    session.timelineWidthPx,
    session.timelineLaneLabelPx,
  );
  if (next === session.project.scrollMs) return session;
  return { ...session, project: { ...session.project, scrollMs: next } };
}

export function openSerialized(session: Session, text: string): Session {
  const project = deserializeProject(text);
  return {
    ...session,
    project,
    history: createHistory(),
    selectedClipId: null,
    selectedClipIds: [],
    selectedMarkerId: null,
    selectedVis: false,
    selectedVisEventId: null,
    selectedVisEventIds: [],
    status: `Opened ${project.name}`,
    error: null,
    playing: false,
    shuttleRate: 0,
    savedPastLength: 0,
    savedFutureLength: 0,
    volumeWriteArmedIds: [],
    volumeWriteGesture: null,
    projectRevision: projectRevisionOf(session) + 1,
  };
}

export async function hydrateSession(session: Session, readSource?: SourcePathReader): Promise<Session> {
  const project = await hydrateProject(session.project, session.store, readSource);
  const missing = project.assets.filter((a) => a.missing);
  return {
    ...session,
    project,
    status: missing.length ? `${missing.length} media file(s) missing` : session.status,
    error: missing.length ? missing.map((a) => `missing:${a.name}`).join(" · ") : session.error,
  };
}

export function projectJson(session: Session): string {
  return serializeProject(session.project);
}

export function defaultTrackHint(kind: MediaKind): TrackId {
  return defaultTrackForKind(kind);
}
