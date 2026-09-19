import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { assetById, clipById, type TrackId } from "../core/models";
import { canAddAudioTrack, canRemoveAudioTrack } from "../core/audio-tracks";
import { MEDIA_FILE_ACCEPT, preferredTrackForAsset } from "../core/media";
import { advancePlayhead } from "../core/playback";
import { collectSnapTargets, moveInOut, setInPoint, setOutPoint, snapPlayheadSeek, snapTime } from "../core/timeline";
import { downloadText, projectFilename, windowTitleFor } from "../core/project";
import { createIndexedDbProjectFileStore } from "../core/project-file-store";
import { lastProjectMissingStatus } from "../core/last-project";
import { isTauriRuntime } from "../core/tauri-runtime";
import {
  allowMediaSourcePaths,
  autostartLastProject,
  createPluginTauriProjectFs,
  pickTauriMediaFiles,
  sourcePathsOfAssets,
  tauriOpenProject,
  tauriSaveProject,
  tryReadSourcePathBlob,
  type TauriProjectFs,
} from "../core/tauri-project-io";
import {
  browserPickerHost,
  emptyProjectFileMemory,
  lastLoadedStatus,
  loadStatusFallback,
  pickRelinkMediaFile,
  readFileText,
  relinkAcceptAttr,
  rememberFileHandle,
  rememberTauriProjectPath,
  runOpen,
  runOpenRecent,
  runSave,
  runSaveAs,
  tryReadGrantedFile,
  type ProjectFileMemory,
  type RecentProject,
} from "../core/project-file";
import {
  abortExportDialog,
  applyExportProgress,
  closeExportDialog,
  closedExportDialog,
  downloadMp4,
  downloadWav,
  exportMixWav,
  exportTimeline,
  failExportDialog,
  isExportSuccess,
  existingExportNamesFromMemory,
  jobFromProject,
  nextVersionedFileName,
  openExportDialog,
  readyExportDialog,
  readyExportNameFromProjectAsync,
  runExportWithDestination,
  succeedExportDialog,
  wavFileName,
  ExportPlanError,
  exportResultFromCaughtThrow,
} from "../core/exporter";
import { wavExportPickerOptions } from "../core/project-file";
import { MediaBrowser } from "../ui/media-browser/MediaBrowser";
import { Preview } from "../ui/preview/Preview";
import { Inspector } from "../ui/inspector/Inspector";
import { DirectorPanel } from "../ui/director/DirectorPanel";
import { isDirectorEnabled, persistDirectorEnabled } from "./ai/flag";
import { Transport } from "../ui/transport/Transport";
import { Timeline } from "../ui/timeline/Timeline";
import { Mixer, type MixPeaks } from "../ui/mixer/Mixer";
import { ProjectFilePanel } from "../ui/project-file/ProjectFilePanel";
import { Toolbar } from "../ui/toolbar/Toolbar";
import { ShortcutsOverlay } from "../ui/shortcuts/ShortcutsOverlay";
import { ExportDialog } from "../ui/export/ExportDialog";
import {
  applyFit,
  applyInAt,
  applyOutAt,
  applyPlaceAsset,
  applyPlayhead,
  applyScroll,
  applySelect,
  applySelectMarker,
  selectionOf,
  applyDeleteMarker,
  applyMoveMarker,
  applyToggleLoop,
  applyMasterVolume,
  applyMixerVolume,
  applyCommitVolumeWriteIfIdle,
  previewMoveVolumeAutomationPoint,
  applyToggleVisualizerMute,
  applyCycleVisualizerScene,
  applySelectTracks,
  applySelectVis,
  applyPickVisualizerScene,
  applySetVisualizer,
  applyToggleFollow,
  applyToggleSnap,
  applyTimelineViewport,
  applyUpdateClip,
  applyZoom,
  createSession,
  hydrateSession,
  importFiles,
  ingestRelinkFile,
  beforeUnloadIfDirty,
  confirmNewProject,
  confirmOpenProject,
  isProjectDirty,
  markProjectClean,
  withClipSelection,
  openSerialized,
  projectJson,
  type Session,
} from "./session";
import { applyCommand, type EditorCommand } from "./commands";
import { WRITE_IDLE_END_MS, WRITE_POINTER_UP_MS } from "../core/volume-write";
import { dispatchEditorKey, isTransportSpaceKey } from "./keys";
import {
  cycleProductionScreen,
  editorFormFocus,
  editorTextEditFocus,
  tracksForScreen,
  type ProductionScreen,
} from "./screens";
import { relinkSelectionForAsset, relinkSelectionOf } from "../core/relink";
import { Cutter } from "../ui/cutter/Cutter";
import {
  DEFAULT_DIRECTOR_SPLIT_RATIO,
  DEFAULT_H_SPLIT_RATIO,
  DIRECTOR_SPLITTER_PX,
  H_SPLITTER_PX,
  INSPECTOR_COLLAPSED_PX,
  INSPECTOR_MAX_PX,
  INSPECTOR_MIN_PX,
  PREVIEW_H_MIN_PX,
  SPLITTER_PX,
  applyDirectorFocusToggle,
  applyDirectorSplitPointer,
  applyFocusHSplitPointer,
  applyHSplitPointer,
  applyMixerWidthPointer,
  applySplitPointer,
  applyTimelineFocusToggle,
  browserLayoutStorage,
  clampDirectorSplitRatio,
  clampFocusHSplitRatio,
  clampHSplitRatio,
  clampSplitRatio,
  isMeasuredStageHeight,
  legalSplitMins,
  normalizePersistedSplitRatio,
  TRANSPORT_MIN_PX,
  directorPresentationOf,
  DEFAULT_DIRECTOR_FOCUS_H_SPLIT,
  loadCollapsedGroupIds,
  loadDirectorFocus,
  loadDirectorFocusHSplitRatio,
  loadDirectorNormalSplitRatio,
  loadDirectorSplitRatio,
  loadInspectorSectionCollapsed,
  loadOpenVolumeLaneIds,
  loadHSplitRatio,
  loadInspectorCollapsed,
  loadLaneHeights,
  loadLaneLabelPx,
  loadMixerCollapsed,
  loadMixerWidth,
  loadNormalSplitRatio,
  loadSplitRatio,
  loadTimelineFocus,
  saveCollapsedGroupIds,
  saveOpenVolumeLaneIds,
  saveDirectorFocus,
  saveDirectorFocusHSplitRatio,
  saveDirectorNormalSplitRatio,
  saveDirectorPresentation,
  saveDirectorSplitRatio,
  saveHSplitRatio,
  saveInspectorCollapsed,
  saveInspectorSectionCollapsed,
  saveLaneHeights,
  saveLaneLabelPx,
  saveMixerCollapsed,
  saveMixerWidth,
  saveNormalSplitRatio,
  saveSplitRatio,
  saveTimelineFocus,
  shouldAutoCompactMixer,
  mixerChromeOf,
  toggleCollapsedGroupId,
  toggleOpenVolumeLaneId,
  TIMELINE_MIN_PX,
  type LaneHeightGroup,
  type LaneHeights,
} from "../core/layout-prefs";

export function App() {
  const [session, setSession] = useState<Session>(() => createSession());
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const saveProjectRef = useRef<() => void>(() => {});
  const saveProjectAsRef = useRef<() => void>(() => {});
  const dragBaseRef = useRef<Session | null>(null);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportDialog, setExportDialog] = useState(closedExportDialog);
  const exportAbortRef = useRef<AbortController | null>(null);
  const exportBusyRef = useRef(false);
  const [mixPeaks, setMixPeaks] = useState<MixPeaks>({
    V1: 0,
    V2: 0,
    A1: 0,
    A2: 0,
    master: 0,
  });
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const shortcutsOpenRef = useRef(false);
  shortcutsOpenRef.current = shortcutsOpen;
  const layoutStore = browserLayoutStorage();
  const [mixerCollapsed, setMixerCollapsed] = useState(() => loadMixerCollapsed(layoutStore));
  const [mixerAutoCompact, setMixerAutoCompact] = useState(false);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(() => loadInspectorCollapsed(layoutStore));
  const [inspectorSectionCollapsed, setInspectorSectionCollapsed] = useState(() =>
    loadInspectorSectionCollapsed(layoutStore),
  );
  const [directorEnabled, setDirectorEnabled] = useState(() => isDirectorEnabled());
  const [directorFocus, setDirectorFocus] = useState(() => loadDirectorFocus(layoutStore));
  const [directorSplitRatio, setDirectorSplitRatio] = useState(() => loadDirectorSplitRatio(layoutStore));
  const [directorNormalSplit, setDirectorNormalSplit] = useState(() =>
    loadDirectorNormalSplitRatio(layoutStore),
  );
  const [directorFocusRestoreCollapsed, setDirectorFocusRestoreCollapsed] = useState(() =>
    loadInspectorSectionCollapsed(layoutStore),
  );
  const [collapsedGroupIds, setCollapsedGroupIds] = useState(() => loadCollapsedGroupIds(layoutStore));
  const [openVolumeLaneIds, setOpenVolumeLaneIds] = useState(() => loadOpenVolumeLaneIds(layoutStore));
  const [mixerWidthPx, setMixerWidthPx] = useState(() => loadMixerWidth(layoutStore));
  const mixerWidthRef = useRef(mixerWidthPx);
  mixerWidthRef.current = mixerWidthPx;
  const mixerResizeDragRef = useRef(false);
  const arrangeRowRef = useRef<HTMLDivElement>(null);
  const [timelineFocus, setTimelineFocus] = useState(() => loadTimelineFocus(layoutStore));
  const [normalSplitRatio, setNormalSplitRatio] = useState(() => loadNormalSplitRatio(layoutStore));
  const [stageAvailPx, setStageAvailPx] = useState(0);
  const [splitRatio, setSplitRatio] = useState(() => {
    if (!loadTimelineFocus(layoutStore)) return loadSplitRatio(layoutStore);
    return applyTimelineFocusToggle({
      currentlyFocused: false,
      currentRatio: loadNormalSplitRatio(layoutStore),
      storedNormalRatio: loadNormalSplitRatio(layoutStore),
    }).liveRatio;
  });
  const splitRatioRef = useRef(splitRatio);
  splitRatioRef.current = splitRatio;
  const stageAvailPxRef = useRef(stageAvailPx);
  stageAvailPxRef.current = stageAvailPx;
  const normalSplitRatioRef = useRef(normalSplitRatio);
  normalSplitRatioRef.current = normalSplitRatio;
  const timelineFocusRef = useRef(timelineFocus);
  timelineFocusRef.current = timelineFocus;
  const [hSplitRatio, setHSplitRatio] = useState(() => {
    if (loadDirectorFocus(layoutStore) && isDirectorEnabled()) {
      return loadDirectorFocusHSplitRatio(layoutStore);
    }
    return loadHSplitRatio(layoutStore);
  });
  const hSplitRatioRef = useRef(hSplitRatio);
  hSplitRatioRef.current = hSplitRatio;
  const [directorFocusHSplit, setDirectorFocusHSplit] = useState(() =>
    loadDirectorFocusHSplitRatio(layoutStore),
  );
  const directorFocusHSplitRef = useRef(directorFocusHSplit);
  directorFocusHSplitRef.current = directorFocusHSplit;
  const [directorDockedHSplit, setDirectorDockedHSplit] = useState(() => loadHSplitRatio(layoutStore));
  const directorDockedHSplitRef = useRef(directorDockedHSplit);
  directorDockedHSplitRef.current = directorDockedHSplit;
  const [laneLabelPx, setLaneLabelPx] = useState(() => loadLaneLabelPx(layoutStore));
  const [laneHeights, setLaneHeights] = useState<LaneHeights>(() => loadLaneHeights(layoutStore));
  const [screen, setScreen] = useState<ProductionScreen>("arrange");
  const [projectPanelOpen, setProjectPanelOpen] = useState(false);
  const projectPanelOpenRef = useRef(false);
  projectPanelOpenRef.current = projectPanelOpen;
  const stageRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const inspectorBodyRef = useRef<HTMLDivElement>(null);
  const directorSplitRatioRef = useRef(directorSplitRatio);
  directorSplitRatioRef.current = directorSplitRatio;
  const directorSplitDragRef = useRef(false);
  const relinkInputRef = useRef<HTMLInputElement>(null);
  const splitDragRef = useRef(false);
  const hSplitDragRef = useRef(false);
  const [projectFile, setProjectFile] = useState<ProjectFileMemory>(emptyProjectFileMemory);
  const projectFileRef = useRef(projectFile);
  projectFileRef.current = projectFile;
  const projectFileStore = useRef(createIndexedDbProjectFileStore()).current;
  const pickerHost = browserPickerHost();
  const lastTs = useRef<number | null>(null);
  const lastPathRef = useRef<string | null>(null);
  const tauriFsRef = useRef<Promise<TauriProjectFs> | null>(null);
  const tauriFs = () => {
    if (!tauriFsRef.current) tauriFsRef.current = createPluginTauriProjectFs();
    return tauriFsRef.current;
  };
  const hydrateRuntime = (s: typeof session) =>
    isTauriRuntime() ? hydrateSession(s, tryReadSourcePathBlob) : hydrateSession(s);

  useEffect(() => {
    document.title = windowTitleFor(session.project.name);
  }, [session.project.name]);

  useEffect(() => {
    void (async () => {
      const hydrated = await hydrateRuntime(sessionRef.current);
      if (isTauriRuntime()) {
        try {
          const boot = await autostartLastProject(await tauriFs());
          if (boot.kind === "loaded") {
            try {
              const opened = openSerialized(hydrated, boot.text);
              await allowMediaSourcePaths(sourcePathsOfAssets(opened.project.assets));
              const next = await hydrateRuntime(opened);
              lastPathRef.current = boot.ref.path;
              setProjectFile(rememberTauriProjectPath(boot.ref.path, boot.ref.name));
              setSession({ ...next, status: `Geladen: ${boot.ref.name}` });
              return;
            } catch {
              setSession({ ...hydrated, status: lastProjectMissingStatus(boot.ref.name) });
              return;
            }
          }
          if (boot.kind === "missing") {
            setSession({ ...hydrated, status: boot.status });
            return;
          }
        } catch {
          /* keep hydrated empty project */
        }
        setSession(hydrated);
        return;
      }
      const memory = await projectFileStore.load();
      setProjectFile(memory);
      const last = await tryReadGrantedFile(memory);
      if (last?.kind === "ready") {
        try {
          const opened = openSerialized(hydrated, last.text);
          const next = await hydrateRuntime(opened);
          setSession({ ...next, status: `Geladen: ${last.fileName}` });
          return;
        } catch {
          setSession({ ...hydrated, status: lastLoadedStatus(last.fileName) });
          return;
        }
      }
      if (last?.kind === "needsOpen") {
        setSession({ ...hydrated, status: lastLoadedStatus(last.fileName) });
        return;
      }
      setSession(hydrated);
    })();
    // hydrate once on boot
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runCommand = useCallback((command: EditorCommand) => {
    setSession((s) => applyCommand(s, command));
  }, []);

  const onTimelineViewport = useCallback(
    (widthPx: number) => {
      setSession((s) => applyTimelineViewport(s, widthPx, laneLabelPx));
    },
    [laneLabelPx],
  );

  const relinkClipIdsRef = useRef<string[] | null>(null);

  const finishRelink = useCallback(async (file: File) => {
    const s = sessionRef.current;
    const clipIds = relinkClipIdsRef.current ?? selectionOf(s);
    const sel = relinkSelectionOf(s.project, clipIds);
    if (!sel) return;
    const ingested = await ingestRelinkFile(s, file, sel.kind);
    if ("error" in ingested) {
      setSession({ ...s, error: ingested.error, status: "Relink failed" });
      return;
    }
    setSession(
      applyCommand(ingested.session, {
        type: "relinkClips",
        clipIds: sel.clipIds,
        assetId: ingested.assetId,
      }),
    );
  }, []);

  const runRelink = useCallback(async (clipIds?: readonly string[]) => {
    const s = sessionRef.current;
    const ids = clipIds?.length ? [...clipIds] : selectionOf(s);
    const sel = relinkSelectionOf(s.project, ids);
    if (!sel) return;
    relinkClipIdsRef.current = sel.clipIds;
    if (clipIds?.length) {
      setSession(withClipSelection(s, sel.clipIds));
    }
    if (isTauriRuntime()) {
      try {
        const files = await pickTauriMediaFiles({ kind: sel.kind });
        if (files?.[0]) await finishRelink(files[0]);
      } catch (e) {
        setSession({
          ...s,
          error: e instanceof Error ? e.message : String(e),
          status: "Relink failed",
        });
      }
      return;
    }
    const picked = await pickRelinkMediaFile({
      host: pickerHost,
      memory: projectFileRef.current,
      kind: sel.kind,
    });
    if (picked.kind === "cancelled") return;
    if (picked.kind === "picked") {
      await finishRelink(picked.file);
      return;
    }
    const input = relinkInputRef.current;
    if (!input) return;
    input.accept = relinkAcceptAttr(sel.kind);
    input.value = "";
    input.click();
  }, [finishRelink, pickerHost]);

  const runRelinkAsset = useCallback(
    (assetId: string) => {
      const sel = relinkSelectionForAsset(sessionRef.current.project, assetId);
      if (!sel) return;
      void runRelink(sel.clipIds);
    },
    [runRelink],
  );
  const play = useCallback(() => {
    runCommand({ type: "play" });
  }, [runCommand]);
  const pause = useCallback(() => {
    runCommand({ type: "pause" });
  }, [runCommand]);
  const stop = useCallback(() => {
    runCommand({ type: "stop" });
  }, [runCommand]);

  useEffect(() => {
    if (!session.playing && session.shuttleRate === 0) {
      lastTs.current = null;
      return;
    }
    let raf = 0;
    const tick = (now: number) => {
      const prev = lastTs.current ?? now;
      lastTs.current = now;
      const delta = now - prev;
      setSession((s) => {
        const rate = s.shuttleRate;
        if (rate === 0 && !s.playing) return s;
        const stepped = advancePlayhead(s.project, delta * (rate === 0 ? 1 : rate));
        if (stepped.stopped) {
          return applyCommand(applyPlayhead(s, stepped.playheadMs, "transport"), { type: "pause" });
        }
        return applyPlayhead(s, stepped.playheadMs, "transport");
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [session.playing, session.shuttleRate]);

  const writeGestureOpen = session.volumeWriteGesture != null;
  useEffect(() => {
    if (!writeGestureOpen) return;
    const id = window.setInterval(() => {
      setSession((s) => applyCommitVolumeWriteIfIdle(s, Date.now(), WRITE_IDLE_END_MS));
    }, 50);
    return () => window.clearInterval(id);
  }, [writeGestureOpen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && projectPanelOpenRef.current) {
        e.preventDefault();
        setProjectPanelOpen(false);
        return;
      }
      if (e.key === "Escape" && shortcutsOpenRef.current) {
        e.preventDefault();
        setShortcutsOpen(false);
        return;
      }
      const formFocus = editorFormFocus(e.target);
      const textEditFocus = editorTextEditFocus(e.target);
      const chord = (e.ctrlKey || e.metaKey) && e.key.length === 1 && e.key.toLowerCase() === "s";
      if (formFocus && e.key !== "Tab" && !chord) {
        if (!isTransportSpaceKey(e) || textEditFocus) return;
      }
      const s = sessionRef.current;
      const action = dispatchEditorKey(s, s.playing, {
        key: e.key,
        code: e.code,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        formFocus,
        textEditFocus,
      });
      if (action.type === "none") return;
      if ("preventDefault" in action && action.preventDefault) e.preventDefault();
      if (action.type === "toggleShortcuts") {
        setShortcutsOpen((open) => !open);
        return;
      }
      if (action.type === "cycleScreen") {
        setScreen((cur) => cycleProductionScreen(cur, action.dir));
        return;
      }
      if (action.type === "save") {
        saveProjectRef.current();
        return;
      }
      if (action.type === "saveAs") {
        saveProjectAsRef.current();
        return;
      }
      setSession(action.session);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      beforeUnloadIfDirty(sessionRef.current, e);
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  const applyOpenedText = async (text: string, status: string): Promise<boolean> => {
    if (!confirmOpenProject(sessionRef.current)) return false;
    const opened = openSerialized(sessionRef.current, text);
    await allowMediaSourcePaths(sourcePathsOfAssets(opened.project.assets));
    const hydrated = await hydrateRuntime(opened);
    setSession({ ...hydrated, status, error: null });
    return true;
  };

  const persistSave = (mode: "save" | "saveAs") => {
    const snapshot = sessionRef.current;
    const applySaved = (result: {
      status: string;
      memory?: ProjectFileMemory;
      usedFallback?: boolean;
      cancelled?: boolean;
      path?: string;
      name?: string;
    }) => {
      if (result.cancelled) return;
      if (result.path) lastPathRef.current = result.path;
      if (result.memory) setProjectFile(result.memory);
      else if (result.path) {
        setProjectFile(rememberTauriProjectPath(result.path, result.name));
      } else if (result.name) {
        setProjectFile({ ...emptyProjectFileMemory(), lastFileName: result.name });
      }
      if (!result.usedFallback) setProjectPanelOpen(false);
      setSession((s) => {
        const sameStack =
          s.history.past.length === snapshot.history.past.length &&
          s.history.future.length === snapshot.history.future.length;
        const next = sameStack ? markProjectClean(s) : s;
        return { ...next, status: result.status, error: null };
      });
    };
    const fail = (e: unknown) => {
      setSession((s) => ({
        ...s,
        error: e instanceof Error ? e.message : String(e),
        status: "Save failed",
      }));
    };
    if (isTauriRuntime()) {
      void (async () => {
        try {
          const result = await tauriSaveProject(await tauriFs(), {
            json: projectJson(snapshot),
            filename: projectFilename(snapshot.project),
            lastPath: lastPathRef.current ?? projectFileRef.current.lastPath,
            forcePicker: mode === "saveAs",
          });
          if ("cancelled" in result) return;
          applySaved({ status: result.status, path: result.path, name: result.name });
        } catch (e) {
          fail(e);
        }
      })();
      return;
    }
    // Resolve window.showSaveFilePicker on this click (not a render-time snapshot).
    // First await inside runSaveAs is the picker so the user gesture stays valid.
    const payload = {
      host: browserPickerHost(),
      store: projectFileStore,
      memory: projectFileRef.current,
      filename: projectFilename(snapshot.project),
      json: projectJson(snapshot),
      fallbackDownload: downloadText,
    };
    void (mode === "saveAs" ? runSaveAs(payload) : runSave(payload)).then(applySaved).catch(fail);
  };

  const saveProject = () => persistSave("save");
  const saveProjectAs = () => persistSave("saveAs");
  saveProjectRef.current = saveProject;
  saveProjectAsRef.current = saveProjectAs;

  const openWithPicker = () => {
    void (async () => {
      try {
        if (isTauriRuntime()) {
          const result = await tauriOpenProject(await tauriFs());
          if ("cancelled" in result) return;
          if (!(await applyOpenedText(result.text, result.status))) return;
          lastPathRef.current = result.path;
          setProjectFile(rememberTauriProjectPath(result.path, result.name));
          setProjectPanelOpen(false);
          return;
        }
        const result = await runOpen({
          host: pickerHost,
          store: projectFileStore,
          memory: projectFileRef.current,
        });
        if (result.kind === "cancelled") return;
        if (result.kind === "fallback") {
          document.querySelector<HTMLInputElement>("[data-testid=open-input]")?.click();
          return;
        }
        if (!(await applyOpenedText(result.text, result.status))) return;
        setProjectFile(result.memory);
        setProjectPanelOpen(false);
      } catch (e) {
        setSession((s) => ({
          ...s,
          error: e instanceof Error ? e.message : String(e),
          status: "Open failed",
        }));
      }
    })();
  };

  const openLast = () => {
    void (async () => {
      if (isTauriRuntime()) {
        const boot = await autostartLastProject(await tauriFs());
        if (boot.kind === "loaded") {
          if (!(await applyOpenedText(boot.text, `Geladen: ${boot.ref.name}`))) return;
          lastPathRef.current = boot.ref.path;
          setProjectFile(rememberTauriProjectPath(boot.ref.path, boot.ref.name));
          setProjectPanelOpen(false);
          return;
        }
        if (boot.kind === "missing") {
          setSession((s) => ({ ...s, status: boot.status, error: null }));
          return;
        }
        openWithPicker();
        return;
      }
      const last = await tryReadGrantedFile(projectFileRef.current);
      if (last?.kind === "ready") {
        if (!(await applyOpenedText(last.text, `Geladen: ${last.fileName}`))) return;
        setProjectPanelOpen(false);
        return;
      }
      const handle = projectFileRef.current.fileHandle;
      if (handle?.requestPermission) {
        const perm = await handle.requestPermission({ mode: "read" });
        if (perm === "granted" && handle.getFile) {
          const file = await handle.getFile();
          const memory = await rememberFileHandle(projectFileStore, handle, projectFileRef.current);
          const text = await readFileText(file);
          if (!(await applyOpenedText(text, `Geladen: ${file.name}`))) return;
          setProjectFile(memory);
          setProjectPanelOpen(false);
          return;
        }
      }
      openWithPicker();
    })();
  };

  const openRecent = (recent: RecentProject) => {
    void (async () => {
      try {
        const result = await runOpenRecent({
          store: projectFileStore,
          memory: projectFileRef.current,
          recent,
        });
        if (result.kind === "opened") {
          if (!(await applyOpenedText(result.text, result.status))) return;
          setProjectFile(result.memory);
          setProjectPanelOpen(false);
          return;
        }
        openWithPicker();
      } catch (e) {
        setSession((s) => ({
          ...s,
          error: e instanceof Error ? e.message : String(e),
          status: "Open failed",
        }));
      }
    })();
  };

  const openProject = async (file: File) => {
    try {
      const text = await readFileText(file);
      if (!(await applyOpenedText(text, loadStatusFallback(file.name)))) return;
      setProjectPanelOpen(false);
    } catch (e) {
      setSession((s) => ({
        ...s,
        error: e instanceof Error ? e.message : String(e),
        status: "Open failed",
      }));
    }
  };

  const cancelExport = () => {
    exportAbortRef.current?.abort();
    setExportDialog((d) => (d.phase === "running" ? closeExportDialog() : abortExportDialog(d)));
    setExporting(false);
    setSession((s) => ({ ...s, status: "Export cancelled", error: null }));
  };

  const dismissExport = () => {
    if (exportDialog.phase === "running") {
      cancelExport();
      return;
    }
    setExportDialog(closeExportDialog());
  };

  const runExport = () => {
    if (exporting || exportBusyRef.current) return;
    if (exportDialog.phase === "ready") return;
    const width = exportDialog.width || 1280;
    const height = exportDialog.height || 720;
    const fps = exportDialog.fps || 30;
    void (async () => {
      const fileName = await readyExportNameFromProjectAsync({
        projectName: session.project.name,
        memory: projectFileRef.current,
      });
      setExportDialog(readyExportDialog({ fileName, width, height, fps }));
    })();
  };

  const startExport = (kind: "mp4" | "wav") => {
    if (exporting || exportBusyRef.current) return;
    const size = {
      width: exportDialog.width || 1280,
      height: exportDialog.height || 720,
      fps: exportDialog.fps || 30,
    };
    let planned;
    try {
      planned = jobFromProject(session.project, kind === "wav" ? {} : size);
      const fromDialog =
        exportDialog.phase === "ready" && exportDialog.fileName
          ? exportDialog.fileName
          : planned.fileName;
      const proposed = kind === "wav" ? wavFileName(fromDialog) : fromDialog;
      planned = {
        ...planned,
        fileName: nextVersionedFileName(proposed, existingExportNamesFromMemory(projectFileRef.current)),
      };
    } catch (e) {
      const msg = e instanceof ExportPlanError || e instanceof Error ? e.message : String(e);
      const fallbackName = kind === "wav" ? "export.wav" : "export.mp4";
      const base =
        exportDialog.phase === "ready"
          ? exportDialog
          : openExportDialog({ fileName: fallbackName, ...size });
      setExportDialog(failExportDialog(base, `FAIL: ${msg}`));
      setSession((s) => ({ ...s, error: `FAIL: ${msg}`, status: "Export failed" }));
      return;
    }
    exportBusyRef.current = true;
    void (async () => {
      const ac = new AbortController();
      try {
        const outcome = await runExportWithDestination({
          job: planned,
          host: pickerHost,
          store: projectFileStore,
          memory: projectFileRef.current,
          encode: kind === "wav" ? exportMixWav : exportTimeline,
          downloadMp4: kind === "wav" ? downloadWav : downloadMp4,
          pickerOptions: kind === "wav" ? wavExportPickerOptions : undefined,
          signal: ac.signal,
          onBeforeEncode: (job) => {
            exportAbortRef.current = ac;
            setExportDialog(openExportDialog(job));
            setExporting(true);
          },
          onProgress: (p) => {
            setExportDialog((d) => applyExportProgress(d, p));
            setSession((s) => ({ ...s, status: `Export ${p.percent}% ${p.stage}` }));
          },
        });
        if (outcome.kind === "cancelled") return;
        setProjectFile(outcome.memory);
        if (ac.signal.aborted || outcome.result.aborted) {
          setExportDialog(closeExportDialog());
          setSession((s) => ({ ...s, status: "Export cancelled", error: null }));
          return;
        }
        if (!isExportSuccess(outcome.result)) {
          setExportDialog((d) => failExportDialog(d, outcome.result.error ?? "Export failed"));
          setSession((s) => ({
            ...s,
            error: outcome.result.error ?? "Export failed",
            status: "Export failed",
          }));
          return;
        }
        setExportDialog((d) => succeedExportDialog(d, outcome.job.fileName));
        setSession((s) => ({
          ...s,
          error: null,
          status: outcome.status,
        }));
      } catch (e) {
        if (ac.signal.aborted) {
          setExportDialog(closeExportDialog());
          setSession((s) => ({ ...s, status: "Export cancelled", error: null }));
          return;
        }
        const dump = exportResultFromCaughtThrow(planned, e).error ?? String(e);
        setExportDialog((d) => failExportDialog(d, dump));
        setSession((s) => ({ ...s, error: dump, status: "Export failed" }));
      } finally {
        setExporting(false);
        exportBusyRef.current = false;
        if (exportAbortRef.current === ac) exportAbortRef.current = null;
      }
    })();
  };

  const onMoveLive = (clipId: string, startMs: number, trackId?: TrackId, clipIds?: string[]) => {
    setSession((s) => {
      if (!dragBaseRef.current) dragBaseRef.current = s;
      const base = dragBaseRef.current;
      const ids =
        clipIds?.length
          ? clipIds
          : selectionOf(base).includes(clipId)
            ? selectionOf(base)
            : [clipId];
      const leader = clipById(base.project, clipId);
      if (!leader) return s;
      let nextStart = startMs;
      if (base.project.snap) {
        nextStart = snapTime(startMs, collectSnapTargets(base.project, ids)).timeMs;
      }
      const preview = applyCommand(
        { ...base, history: { past: [], future: [] } },
        {
          type: "moveClips",
          clipIds: ids,
          deltaMs: nextStart - leader.startMs,
          trackId: ids.length === 1 ? trackId : undefined,
        },
      );
      return {
        ...s,
        project: preview.project,
        selectedClipId: ids[0] ?? clipId,
        selectedClipIds: ids,
        error: preview.error,
        status: preview.status,
      };
    });
  };

  const onMoveCommit = () => {
    const base = dragBaseRef.current;
    dragBaseRef.current = null;
    if (!base) return;
    setSession((s) => ({
      ...s,
      history: { past: [...base.history.past, structuredClone(base.project)], future: [] },
      projectRevision: (s.projectRevision ?? 0) + 1,
      status: selectionOf(s).length > 1 ? "Moved clips" : "Moved clip",
      error: null,
    }));
  };

  const onVisEventMoveLive = (eventId: string, startMs: number) => {
    setSession((s) => {
      if (!dragBaseRef.current) dragBaseRef.current = s;
      const base = dragBaseRef.current;
      const preview = applyCommand(
        { ...base, history: { past: [], future: [] } },
        { type: "moveVisEvent", eventId, startMs },
      );
      return {
        ...s,
        project: preview.project,
        selectedVis: true,
        selectedVisEventId: eventId,
        selectedClipId: null,
        selectedClipIds: [],
        status: preview.status,
        error: preview.error,
      };
    });
  };

  const onVisEventMoveCommit = () => {
    const base = dragBaseRef.current;
    dragBaseRef.current = null;
    if (!base) return;
    setSession((s) => ({
      ...s,
      history: { past: [...base.history.past, structuredClone(base.project)], future: [] },
      status: "Moved VIS event",
      error: null,
    }));
  };

  const onVisEventStretchLive = (eventId: string, edge: "in" | "out", nextEdgeMs: number) => {
    setSession((s) => {
      if (!dragBaseRef.current) dragBaseRef.current = s;
      const base = dragBaseRef.current;
      const preview = applyCommand(
        { ...base, history: { past: [], future: [] } },
        { type: "stretchVisEvent", eventId, edge, nextEdgeMs },
      );
      return {
        ...s,
        project: preview.project,
        selectedVis: true,
        selectedVisEventId: eventId,
        selectedClipId: null,
        selectedClipIds: [],
        status: preview.status,
        error: preview.error,
      };
    });
  };

  const onVisEventStretchCommit = () => {
    const base = dragBaseRef.current;
    dragBaseRef.current = null;
    if (!base) return;
    setSession((s) => ({
      ...s,
      history: { past: [...base.history.past, structuredClone(base.project)], future: [] },
      status: "Stretched VIS event",
      error: null,
    }));
  };

  const onMarkerMoveLive = (markerId: string, timeMs: number) => {
    setSession((s) => {
      if (!dragBaseRef.current) dragBaseRef.current = s;
      return applyMoveMarker(s, markerId, timeMs);
    });
  };

  const onMarkerMoveCommit = () => {
    const base = dragBaseRef.current;
    dragBaseRef.current = null;
    if (!base) return;
    setSession((s) => ({
      ...s,
      history: { past: [...base.history.past, structuredClone(base.project)], future: [] },
      status: "Moved marker",
      error: null,
    }));
  };

  const onTrimLive = (
    clipId: string,
    edge: "in" | "out",
    nextEdgeMs: number,
    mode: "lift" | "ripple" | "roll" = "lift",
  ) => {
    setSession((s) => {
      if (!dragBaseRef.current) dragBaseRef.current = s;
      const type =
        mode === "ripple" ? "rippleTrim" : mode === "roll" ? "rollEdit" : "liftTrim";
      const preview = applyCommand(
        { ...dragBaseRef.current, history: { past: [], future: [] } },
        { type, clipId, edge, nextEdgeMs },
      );
      return {
        ...s,
        project: preview.project,
        selectedClipId: clipId,
        selectedClipIds: [clipId],
        error: preview.error,
        status: preview.status,
      };
    });
  };

  const onSlipLive = (clipId: string, deltaMs: number, clipIds?: readonly string[]) => {
    setSession((s) => {
      if (!dragBaseRef.current) dragBaseRef.current = s;
      const preview = applyCommand(
        { ...dragBaseRef.current, history: { past: [], future: [] } },
        { type: "slip", clipId, deltaMs, clipIds },
      );
      return {
        ...s,
        project: preview.project,
        error: preview.error,
        status: preview.status,
      };
    });
  };

  const onSlipCommit = () => {
    const base = dragBaseRef.current;
    dragBaseRef.current = null;
    if (!base) return;
    setSession((s) => ({
      ...s,
      history: { past: [...base.history.past, structuredClone(base.project)], future: [] },
      status: selectionOf(s).length > 1 ? "Slipped clips" : "Slipped clip",
      error: null,
    }));
  };

  const onSlideLive = (clipId: string, deltaMs: number, clipIds?: readonly string[]) => {
    setSession((s) => {
      if (!dragBaseRef.current) dragBaseRef.current = s;
      const preview = applyCommand(
        { ...dragBaseRef.current, history: { past: [], future: [] } },
        { type: "slideClip", clipId, deltaMs, clipIds },
      );
      return {
        ...s,
        project: preview.project,
        error: preview.error,
        status: preview.status,
      };
    });
  };

  const onSlideCommit = () => {
    const base = dragBaseRef.current;
    dragBaseRef.current = null;
    if (!base) return;
    setSession((s) => ({
      ...s,
      history: { past: [...base.history.past, structuredClone(base.project)], future: [] },
      status: selectionOf(s).length > 1 ? "Slid clips" : "Slid clip",
      error: null,
    }));
  };

  const onTrimCommit = () => {
    const base = dragBaseRef.current;
    dragBaseRef.current = null;
    if (!base) return;
    setSession((s) => ({
      ...s,
      history: { past: [...base.history.past, structuredClone(base.project)], future: [] },
      error: null,
    }));
  };

  const onFadesLive = (clipId: string, fadeInMs: number, fadeOutMs: number) => {
    setSession((s) => {
      if (!dragBaseRef.current) dragBaseRef.current = s;
      const preview = applyCommand(
        { ...dragBaseRef.current, history: { past: [], future: [] } },
        { type: "setClipFades", clipId, fadeInMs, fadeOutMs },
      );
      return {
        ...s,
        project: preview.project,
        selectedClipId: clipId,
        selectedClipIds: [clipId],
        error: preview.error,
        status: preview.status,
      };
    });
  };

  const onFadesCommit = () => {
    const base = dragBaseRef.current;
    dragBaseRef.current = null;
    if (!base) return;
    setSession((s) => ({
      ...s,
      history: { past: [...base.history.past, structuredClone(base.project)], future: [] },
      status: "Clip fades",
      error: null,
    }));
  };

  const onTransitionDurationLive = (durationMs: number, clipIds: readonly string[]) => {
    setSession((s) => {
      if (!dragBaseRef.current) dragBaseRef.current = s;
      const preview = applyCommand(
        {
          ...dragBaseRef.current,
          history: { past: [], future: [] },
          selectedClipIds: [...clipIds],
          selectedClipId: clipIds[0] ?? null,
        },
        { type: "setTransition", durationMs },
      );
      return {
        ...s,
        project: preview.project,
        selectedClipId: clipIds[0] ?? s.selectedClipId,
        selectedClipIds: [...clipIds],
        error: preview.error,
        status: preview.status,
      };
    });
  };

  const onTransitionAudioDurationLive = (audioDurationMs: number, clipIds: readonly string[]) => {
    setSession((s) => {
      if (!dragBaseRef.current) dragBaseRef.current = s;
      const preview = applyCommand(
        {
          ...dragBaseRef.current,
          history: { past: [], future: [] },
          selectedClipIds: [...clipIds],
          selectedClipId: clipIds[0] ?? null,
        },
        { type: "setTransitionAudioDuration", audioDurationMs },
      );
      return {
        ...s,
        project: preview.project,
        selectedClipId: clipIds[0] ?? s.selectedClipId,
        selectedClipIds: [...clipIds],
        error: preview.error,
        status: preview.status,
      };
    });
  };

  const onTransitionDurationCommit = () => {
    const base = dragBaseRef.current;
    dragBaseRef.current = null;
    if (!base) return;
    setSession((s) => ({
      ...s,
      history: { past: [...base.history.past, structuredClone(base.project)], future: [] },
      status: "Set transition",
      error: null,
    }));
  };

  const onTransitionAudioDurationCommit = () => {
    const base = dragBaseRef.current;
    dragBaseRef.current = null;
    if (!base) return;
    setSession((s) => ({
      ...s,
      history: { past: [...base.history.past, structuredClone(base.project)], future: [] },
      status: "Audio duration",
      error: null,
    }));
  };

  const onLoopClick = (ms: number) => {
    setSession((s) => {
      if (s.project.inPointMs != null && s.project.outPointMs == null) {
        return applyOutAt(s, ms);
      }
      return applyInAt(s, ms);
    });
  };

  const onLoopInLive = (ms: number) => {
    setSession((s) => {
      if (!dragBaseRef.current) dragBaseRef.current = s;
      const result = setInPoint(s.project, ms, { replace: true });
      if (result.error) return s;
      return { ...s, project: result.project, error: null };
    });
  };

  const onLoopOutLive = (ms: number) => {
    setSession((s) => {
      if (!dragBaseRef.current) dragBaseRef.current = s;
      const result = setOutPoint(s.project, ms, { replace: true });
      if (result.error) return s;
      return { ...s, project: result.project, error: null };
    });
  };

  const onLoopMoveLive = (deltaMs: number) => {
    setSession((s) => {
      if (!dragBaseRef.current) dragBaseRef.current = s;
      const result = moveInOut(dragBaseRef.current.project, deltaMs);
      if (result.error) return s;
      return { ...s, project: result.project, error: null };
    });
  };

  const toggleMixerCollapsed = () => {
    setMixerCollapsed((prev) => {
      const next = !prev;
      saveMixerCollapsed(layoutStore, next);
      return next;
    });
  };

  const persistPresentation = (next: {
    inspectorCollapsed: boolean;
    directorEnabled: boolean;
    directorFocus: boolean;
  }) => {
    saveDirectorPresentation(layoutStore, directorPresentationOf(next));
  };

  const toggleInspectorCollapsed = () => {
    setInspectorCollapsed((prev) => {
      const next = !prev;
      saveInspectorCollapsed(layoutStore, next);
      persistPresentation({
        inspectorCollapsed: next,
        directorEnabled,
        directorFocus,
      });
      return next;
    });
  };

  const closeDirector = () => {
    setDirectorEnabled(false);
    persistDirectorEnabled(false);
    persistPresentation({
      inspectorCollapsed,
      directorEnabled: false,
      directorFocus,
    });
  };

  const openDirector = () => {
    setDirectorEnabled(true);
    persistDirectorEnabled(true);
    if (inspectorCollapsed) {
      setInspectorCollapsed(false);
      saveInspectorCollapsed(layoutStore, false);
    }
    persistPresentation({
      inspectorCollapsed: false,
      directorEnabled: true,
      directorFocus,
    });
    if (directorFocus) {
      setHSplitRatio(directorFocusHSplitRef.current);
    }
  };

  const toggleDirector = () => {
    if (directorEnabled && !inspectorCollapsed) {
      closeDirector();
      return;
    }
    openDirector();
  };

  const hideInspectorSection = directorEnabled && (directorFocus || inspectorSectionCollapsed);

  const workspaceAvailablePx = () => {
    const workspace = workspaceRef.current;
    if (!workspace) return undefined;
    const width = workspace.getBoundingClientRect().width;
    if (!Number.isFinite(width) || width < PREVIEW_H_MIN_PX + INSPECTOR_MIN_PX) return undefined;
    return Math.max(1, width - H_SPLITTER_PX);
  };

  const toggleInspectorSectionCollapsed = () => {
    if (directorFocus) {
      const available = workspaceAvailablePx();
      const next = applyDirectorFocusToggle({
        currentlyFocused: true,
        inspectorSectionCollapsed,
        currentSplitRatio: directorSplitRatioRef.current,
        storedNormalSplit: directorNormalSplit,
        storedSectionCollapsed: directorFocusRestoreCollapsed,
        currentHSplit: hSplitRatioRef.current,
        storedDockedHSplit: directorDockedHSplitRef.current,
        storedFocusHSplit: directorFocusHSplitRef.current,
        availablePx: available,
      });
      setDirectorFocus(false);
      setInspectorSectionCollapsed(next.inspectorSectionCollapsed);
      setDirectorSplitRatio(next.splitRatio);
      setDirectorNormalSplit(next.normalSplit);
      setHSplitRatio(next.hSplitRatio);
      setDirectorDockedHSplit(next.dockedHSplit);
      setDirectorFocusHSplit(next.focusHSplit);
      saveDirectorFocus(layoutStore, false);
      saveInspectorSectionCollapsed(layoutStore, next.inspectorSectionCollapsed);
      saveDirectorSplitRatio(layoutStore, next.splitRatio);
      saveDirectorNormalSplitRatio(layoutStore, next.normalSplit);
      saveHSplitRatio(layoutStore, next.hSplitRatio);
      saveDirectorFocusHSplitRatio(layoutStore, next.focusHSplit);
      persistPresentation({
        inspectorCollapsed,
        directorEnabled,
        directorFocus: false,
      });
      return;
    }
    setInspectorSectionCollapsed((prev) => {
      const next = !prev;
      saveInspectorSectionCollapsed(layoutStore, next);
      return next;
    });
  };

  const toggleDirectorFocus = () => {
    const available = workspaceAvailablePx();
    const next = applyDirectorFocusToggle({
      currentlyFocused: directorFocus,
      inspectorSectionCollapsed,
      currentSplitRatio: directorSplitRatioRef.current,
      storedNormalSplit: directorNormalSplit,
      storedSectionCollapsed: directorFocusRestoreCollapsed,
      currentHSplit: hSplitRatioRef.current,
      storedDockedHSplit: directorDockedHSplitRef.current,
      storedFocusHSplit: directorFocusHSplitRef.current,
      availablePx: available,
    });
    setDirectorFocus(next.focused);
    setInspectorSectionCollapsed(next.inspectorSectionCollapsed);
    setDirectorSplitRatio(next.splitRatio);
    setDirectorNormalSplit(next.normalSplit);
    setDirectorFocusRestoreCollapsed(next.restoreSectionCollapsed);
    setHSplitRatio(next.hSplitRatio);
    setDirectorDockedHSplit(next.dockedHSplit);
    setDirectorFocusHSplit(next.focusHSplit);
    saveDirectorFocus(layoutStore, next.focused);
    saveInspectorSectionCollapsed(layoutStore, next.inspectorSectionCollapsed);
    saveDirectorSplitRatio(layoutStore, next.splitRatio);
    saveDirectorNormalSplitRatio(layoutStore, next.normalSplit);
    saveDirectorFocusHSplitRatio(layoutStore, next.focusHSplit);
    if (!next.focused) saveHSplitRatio(layoutStore, next.hSplitRatio);
    persistPresentation({
      inspectorCollapsed,
      directorEnabled,
      directorFocus: next.focused,
    });
  };

  const toggleTimelineFocus = () => {
    const stage = stageRef.current;
    const available = stage ? Math.max(1, stage.getBoundingClientRect().height - SPLITTER_PX) : undefined;
    const next = applyTimelineFocusToggle({
      currentlyFocused: timelineFocusRef.current,
      currentRatio: splitRatioRef.current,
      storedNormalRatio: normalSplitRatioRef.current,
      availablePx: available,
    });
    setTimelineFocus(next.focused);
    setSplitRatio(next.liveRatio);
    setNormalSplitRatio(next.normalRatio);
    saveTimelineFocus(layoutStore, next.focused);
    saveNormalSplitRatio(layoutStore, next.normalRatio);
    if (!next.focused) saveSplitRatio(layoutStore, next.liveRatio);
  };

  const toggleGroupCollapsed = (groupId: string) => {
    setCollapsedGroupIds((prev) => {
      const next = toggleCollapsedGroupId(prev, groupId);
      saveCollapsedGroupIds(layoutStore, next);
      return next;
    });
  };

  const toggleVolumeLane = (trackId: TrackId) => {
    setOpenVolumeLaneIds((prev) => {
      const next = toggleOpenVolumeLaneId(prev, trackId);
      saveOpenVolumeLaneIds(layoutStore, next);
      return next;
    });
  };

  const onVolumePointLive = (trackId: TrackId, fromTimeMs: number, timeMs: number, value: number) => {
    setSession((s) => {
      if (!dragBaseRef.current) dragBaseRef.current = s;
      const base = dragBaseRef.current;
      const preview = previewMoveVolumeAutomationPoint(base, trackId, fromTimeMs, timeMs, value);
      if (!preview.point) return s;
      return {
        ...s,
        project: preview.project,
        selectedVolumeAutomation: { trackId, timeMs: preview.point.timeMs },
        selectedClipId: null,
        selectedClipIds: [],
        status: "Moving volume point",
        error: null,
      };
    });
  };

  const onVolumePointCommit = () => {
    const base = dragBaseRef.current;
    dragBaseRef.current = null;
    if (!base) return;
    setSession((s) => ({
      ...s,
      history: { past: [...base.history.past, structuredClone(base.project)], future: [] },
      status: "Volume point moved",
      error: null,
    }));
  };

  const onLaneLabelPx = (px: number) => {
    setLaneLabelPx(px);
    saveLaneLabelPx(layoutStore, px);
  };

  const onLaneHeight = (group: LaneHeightGroup, px: number) => {
    setLaneHeights((prev) => {
      const next = { ...prev, [group]: px };
      saveLaneHeights(layoutStore, next);
      return next;
    });
  };

  const applySplitFromEvent = (clientY: number) => {
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const next = applySplitPointer({
      clientY,
      stageTop: rect.top,
      stageHeight: rect.height,
    });
    setSplitRatio(next.ratio);
  };

  const onSplitPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    splitDragRef.current = true;
    applySplitFromEvent(e.clientY);
    const move = (ev: PointerEvent) => {
      if (!splitDragRef.current) return;
      applySplitFromEvent(ev.clientY);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (!splitDragRef.current) return;
      splitDragRef.current = false;
      if (!timelineFocusRef.current) {
        saveSplitRatio(layoutStore, splitRatioRef.current);
        saveNormalSplitRatio(layoutStore, splitRatioRef.current);
        setNormalSplitRatio(splitRatioRef.current);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const applyHSplitFromEvent = (clientX: number) => {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    const rect = workspace.getBoundingClientRect();
    const next =
      directorFocus && directorEnabled
        ? applyFocusHSplitPointer({
            clientX,
            workspaceLeft: rect.left,
            workspaceWidth: rect.width,
          })
        : applyHSplitPointer({
            clientX,
            workspaceLeft: rect.left,
            workspaceWidth: rect.width,
          });
    setHSplitRatio(next.ratio);
  };

  const onHSplitPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    hSplitDragRef.current = true;
    applyHSplitFromEvent(e.clientX);
    const move = (ev: PointerEvent) => {
      if (!hSplitDragRef.current) return;
      applyHSplitFromEvent(ev.clientX);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (!hSplitDragRef.current) return;
      hSplitDragRef.current = false;
      if (directorFocus && directorEnabled) {
        setDirectorFocusHSplit(hSplitRatioRef.current);
        saveDirectorFocusHSplitRatio(layoutStore, hSplitRatioRef.current);
      } else {
        setDirectorDockedHSplit(hSplitRatioRef.current);
        saveHSplitRatio(layoutStore, hSplitRatioRef.current);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const resetHSplit = () => {
    if (directorFocus && directorEnabled) {
      setHSplitRatio(DEFAULT_DIRECTOR_FOCUS_H_SPLIT);
      setDirectorFocusHSplit(DEFAULT_DIRECTOR_FOCUS_H_SPLIT);
      saveDirectorFocusHSplitRatio(layoutStore, DEFAULT_DIRECTOR_FOCUS_H_SPLIT);
      return;
    }
    setHSplitRatio(DEFAULT_H_SPLIT_RATIO);
    setDirectorDockedHSplit(DEFAULT_H_SPLIT_RATIO);
    saveHSplitRatio(layoutStore, DEFAULT_H_SPLIT_RATIO);
  };

  const applyDirectorSplitFromEvent = (clientY: number) => {
    const body = inspectorBodyRef.current;
    if (!body) return;
    const rect = body.getBoundingClientRect();
    const next = applyDirectorSplitPointer({
      clientY,
      bodyTop: rect.top,
      bodyHeight: rect.height,
    });
    setDirectorSplitRatio(next.ratio);
  };

  const onDirectorSplitPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    directorSplitDragRef.current = true;
    applyDirectorSplitFromEvent(e.clientY);
    const move = (ev: PointerEvent) => {
      if (!directorSplitDragRef.current) return;
      applyDirectorSplitFromEvent(ev.clientY);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (!directorSplitDragRef.current) return;
      directorSplitDragRef.current = false;
      saveDirectorSplitRatio(layoutStore, directorSplitRatioRef.current);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const resetDirectorSplit = () => {
    setDirectorSplitRatio(DEFAULT_DIRECTOR_SPLIT_RATIO);
    saveDirectorSplitRatio(layoutStore, DEFAULT_DIRECTOR_SPLIT_RATIO);
  };

  useEffect(() => {
    const normalizeLayout = () => {
      const stage = stageRef.current;
      if (stage) {
        const rawHeight = stage.getBoundingClientRect().height;
        if (isMeasuredStageHeight(rawHeight)) {
          const stageAvail = Math.max(1, rawHeight - SPLITTER_PX);
          if (stageAvail !== stageAvailPxRef.current) setStageAvailPx(stageAvail);
          const stageNext = normalizePersistedSplitRatio(splitRatioRef.current, stageAvail);
          if (stageNext !== splitRatioRef.current) setSplitRatio(stageNext);
          if (!timelineFocusRef.current) {
            const normalNext = clampSplitRatio(normalSplitRatioRef.current, stageAvail);
            if (normalNext !== normalSplitRatioRef.current) setNormalSplitRatio(normalNext);
          }
        }
      }
      if (inspectorCollapsed) return;
      const workspace = workspaceRef.current;
      if (!workspace) return;
      const available = workspace.getBoundingClientRect().width - H_SPLITTER_PX;
      const next =
        directorFocus && directorEnabled
          ? clampFocusHSplitRatio(hSplitRatioRef.current, available)
          : clampHSplitRatio(hSplitRatioRef.current, available);
      if (next !== hSplitRatioRef.current) setHSplitRatio(next);
      const body = inspectorBodyRef.current;
      if (body && directorEnabled && !hideInspectorSection) {
        const splitAvail = body.getBoundingClientRect().height - DIRECTOR_SPLITTER_PX;
        const splitNext = clampDirectorSplitRatio(directorSplitRatioRef.current, splitAvail);
        if (splitNext !== directorSplitRatioRef.current) setDirectorSplitRatio(splitNext);
      }
    };
    normalizeLayout();
    window.addEventListener("resize", normalizeLayout);
    return () => window.removeEventListener("resize", normalizeLayout);
  }, [inspectorCollapsed, directorEnabled, directorFocus, hideInspectorSection]);

  useEffect(() => {
    const measureMixer = () => {
      const row = arrangeRowRef.current;
      const width = row?.getBoundingClientRect().width ?? 0;
      setMixerAutoCompact(shouldAutoCompactMixer(width));
    };
    measureMixer();
    window.addEventListener("resize", measureMixer);
    return () => window.removeEventListener("resize", measureMixer);
  }, [directorFocus, directorEnabled, inspectorCollapsed, hSplitRatio, mixerCollapsed, mixerWidthPx]);

  const applyMixerWidthFromEvent = (clientX: number) => {
    const row = arrangeRowRef.current;
    if (!row) return;
    const rect = row.getBoundingClientRect();
    const next = applyMixerWidthPointer({
      clientX,
      arrangeLeft: rect.left,
      arrangeWidth: rect.width,
    });
    mixerWidthRef.current = next.widthPx;
    setMixerWidthPx(next.widthPx);
    saveMixerWidth(layoutStore, next.widthPx);
  };

  const onMixerResizePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* jsdom / lost pointer */
    }
    mixerResizeDragRef.current = true;
    applyMixerWidthFromEvent(e.clientX);
    const move = (ev: PointerEvent) => {
      if (!mixerResizeDragRef.current) return;
      applyMixerWidthFromEvent(ev.clientX);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      mixerResizeDragRef.current = false;
      saveMixerWidth(layoutStore, mixerWidthRef.current);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const closeProjectPanel = () => setProjectPanelOpen(false);
  const toggleProjectPanel = () => setProjectPanelOpen((open) => !open);

  const startImport = () => {
    void (async () => {
      if (isTauriRuntime()) {
        try {
          const files = await pickTauriMediaFiles({ multiple: true });
          if (files?.length) setSession(await importFiles(sessionRef.current, files));
        } catch (e) {
          setSession((s) => ({
            ...s,
            error: e instanceof Error ? e.message : String(e),
            status: "Import failed",
          }));
        }
        return;
      }
      document.querySelector<HTMLInputElement>("[data-testid=import-input]")?.click();
    })();
  };

  const onLoopCommit = () => {
    const base = dragBaseRef.current;
    dragBaseRef.current = null;
    if (!base) return;
    setSession((s) => ({
      ...s,
      history: { past: [...base.history.past, structuredClone(base.project)], future: [] },
      status: "Loop range",
      error: null,
    }));
  };

  return (
    <div className="app" data-testid="app">
      <Toolbar
        exporting={exporting}
        screen={screen}
        onSelectScreen={setScreen}
        onToggleFile={toggleProjectPanel}
        filePanelOpen={projectPanelOpen}
        onImport={startImport}
        onExport={runExport}
        projectName={session.project.name}
        projectDirty={isProjectDirty(session)}
        onRenameProject={(name) => runCommand({ type: "renameProject", name })}
        directorEnabled={directorEnabled}
        onToggleDirector={toggleDirector}
      />
      <input
        type="file"
        accept={MEDIA_FILE_ACCEPT}
        multiple
        hidden
        data-testid="import-input"
        onChange={(e) => {
          if (e.target.files) void importFiles(session, e.target.files).then(setSession);
          e.target.value = "";
        }}
      />
      <input
        ref={relinkInputRef}
        type="file"
        hidden
        data-testid="relink-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void finishRelink(file);
        }}
      />

      {projectPanelOpen ? (
        <div className="project-overlay pass-through" data-testid="project-overlay">
          <div
            className="project-overlay-backdrop"
            data-testid="project-overlay-backdrop"
            aria-hidden="true"
          />
          <div className="project-overlay-drawer" role="dialog" aria-label="Projekt" aria-modal="false">
            <button
              type="button"
              className="project-overlay-close"
              data-testid="project-overlay-close"
              onClick={closeProjectPanel}
            >
              Close
            </button>
            <ProjectFilePanel
              memory={projectFile}
              onNew={() => setSession(confirmNewProject(sessionRef.current))}
              onSave={saveProject}
              onSaveAs={saveProjectAs}
              onOpen={openWithPicker}
              onOpenFile={(file) => void openProject(file)}
              onOpenLast={openLast}
              onOpenRecent={openRecent}
            />
            <MediaBrowser
              project={session.project}
              targetTrackId={session.targetTrackId}
              selectedAssetId={selectedAssetId}
              onSelectAsset={setSelectedAssetId}
              onTargetTrack={(id) => setSession((s) => ({ ...s, targetTrackId: id, selectedTrackIds: [id] }))}
              onPlace={(assetId) => {
                const asset = session.project.assets.find((a) => a.id === assetId);
                if (!asset) return;
                const trackId = preferredTrackForAsset(asset.kind, session.targetTrackId);
                setSession((s) => applyPlaceAsset(s, assetId, trackId));
              }}
              onRelinkAsset={runRelinkAsset}
            />
          </div>
        </div>
      ) : null}

      <div className="stage" data-testid="stage" ref={stageRef}>
      <div
        className={`workspace stage-grid${inspectorCollapsed ? " inspector-collapsed" : ""}${
          directorFocus && directorEnabled && !inspectorCollapsed ? " director-focus" : ""
        }`}
        data-testid="preview-pane"
        data-preview-ratio={splitRatio}
        data-h-split-ratio={hSplitRatio}
        data-inspector-collapsed={inspectorCollapsed ? "true" : "false"}
        data-director-focus={directorFocus && directorEnabled && !inspectorCollapsed ? "true" : "false"}
        data-director-full-height="false"
        data-director-presentation={directorPresentationOf({
          inspectorCollapsed,
          directorEnabled,
          directorFocus,
        })}
        data-timeline-focus={timelineFocus ? "true" : "false"}
        ref={workspaceRef}
        style={{
          ["--stage-preview-row" as string]: `${splitRatio}fr`,
          ["--stage-arrange-row" as string]: `${1 - splitRatio}fr`,
          ["--stage-lower-min" as string]: `${legalSplitMins(stageAvailPx).lowerMin}px`,
          ["--stage-preview-min" as string]: `${legalSplitMins(stageAvailPx).previewMin}px`,
          ["--arrange-min" as string]: `${Math.max(96, legalSplitMins(stageAvailPx).lowerMin - TRANSPORT_MIN_PX)}px`,
          ["--stage-preview-col" as string]: inspectorCollapsed ? "1fr" : `${hSplitRatio}fr`,
          ["--stage-inspector-col" as string]: inspectorCollapsed
            ? `${INSPECTOR_COLLAPSED_PX}px`
            : `${1 - hSplitRatio}fr`,
        }}
        data-stage-avail={stageAvailPx}
        data-preview-min={legalSplitMins(stageAvailPx).previewMin}
        data-lower-min={legalSplitMins(stageAvailPx).lowerMin}
      >
        <div className="workspace-preview" data-testid="workspace-preview">
          <Preview
            project={session.project}
            playing={session.playing}
            liveWriteTrackId={session.volumeWriteGesture?.trackId ?? null}
            liveWriteValue={session.volumeWriteGesture?.liveValue ?? null}
            onLevels={setMixPeaks}
          />
        </div>
        {inspectorCollapsed ? null : (
          <div
            className="layout-split-v"
            data-testid="layout-split-h"
            role="separator"
            aria-orientation="vertical"
            aria-label="Preview und Inspector teilen"
            title="Preview / Inspector"
            style={{ cursor: "ew-resize" }}
            onPointerDown={onHSplitPointerDown}
            onDoubleClick={resetHSplit}
          >
            <span className="layout-split-v-grip" data-testid="layout-split-h-grip" aria-hidden="true" />
          </div>
        )}
        <div
          className={`workspace-inspector${inspectorCollapsed ? " collapsed" : ""}${
            directorEnabled && !inspectorCollapsed ? " director-open" : ""
          }${hideInspectorSection && !inspectorCollapsed ? " inspector-section-collapsed" : ""}${
            directorFocus && directorEnabled && !inspectorCollapsed ? " director-focus" : ""
          }`}
          data-testid="workspace-inspector"
          data-collapsed={inspectorCollapsed ? "true" : "false"}
          data-director-open={directorEnabled && !inspectorCollapsed ? "true" : "false"}
          data-inspector-section-collapsed={hideInspectorSection ? "true" : "false"}
          data-director-focus={directorFocus && directorEnabled && !inspectorCollapsed ? "true" : "false"}
          data-director-presentation={directorPresentationOf({
            inspectorCollapsed,
            directorEnabled,
            directorFocus,
          })}
          style={
            inspectorCollapsed
              ? {
                  flex: `0 0 ${INSPECTOR_COLLAPSED_PX}px`,
                  width: INSPECTOR_COLLAPSED_PX,
                  minWidth: INSPECTOR_COLLAPSED_PX,
                  maxWidth: INSPECTOR_COLLAPSED_PX,
                }
              : directorFocus && directorEnabled
                ? {
                    flex: `${1 - hSplitRatio} 1 ${INSPECTOR_MIN_PX}px`,
                    maxWidth: "none",
                  }
                : {
                    flex: `${1 - hSplitRatio} 1 ${INSPECTOR_MIN_PX}px`,
                    maxWidth: INSPECTOR_MAX_PX,
                  }
          }
        >
          <div className="inspector-chrome">
            <button
              type="button"
              className="inspector-collapse"
              data-testid="inspector-collapse"
              aria-expanded={!inspectorCollapsed}
              aria-controls="inspector-body"
              title={inspectorCollapsed ? "Expand Inspector panel" : "Collapse Inspector panel"}
              onClick={toggleInspectorCollapsed}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                {inspectorCollapsed ? (
                  <path d="M4 2 L9 6 L4 10" fill="none" stroke="currentColor" strokeWidth="1.6" />
                ) : (
                  <path d="M8 2 L3 6 L8 10" fill="none" stroke="currentColor" strokeWidth="1.6" />
                )}
              </svg>
              {inspectorCollapsed ? (
                <span className="inspector-reopen-label">Expand INS</span>
              ) : (
                <span className="inspector-collapse-label">Collapse</span>
              )}
            </button>
            {inspectorCollapsed ? null : <span className="inspector-chrome-label">Inspector</span>}
            {inspectorCollapsed || !directorEnabled ? null : (
              <button
                type="button"
                className="inspector-section-collapse"
                data-testid="inspector-section-collapse"
                aria-expanded={!hideInspectorSection}
                title={
                  hideInspectorSection
                    ? "Expand Inspector — Director keeps this sidebar"
                    : "Collapse Inspector — Director uses this space"
                }
                onClick={toggleInspectorSectionCollapsed}
              >
                {hideInspectorSection ? "Expand Inspector" : "Collapse Inspector"}
              </button>
            )}
          </div>
          {inspectorCollapsed ? null : (
            <div
              id="inspector-body"
              ref={inspectorBodyRef}
              className={`inspector-body${directorEnabled ? " director-open" : ""}${
                hideInspectorSection ? " inspector-section-collapsed" : ""
              }${directorFocus ? " director-focus" : ""}`}
              data-testid="inspector-body"
              data-director-open={directorEnabled ? "true" : "false"}
              data-inspector-section-collapsed={hideInspectorSection ? "true" : "false"}
              data-director-focus={directorFocus ? "true" : "false"}
              data-director-split-ratio={directorSplitRatio}
              style={
                directorEnabled && !hideInspectorSection
                  ? {
                      gridTemplateRows: `minmax(64px, ${directorSplitRatio}fr) ${DIRECTOR_SPLITTER_PX}px minmax(180px, ${1 - directorSplitRatio}fr)`,
                    }
                  : undefined
              }
            >
              <div
                className="inspector-section"
                data-testid="inspector-section"
                hidden={hideInspectorSection}
              >
                <Inspector
                  project={session.project}
                  selectedClipId={session.selectedClipId}
                  selectedClipIds={session.selectedClipIds}
                  selectedMarkerId={session.selectedMarkerId}
                  selectedVis={session.selectedVis}
                  selectedVisEventId={session.selectedVisEventId}
                  onChange={(clipId, patch) => setSession(applyUpdateClip(session, clipId, patch))}
                  onSetEnabled={(enabled) => runCommand({ type: "setClipsEnabled", enabled })}
                  onSetLocked={(locked) => runCommand({ type: "setClipsLocked", locked })}
                  onFades={(clipId, fadeInMs, fadeOutMs) =>
                    setSession(applyCommand(session, { type: "setClipFades", clipId, fadeInMs, fadeOutMs }))
                  }
                  onRate={(clipId, rate) =>
                    setSession(applyCommand(session, { type: "setClipRate", clipId, rate }))
                  }
                  onUnlink={(clipId) => setSession(applyCommand(session, { type: "unlinkClips", clipId }))}
                  onRelink={() => void runRelink()}
                  onRenameMarker={(markerId, label) =>
                    setSession(applyCommand(session, { type: "renameMarker", markerId, label }))
                  }
                  onTransition={(cmd) => setSession(applyCommand(session, cmd))}
                  onVisualizer={(patch) => setSession(applySetVisualizer(session, patch))}
                />
              </div>
              {directorEnabled && !hideInspectorSection ? (
                <div
                  className="director-split"
                  data-testid="director-split"
                  role="separator"
                  aria-orientation="horizontal"
                  aria-label="Inspector and Director split"
                  title="Inspector / Director"
                  onPointerDown={onDirectorSplitPointerDown}
                  onDoubleClick={resetDirectorSplit}
                >
                  <span className="director-split-grip" data-testid="director-split-grip" aria-hidden="true" />
                </div>
              ) : null}
              {directorEnabled ? (
                <div className="director-section" data-testid="director-section">
                  <DirectorPanel
                    session={session}
                    onCanonicalCommit={(next) => setSession(next)}
                    onRequestClose={closeDirector}
                    focusMode={directorFocus}
                    onToggleFocus={toggleDirectorFocus}
                    canUndo={session.history.past.length > 0}
                    canRedo={session.history.future.length > 0}
                    onUndo={() => runCommand({ type: "undo" })}
                    onRedo={() => runCommand({ type: "redo" })}
                  />
                </div>
              ) : null}
            </div>
          )}
        </div>

      <div
        className="layout-split"
        data-testid="layout-split"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Preview und Arrange teilen"
        title="Preview höher / niedriger"
        style={{ cursor: "ns-resize" }}
        onPointerDown={onSplitPointerDown}
      >
        <span className="layout-split-grip" data-testid="layout-split-grip" aria-hidden="true" />
        <button
          type="button"
          className={`timeline-focus${timelineFocus ? " active" : ""}`}
          data-testid="timeline-focus"
          aria-pressed={timelineFocus}
          title={timelineFocus ? "Exit Timeline Focus" : "Timeline Focus"}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            toggleTimelineFocus();
          }}
        >
          {timelineFocus ? "Normal" : "Focus"}
        </button>
      </div>

      <div className="lower-stage" data-testid="lower-stage">
      <Transport
        project={session.project}
        playing={session.playing}
        onPlay={play}
        onPause={pause}
        onStop={stop}
        onStep={(delta) => runCommand({ type: "nudgePlayhead", deltaMs: delta })}
        onToggleLoop={() => setSession(applyToggleLoop(session))}
        followPlayhead={session.followPlayhead}
        onToggleFollow={() => setSession(applyToggleFollow(session))}
        onIn={() => runCommand({ type: "markIn" })}
        onOut={() => runCommand({ type: "markOut" })}
        onClear={() => runCommand({ type: "clearInOut" })}
        onMarker={() => runCommand({ type: "addMarker" })}
        onSplit={() => runCommand({ type: "split" })}
        snap={session.project.snap}
        onToggleSnap={() => setSession(applyToggleSnap(session))}
        onUndo={() => runCommand({ type: "undo" })}
        onRedo={() => runCommand({ type: "redo" })}
        onSeek={(ms) => setSession((s) => applyPlayhead(s, ms))}
        onToggleShortcuts={() => setShortcutsOpen((open) => !open)}
      />

      {screen === "cutter" ? (
        <Cutter
          project={session.project}
          selectedClipId={session.selectedClipId}
          selectedClipIds={session.selectedClipIds}
          apply={runCommand}
          onPlayhead={(ms) => setSession((s) => applyPlayhead(s, ms))}
          laneLabelPx={laneLabelPx}
        />
      ) : null}
      <div
        className={`arrange-row${mixerCollapsed ? " mixer-collapsed" : ""}${
          mixerAutoCompact && !mixerCollapsed ? " mixer-master-only" : ""
        }`}
        data-testid="arrange-row"
        data-mixer-master-only={mixerAutoCompact && !mixerCollapsed ? "true" : "false"}
        data-mixer-chrome={mixerChromeOf({ collapsed: mixerCollapsed, autoCompact: mixerAutoCompact })}
        data-mixer-width={mixerWidthPx}
        ref={arrangeRowRef}
        style={{
          overflow: "hidden",
          ["--mixer-width" as string]: `${mixerWidthPx}px`,
          ...(mixerCollapsed || mixerAutoCompact
            ? {}
            : {
                gridTemplateColumns: `minmax(${TIMELINE_MIN_PX}px, 1fr) ${mixerWidthPx}px`,
              }),
        }}
      >
      <Timeline
        visibleTrackIds={tracksForScreen(screen, session.project)}
        project={session.project}
        selectedClipId={session.selectedClipId}
        selectedClipIds={session.selectedClipIds}
        selectedMarkerId={session.selectedMarkerId}
        selectedVis={session.selectedVis}
        selectedTrackIds={session.selectedTrackIds}
        onSelectTrack={(id, opts) => setSession((s) => applySelectTracks(s, id, opts))}
        onSelect={(id, opts) =>
          setSession((s) =>
            applyCommand(s, { type: "select", clipId: id, toggle: opts?.toggle, range: opts?.range }),
          )
        }
        onSelectClips={(ids, opts) =>
          setSession((s) => applyCommand(s, { type: "selectClips", clipIds: ids, union: opts?.union }))
        }
        onSelectMarker={(id) => setSession(applySelectMarker(session, id))}
        onMarkerMoveLive={onMarkerMoveLive}
        onMarkerMoveCommit={onMarkerMoveCommit}
        onDeleteMarker={(id) => setSession(applyDeleteMarker(session, id))}
        onPlayhead={(ms) => setSession((s) => applyPlayhead(s, ms))}
        onMoveLive={onMoveLive}
        onMoveCommit={onMoveCommit}
        onTrimLive={onTrimLive}
        onTrimCommit={onTrimCommit}
        onSlipLive={onSlipLive}
        onSlipCommit={onSlipCommit}
        onSlideLive={onSlideLive}
        onSlideCommit={onSlideCommit}
        onFadesLive={onFadesLive}
        onFadesCommit={onFadesCommit}
        onTransitionDurationLive={onTransitionDurationLive}
        onTransitionDurationCommit={onTransitionDurationCommit}
        onTransitionAudioDurationLive={onTransitionAudioDurationLive}
        onTransitionAudioDurationCommit={onTransitionAudioDurationCommit}
        onToggleMute={(id) => runCommand({ type: "toggleMute", trackId: id })}
        onToggleSolo={(id) => runCommand({ type: "toggleSolo", trackId: id })}
        onToggleVisualizerMute={() => setSession(applyToggleVisualizerMute(session))}
        onCycleVisualizerScene={() => setSession(applyCycleVisualizerScene(session))}
        onSetVisualizerScene={(sceneId) => setSession(applyPickVisualizerScene(session, sceneId))}
        onSelectVis={() => setSession(applySelectVis(session))}
        onSelectVisEvent={(eventId) =>
          setSession((s) => applyCommand(s, { type: "selectVisEvent", eventId }))
        }
        onInsertVisEvent={() => setSession((s) => applyCommand(s, { type: "insertVisEvent" }))}
        onVisEventMoveLive={onVisEventMoveLive}
        onVisEventMoveCommit={onVisEventMoveCommit}
        onVisEventStretchLive={onVisEventStretchLive}
        onVisEventStretchCommit={onVisEventStretchCommit}
        onSetFrontVideoTrack={(trackId) =>
          setSession((s) => applyCommand(s, { type: "setFrontVideoTrack", trackId }))
        }
        selectedVisEventId={session.selectedVisEventId}
        selectedVisEventIds={session.selectedVisEventIds}
        onSelectAll={() => runCommand({ type: "selectAll" })}
        onSelectAllOnTrack={() => runCommand({ type: "selectAllOnTrack" })}
        onSetClipsEnabled={(enabled) => runCommand({ type: "setClipsEnabled", enabled })}
        onSetClipsLocked={(locked) => runCommand({ type: "setClipsLocked", locked })}
        onSplitHere={(clipId, timeMs) => {
          setSession((s) =>
            applyCommand(applyPlayhead(applySelect(s, clipId), snapPlayheadSeek(s.project, timeMs)), {
              type: "split",
            }),
          );
        }}
        onCut={() => runCommand({ type: "cut" })}
        onCopy={() => runCommand({ type: "copy" })}
        onPaste={() => runCommand({ type: "paste" })}
        onDuplicate={() => runCommand({ type: "duplicate" })}
        onDelete={() => runCommand({ type: "liftDelete" })}
        onRippleDelete={() => runCommand({ type: "rippleDelete" })}
        onLiftRange={() => runCommand({ type: "liftRange" })}
        onExtractRange={() => runCommand({ type: "extractRange" })}
        onRelink={(clipIds) => void runRelink(clipIds)}
        onCloseGap={() => runCommand({ type: "closeGap" })}
        onRippleTrimToPlayhead={(edge, timeMs) => {
          setSession((s) => {
            const parked =
              timeMs != null ? applyPlayhead(s, snapPlayheadSeek(s.project, timeMs)) : s;
            return applyCommand(parked, { type: "rippleTrimToPlayhead", edge });
          });
        }}
        onZoom={(z, widthPx) => setSession(applyZoom(session, z, widthPx, laneLabelPx))}
        onFit={(widthPx) => setSession(applyFit(session, widthPx, laneLabelPx))}
        onViewport={onTimelineViewport}
        laneLabelPx={laneLabelPx}
        laneHeights={laneHeights}
        onLaneLabelPx={onLaneLabelPx}
        onLaneHeight={onLaneHeight}
        onPlaceAsset={(assetId, trackId, startMs) => {
          setSession((s) => applyPlaceAsset(s, assetId, trackId, startMs));
        }}
        onAddAudioTrack={() => runCommand({ type: "addAudioTrack" })}
        onRemoveAudioTrack={() => runCommand({ type: "removeAudioTrack" })}
        canAddAudioTrack={canAddAudioTrack(session.project)}
        canRemoveAudioTrack={canRemoveAudioTrack(session.project, session.targetTrackId)}
        collapsedGroupIds={collapsedGroupIds}
        onToggleGroupCollapsed={toggleGroupCollapsed}
        onCreateTrackGroup={(trackIds) => runCommand({ type: "createTrackGroup", trackIds })}
        onAssignTracksToGroup={(trackIds, groupId) =>
          runCommand({ type: "assignTracksToGroup", trackIds, groupId })
        }
        onRenameTrackGroup={(groupId, name) => runCommand({ type: "renameTrackGroup", groupId, name })}
        openVolumeLaneIds={openVolumeLaneIds}
        selectedVolumeAutomation={session.selectedVolumeAutomation}
        onToggleVolumeLane={toggleVolumeLane}
        onSetVolumeAutomationEnabled={(trackId, enabled) =>
          runCommand({ type: "setVolumeAutomationEnabled", trackId, enabled })
        }
        onSelectVolumeAutomationPoint={(trackId, timeMs) => {
          if (timeMs == null) runCommand({ type: "clearVolumeAutomationPoint" });
          else runCommand({ type: "selectVolumeAutomationPoint", trackId, timeMs });
        }}
        onAddVolumeAutomationPoint={(trackId, timeMs, value) =>
          runCommand({ type: "addVolumeAutomationPoint", trackId, timeMs, value })
        }
        onDeleteVolumeAutomationPoint={(trackId, timeMs) =>
          runCommand({ type: "deleteVolumeAutomationPoint", trackId, timeMs })
        }
        onVolumeAutomationPointLive={onVolumePointLive}
        onVolumeAutomationPointCommit={onVolumePointCommit}
        volumeWriteArmedIds={session.volumeWriteArmedIds}
        onToggleVolumeWriteArm={(trackId) => runCommand({ type: "toggleVolumeWriteArm", trackId })}
        onScroll={(ms) => setSession(applyScroll(session, ms))}
        onLoopClick={onLoopClick}
        onLoopInLive={onLoopInLive}
        onLoopOutLive={onLoopOutLive}
        onLoopMoveLive={onLoopMoveLive}
        onLoopCommit={onLoopCommit}
      />
      <Mixer
        project={session.project}
        selectedTrackId={session.targetTrackId}
        selectedTrackIds={session.selectedTrackIds}
        peaks={mixPeaks}
        collapsed={mixerCollapsed}
        masterOnly={mixerAutoCompact && !mixerCollapsed}
        onToggleCollapsed={toggleMixerCollapsed}
        onResizePointerDown={onMixerResizePointerDown}
        onSelectTrack={(id, opts) => setSession((s) => applySelectTracks(s, id, opts))}
        onVolume={(id, v) => setSession((s) => applyMixerVolume(s, id, v))}
        onPan={(id, pan) => setSession(applyCommand(session, { type: "setTrackPan", trackId: id, pan }))}
        onMasterVolume={(v) => setSession(applyMasterVolume(session, v))}
        onToggleMute={(id) => runCommand({ type: "toggleMute", trackId: id })}
        onToggleSolo={(id) => runCommand({ type: "toggleSolo", trackId: id })}
        collapsedGroupIds={collapsedGroupIds}
        onToggleGroupCollapsed={toggleGroupCollapsed}
        playing={session.playing}
        volumeWriteArmedIds={session.volumeWriteArmedIds}
        volumeWriteTrackId={session.volumeWriteGesture?.trackId ?? null}
        volumeWriteValue={session.volumeWriteGesture?.liveValue ?? null}
        onToggleVolumeWriteArm={(id) => runCommand({ type: "toggleVolumeWriteArm", trackId: id })}
        onVolumeWritePointerUp={() => {
          window.setTimeout(() => {
            setSession((s) => applyCommitVolumeWriteIfIdle(s, Date.now(), WRITE_POINTER_UP_MS));
          }, WRITE_POINTER_UP_MS);
        }}
      />
      </div>
      </div>
      </div>
      </div>

      <ExportDialog
        state={exportDialog}
        onCancel={cancelExport}
        onClose={dismissExport}
        onChange={setExportDialog}
        onStart={() => startExport("mp4")}
      />

      <ShortcutsOverlay open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />

      <footer className="status" data-testid="status">
        <span>{session.status}</span>
        {session.error ? <span className="err">{session.error}</span> : null}
        {(() => {
          const ids = selectionOf(session);
          if (ids.length >= 2) return <span>{ids.length} clips</span>;
          const selected = clipById(session.project, session.selectedClipId ?? "");
          if (!selected) return null;
          const asset = assetById(session.project, selected.assetId);
          return <span>{asset?.name ?? selected.id}</span>;
        })()}
      </footer>
    </div>
  );
}
