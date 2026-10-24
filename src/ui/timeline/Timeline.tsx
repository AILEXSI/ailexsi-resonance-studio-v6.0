import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import {
  clipEndMs,
  audioTrackIdsOf,
  clipIsLocked,
  isTrackId,
  kindOfTrack,
  projectDurationMs,
  trackById,
  trackIdsOf,
  type Clip,
  type Project,
  type TrackId,
  type VisualizerEvent,
  type VisualizerSceneId,
} from "../../core/models";
import { fadeHandlesVisible, fadesFromHandleDrag } from "../../core/fade-handles";
import { durationMsFromHandleDrag, transitionDurationSnapTargets } from "../../core/transition-handles";
import { listStackedEditPairs, type StackedOverlapMark } from "../../core/transition";
import { normalizeClipFades } from "../../core/fades";
import {
  MARQUEE_CLICK_SLOP_PX,
  clipsIntersectingMarquee,
  isMarqueeLane,
  marqueeLanesOf,
  type MarqueeLane,
} from "../../core/marquee";
import { abuttingNeighbor, collectSnapTargets, isSlideBlock, snapPlayheadSeek, snapTime } from "../../core/timeline";
import {
  DEFAULT_LANE_HEIGHT_PX,
  DEFAULT_LANE_LABEL_PX,
  GROUP_LANE_HEIGHT_PX,
  LANE_LABEL_MIN_PX,
  VOLUME_LANE_HEIGHT_PX,
  clampLaneHeightPx,
  clampLaneLabelPx,
  fixedLaneBoxStyle,
  heightGroupOfLane,
  laneHeaderPacksInline,
  type LaneHeightGroup,
  type LaneHeights,
} from "../../core/layout-prefs";
import { clampScrollMs, maxScrollMs, RULER_PAD_PX } from "../../core/zoom";
import { formatVisEventLabel, sceneAt, sceneShortName, visualizerEventsOf } from "../../core/visualizer";
import { VisSceneBrowser } from "../inspector/VisSceneBrowser";
import {
  VIS_BROWSER_PANEL_HEIGHT_EST,
  VIS_BROWSER_PANEL_WIDTH,
  clampVisBrowserPos,
  placeVisBrowserPanel,
  readVisBrowserPos,
  writeVisBrowserPos,
} from "../inspector/vis-browser-layout";
import { CLIP_MENU_SHORTCUTS } from "../shortcuts/labels";
import { AudioClipWave, VideoClipStrip } from "./ClipPreview";
import { buildRulerTicks } from "../../core/ruler";
import { isAssetDrag, mediaDropPlace, readAssetDrag } from "../../core/media";
import {
  arrangeRows,
  groupsOf,
  lastAudioChromeHost,
  type ArrangeRow,
} from "../../core/track-groups";
import { VolumeAutomationLane } from "./VolumeAutomationLane";
import { GroupCollapseIcon, GroupNameField, LaneGroupAssign } from "./TimelineLaneChrome";
import { msToWidth, msToX, xToMs } from "./timeline-math";
import { TrackHeaderOverflowButton, TrackHeaderOverflowMenu } from "./TrackHeaderOverflow";
import {
  OVERFLOW_MENU_FALLBACK_HEIGHT_PX,
  OVERFLOW_MENU_FALLBACK_WIDTH_PX,
  controlIsDirect,
  controlIsOverflowed,
  headerOverflowLabel,
  placeOverflowMenu,
  planTrackHeaderOverflow,
  resolveHeaderWidth,
  stabilizeHeaderWidth,
  type HeaderControlId,
  type OverflowMenuBox,
} from "./track-header-overflow";

export { RULER_PAD_PX };

/** Compatible V/A lane under the pointer (header or body). VIS is not a TrackId. */
function trackIdFromPoint(clientX: number, clientY: number): TrackId | undefined {
  const fromPoint = document.elementFromPoint;
  if (typeof fromPoint !== "function") return undefined;
  const hit = fromPoint.call(document, clientX, clientY);
  let node: Element | null = hit;
  while (node) {
    const raw = node.getAttribute("data-testid");
    if (!raw) {
      node = node.parentElement;
      continue;
    }
    const m = raw.match(/^lane-(.+)$/);
    if (m) {
      const captured = m[1]!;
      const id = captured.endsWith("-body") ? captured.slice(0, -5) : captured;
      if (isTrackId(id)) return id;
    }
    node = node.parentElement;
  }
  return undefined;
}

interface Props {
  project: Project;
  selectedClipId: string | null;
  selectedClipIds?: string[];
  selectedMarkerId?: string | null;
  selectedVis?: boolean;
  selectedVisEventId?: string | null;
  selectedVisEventIds?: string[];
  onSelect: (clipId: string | null, opts?: { toggle?: boolean; range?: boolean }) => void;
  onSelectMarker?: (markerId: string | null) => void;
  onMarkerMoveLive?: (markerId: string, timeMs: number) => void;
  onMarkerMoveCommit?: () => void;
  onDeleteMarker?: (markerId: string) => void;
  onPlayhead: (ms: number) => void;
  onMoveLive: (clipId: string, startMs: number, trackId?: TrackId, clipIds?: string[]) => void;
  onMoveCommit: () => void;
  onTrimLive: (
    clipId: string,
    edge: "in" | "out",
    nextEdgeMs: number,
    mode?: "lift" | "ripple" | "roll",
  ) => void;
  onTrimCommit: () => void;
  onSlipLive?: (clipId: string, deltaMs: number, clipIds?: readonly string[]) => void;
  onSlipCommit?: () => void;
  onSlideLive?: (clipId: string, deltaMs: number, clipIds?: readonly string[]) => void;
  onSlideCommit?: () => void;
  onFadesLive?: (clipId: string, fadeInMs: number, fadeOutMs: number) => void;
  onFadesCommit?: () => void;
  onTransitionDurationLive?: (durationMs: number, clipIds: readonly string[]) => void;
  onTransitionDurationCommit?: () => void;
  onTransitionAudioDurationLive?: (audioDurationMs: number, clipIds: readonly string[]) => void;
  onTransitionAudioDurationCommit?: () => void;
  onSelectClips?: (clipIds: readonly string[], opts?: { union?: boolean }) => void;
  onToggleMute: (trackId: TrackId) => void;
  onToggleSolo?: (trackId: TrackId) => void;
  selectedTrackIds?: readonly TrackId[];
  onSelectTrack?: (trackId: TrackId, opts?: { toggle?: boolean }) => void;
  onToggleVisualizerMute: () => void;
  onCycleVisualizerScene: () => void;
  onSetVisualizerScene?: (sceneId: VisualizerSceneId) => void;
  onSelectVis?: () => void;
  onSelectVisEvent?: (eventId: string) => void;
  onInsertVisEvent?: () => void;
  onVisEventMoveLive?: (eventId: string, startMs: number) => void;
  onVisEventMoveCommit?: () => void;
  onVisEventStretchLive?: (eventId: string, edge: "in" | "out", nextEdgeMs: number) => void;
  onVisEventStretchCommit?: () => void;
  onSetFrontVideoTrack?: (trackId: "V1" | "V2") => void;
  /** Arrange = all tracks. Cutter = video only. VIS overlay is separate. */
  visibleTrackIds?: TrackId[];
  onSplitHere: (clipId: string, timeMs: number) => void;
  onCut: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onDuplicate?: () => void;
  onDelete: () => void;
  onRippleDelete?: () => void;
  onLiftRange?: () => void;
  onExtractRange?: () => void;
  onRelink?: (clipIds?: readonly string[]) => void;
  onCloseGap?: () => void;
  onRippleTrimToPlayhead?: (edge: "in" | "out", timeMs?: number) => void;
  onTrimToPlayhead?: (edge: "in" | "out", timeMs?: number) => void;
  onFadeEdge?: (edge: "in" | "out") => void;
  onAddCrossfade?: () => void;
  onToggleReverse?: () => void;
  onFreezeFrame?: () => void;
  onSetRate?: (rate: number) => void;
  onSelectAll?: () => void;
  onSelectAllOnTrack?: () => void;
  onSetClipsEnabled?: (enabled: boolean) => void;
  onSetClipsLocked?: (locked: boolean) => void;
  onZoom: (zoom: number, timelineWidthPx: number) => void;
  onFit: (timelineWidthPx: number) => void;
  onViewport?: (timelineWidthPx: number) => void;
  onScroll: (ms: number) => void;
  onLoopClick: (ms: number) => void;
  onLoopInLive: (ms: number) => void;
  onLoopOutLive: (ms: number) => void;
  onLoopMoveLive: (deltaMs: number) => void;
  onLoopCommit: () => void;
  laneLabelPx?: number;
  laneHeights?: LaneHeights;
  onLaneLabelPx?: (px: number) => void;
  onLaneHeight?: (group: LaneHeightGroup, px: number) => void;
  /** Bin drag onto Arrange — same place command as MediaBrowser onPlace. */
  onPlaceAsset?: (assetId: string, trackId: TrackId, startMs: number) => void;
  onAddAudioTrack?: () => void;
  onRemoveAudioTrack?: () => void;
  canAddAudioTrack?: boolean;
  canRemoveAudioTrack?: boolean;
  collapsedGroupIds?: readonly string[];
  onToggleGroupCollapsed?: (groupId: string) => void;
  onCreateTrackGroup?: (trackIds?: TrackId[]) => void;
  onAssignTracksToGroup?: (trackIds: TrackId[], groupId: string | null) => void;
  onRenameTrackGroup?: (groupId: string, name: string) => void;
  openVolumeLaneIds?: readonly TrackId[];
  selectedVolumeAutomation?: { trackId: TrackId; timeMs: number } | null;
  onToggleVolumeLane?: (trackId: TrackId) => void;
  onSetVolumeAutomationEnabled?: (trackId: TrackId, enabled: boolean) => void;
  onSelectVolumeAutomationPoint?: (trackId: TrackId, timeMs: number | null) => void;
  onAddVolumeAutomationPoint?: (trackId: TrackId, timeMs: number, value: number) => void;
  onDeleteVolumeAutomationPoint?: (trackId: TrackId, timeMs: number) => void;
  onVolumeAutomationPointLive?: (
    trackId: TrackId,
    fromTimeMs: number,
    timeMs: number,
    value: number,
  ) => void;
  onVolumeAutomationPointCommit?: () => void;
  volumeWriteArmedIds?: readonly TrackId[];
  onToggleVolumeWriteArm?: (trackId: TrackId) => void;
}

interface ClipMenu {
  x: number;
  y: number;
  clipId: string;
  timeMs: number;
}

interface MarkerMenu {
  x: number;
  y: number;
  markerId: string;
}

interface VisEventMenu {
  x: number;
  y: number;
  eventId: string;
}

export function Timeline({
  project,
  selectedClipId,
  selectedClipIds,
  selectedMarkerId = null,
  selectedVis = false,
  selectedVisEventId = null,
  selectedVisEventIds,
  onSelect,
  onSelectMarker,
  onMarkerMoveLive,
  onMarkerMoveCommit,
  onDeleteMarker,
  onPlayhead,
  onMoveLive,
  onMoveCommit,
  onTrimLive,
  onTrimCommit,
  onSlipLive,
  onSlipCommit,
  onSlideLive,
  onSlideCommit,
  onFadesLive,
  onFadesCommit,
  onTransitionDurationLive,
  onTransitionDurationCommit,
  onTransitionAudioDurationLive,
  onTransitionAudioDurationCommit,
  onSelectClips,
  onToggleMute,
  onToggleSolo,
  selectedTrackIds,
  onSelectTrack,
  onToggleVisualizerMute,
  onCycleVisualizerScene,
  onSetVisualizerScene,
  onSelectVis,
  onSelectVisEvent,
  onInsertVisEvent,
  onVisEventMoveLive,
  onVisEventMoveCommit,
  onVisEventStretchLive,
  onVisEventStretchCommit,
  onSetFrontVideoTrack,
  visibleTrackIds,
  onSplitHere,
  onCut,
  onCopy,
  onPaste,
  onDuplicate,
  onDelete,
  onRippleDelete,
  onLiftRange,
  onExtractRange,
  onRelink,
  onCloseGap,
  onRippleTrimToPlayhead,
  onTrimToPlayhead,
  onFadeEdge,
  onAddCrossfade,
  onToggleReverse,
  onFreezeFrame,
  onSetRate,
  onSelectAll,
  onSelectAllOnTrack,
  onSetClipsEnabled,
  onSetClipsLocked,
  onZoom,
  onFit,
  onViewport,
  onScroll,
  onLoopClick,
  onLoopInLive,
  onLoopOutLive,
  onLoopMoveLive,
  onLoopCommit,
  laneLabelPx = DEFAULT_LANE_LABEL_PX,
  laneHeights,
  onLaneLabelPx,
  onLaneHeight,
  onPlaceAsset,
  onAddAudioTrack,
  onRemoveAudioTrack,
  canAddAudioTrack = true,
  canRemoveAudioTrack = false,
  collapsedGroupIds,
  onToggleGroupCollapsed,
  onCreateTrackGroup,
  onAssignTracksToGroup,
  onRenameTrackGroup,
  openVolumeLaneIds,
  selectedVolumeAutomation,
  onToggleVolumeLane,
  onSetVolumeAutomationEnabled,
  onSelectVolumeAutomationPoint,
  onAddVolumeAutomationPoint,
  onDeleteVolumeAutomationPoint,
  onVolumeAutomationPointLive,
  onVolumeAutomationPointCommit,
  volumeWriteArmedIds,
  onToggleVolumeWriteArm,
}: Props) {
  const timelineRef = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const lanesRef = useRef<HTMLDivElement>(null);
  const audioCountRef = useRef(audioTrackIdsOf(project).length);
  const dragKindRef = useRef<
    | "move"
    | "trim"
    | "fade"
    | "slip"
    | "slide"
    | "marquee"
    | "loop-in"
    | "loop-out"
    | "loop-move"
    | "marker"
    | "vis-move"
    | "vis-trim"
    | "transition-duration"
    | "lane-label"
    | "lane-height"
    | null
  >(null);
  const [menu, setMenu] = useState<ClipMenu | null>(null);
  const [markerMenu, setMarkerMenu] = useState<MarkerMenu | null>(null);
  const [visMenu, setVisMenu] = useState<VisEventMenu | null>(null);
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(
    null,
  );
  const [viewWidth, setViewWidth] = useState(1000);
  const [visBrowserOpen, setVisBrowserOpen] = useState(false);
  const [visBrowserPos, setVisBrowserPos] = useState({ left: 108, top: 72 });
  const [headerWidthPx, setHeaderWidthPx] = useState(laneLabelPx);
  const [overflowOpenId, setOverflowOpenId] = useState<string | null>(null);
  const [overflowPos, setOverflowPos] = useState<OverflowMenuBox>({
    left: 8,
    top: 8,
    maxHeight: 0,
    placement: "below",
    constrained: false,
  });
  const overflowAnchorRef = useRef<HTMLElement | null>(null);
  const visHeaderRef = useRef<HTMLDivElement>(null);
  const visBrowserRef = useRef<HTMLDivElement>(null);
  const visBrowserDragRef = useRef<{ dx: number; dy: number } | null>(null);
  const visHeaderSceneId =
    (selectedVisEventId
      ? visualizerEventsOf(project).find((e) => e.id === selectedVisEventId)?.sceneId
      : undefined) ??
    sceneAt(project, project.playheadMs) ??
    project.visualizer.sceneId;

  const visBrowserViewport = () => ({
    width: window.innerWidth || 1024,
    height: window.innerHeight || 768,
  });

  const visBrowserPanelSize = () => {
    const el = visBrowserRef.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        return { width: rect.width, height: rect.height };
      }
    }
    return { width: VIS_BROWSER_PANEL_WIDTH, height: VIS_BROWSER_PANEL_HEIGHT_EST };
  };

  const commitVisBrowserPos = (pos: { left: number; top: number }) => {
    const next = clampVisBrowserPos(pos, visBrowserPanelSize(), visBrowserViewport());
    setVisBrowserPos(next);
    writeVisBrowserPos(next);
  };

  const placeVisBrowser = () => {
    const rect = visHeaderRef.current?.getBoundingClientRect();
    const viewport = visBrowserViewport();
    const panel = visBrowserPanelSize();
    const arrangerHeight = lanesRef.current?.clientHeight ?? timelineRef.current?.clientHeight;
    if (!rect || (rect.width === 0 && rect.height === 0)) {
      commitVisBrowserPos(
        placeVisBrowserPanel({
          header: { top: 72, right: 100, bottom: 120 },
          panel,
          viewport,
          arrangerHeight,
          lastPos: readVisBrowserPos(),
        }),
      );
      return;
    }
    commitVisBrowserPos(
      placeVisBrowserPanel({
        header: { top: rect.top, right: rect.right, bottom: rect.bottom },
        panel,
        viewport,
        arrangerHeight,
        lastPos: readVisBrowserPos(),
      }),
    );
  };

  const toggleVisBrowser = () => {
    if (!onSetVisualizerScene) return;
    if (visBrowserOpen) {
      setVisBrowserOpen(false);
      return;
    }
    placeVisBrowser();
    setVisBrowserOpen(true);
  };
  const duration = Math.max(10_000, projectDurationMs(project) + 2000);
  const panMaxMs = maxScrollMs(
    projectDurationMs(project),
    project.zoomPxPerSec,
    viewWidth,
    laneLabelPx,
  );
  const measureWidth = (): number => timelineRef.current?.clientWidth ?? 1000;

  useEffect(() => {
    const el = timelineRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setViewWidth(el.clientWidth || 1000));
    ro.observe(el);
    setViewWidth(el.clientWidth || 1000);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = visHeaderRef.current;
    const apply = (raw: number) => {
      const resolved = resolveHeaderWidth(raw, laneLabelPx);
      setHeaderWidthPx((prev) => stabilizeHeaderWidth(prev, resolved));
    };
    apply(el?.clientWidth ?? 0);
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => apply(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [laneLabelPx]);

  useEffect(() => {
    setOverflowOpenId(null);
  }, [headerWidthPx]);

  useEffect(() => {
    if (!overflowOpenId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOverflowOpenId(null);
    };
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if ((t as Element).closest?.("[data-header-overflow-root]")) return;
      if ((t as Element).closest?.("[data-header-slot=overflow]")) return;
      setOverflowOpenId(null);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer, true);
    };
  }, [overflowOpenId]);

  useEffect(() => {
    onViewport?.(viewWidth);
  }, [viewWidth, onViewport]);

  useEffect(() => {
    if (!visBrowserOpen) return;
    commitVisBrowserPos(visBrowserPos);
  }, [visBrowserOpen]);

  useEffect(() => {
    if (!visBrowserOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setVisBrowserOpen(false);
    };
    const onPointer = (e: PointerEvent) => {
      if (visBrowserDragRef.current) return;
      const t = e.target as Node | null;
      if (!t) return;
      if (visHeaderRef.current?.contains(t)) return;
      if (visBrowserRef.current?.contains(t)) return;
      setVisBrowserOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer, true);
    };
  }, [visBrowserOpen]);

  const onVisBrowserDragPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    if (!(e.target as HTMLElement).closest("[data-testid=vis-lane-browser-title]")) return;
    e.preventDefault();
    e.stopPropagation();
    const el = visBrowserRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    visBrowserDragRef.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    el.setPointerCapture?.(e.pointerId);
  };

  const onVisBrowserDragPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    if (!visBrowserDragRef.current) return;
    commitVisBrowserPos({
      left: e.clientX - visBrowserDragRef.current.dx,
      top: e.clientY - visBrowserDragRef.current.dy,
    });
  };

  const onVisBrowserDragPointerUp = () => {
    visBrowserDragRef.current = null;
  };

  const audioCount = audioTrackIdsOf(project).length;
  useEffect(() => {
    if (audioCount === audioCountRef.current) return;
    audioCountRef.current = audioCount;
    const lanes = lanesRef.current;
    const lastId = audioTrackIdsOf(project).at(-1);
    const last = lastId ? lanes?.querySelector<HTMLElement>(`[data-testid="lane-${lastId}"]`) : null;
    last?.scrollIntoView({ block: "end", inline: "nearest" });
    if (lanes) lanes.scrollTop = lanes.scrollHeight;
  }, [audioCount, project]);

  const ticks = useMemo(
    () =>
      buildRulerTicks({
        zoomPxPerSec: project.zoomPxPerSec,
        durationMs: duration,
        scrollMs: project.scrollMs,
        viewWidthPx: Math.max(200, viewWidth - 56),
      }),
    [duration, project.scrollMs, project.zoomPxPerSec, viewWidth],
  );

  useEffect(() => {
    const el = timelineRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const width = el.clientWidth || 1000;
      const horiz = Math.abs(e.deltaX) > Math.abs(e.deltaY);
      if (e.shiftKey || horiz) {
        const deltaPx = horiz ? e.deltaX : e.deltaY;
        const deltaMs = (deltaPx / Math.max(project.zoomPxPerSec, 1e-6)) * 1000;
        onScroll(
          clampScrollMs(
            project.scrollMs + deltaMs,
            projectDurationMs(project),
            project.zoomPxPerSec,
            width,
            laneLabelPx,
          ),
        );
        return;
      }
      const next = e.deltaY > 0 ? project.zoomPxPerSec / 1.2 : project.zoomPxPerSec * 1.2;
      onZoom(next, width);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [laneLabelPx, onScroll, onZoom, project.scrollMs, project.zoomPxPerSec, project]);

  const timeFromEvent = (clientX: number, contentEl?: HTMLElement | null): number => {
    const el = contentEl ?? bodyRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    return Math.max(0, xToMs(clientX - rect.left, project.zoomPxPerSec, project.scrollMs));
  };

  const snapIf = (ms: number, ignore: Array<"in" | "out"> = []): number => {
    if (!project.snap) return Math.max(0, ms);
    const targets = collectSnapTargets(project).filter((t) => !ignore.includes(t.kind as "in" | "out"));
    return Math.max(0, snapTime(ms, targets).timeMs);
  };

  const onRulerPointer = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    setMenu(null);
    setMarkerMenu(null);
    setVisMenu(null);
    setOverflowOpenId(null);
    onPlayhead(snapPlayheadSeek(project, timeFromEvent(e.clientX, e.currentTarget)));
  };

  const onEmptyContext = (e: ReactMouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    setMenu(null);
    setMarkerMenu(null);
    setVisMenu(null);
    setOverflowOpenId(null);
    onLoopClick(snapIf(timeFromEvent(e.clientX, e.currentTarget)));
  };

  const onLaneBodyPointer = (e: ReactPointerEvent<HTMLDivElement>, lane: MarqueeLane) => {
    if (e.button !== 0) return;
    if (dragKindRef.current) return;
    setMenu(null);
    setMarkerMenu(null);
    setVisMenu(null);
    const originEl = e.currentTarget;
    onPlayhead(snapPlayheadSeek(project, timeFromEvent(e.clientX, originEl)));
    dragKindRef.current = "marquee";
    const originX = e.clientX;
    const originY = e.clientY;
    const originTime = timeFromEvent(e.clientX, originEl);
    const union = e.shiftKey;
    let lastLane: MarqueeLane = lane;
    let lastTime = originTime;
    let moved = false;

    const localOf = (clientX: number, clientY: number) => {
      const r = timelineRef.current?.getBoundingClientRect();
      return { x: clientX - (r?.left ?? 0), y: clientY - (r?.top ?? 0) };
    };
    const originLocal = localOf(originX, originY);

    const laneAt = (clientX: number, clientY: number): MarqueeLane => {
      try {
        const probe = document.elementFromPoint;
        const hit = typeof probe === "function" ? probe.call(document, clientX, clientY) : null;
        const node = hit instanceof Element ? hit.closest("[data-marquee-lane]") : null;
        const id = node?.getAttribute("data-marquee-lane");
        if (isMarqueeLane(id)) return id;
      } catch {
        /* jsdom has no elementFromPoint */
      }
      return lastLane;
    };

    const move = (ev: PointerEvent) => {
      if (dragKindRef.current !== "marquee") return;
      if (
        Math.abs(ev.clientX - originX) > MARQUEE_CLICK_SLOP_PX ||
        Math.abs(ev.clientY - originY) > MARQUEE_CLICK_SLOP_PX
      ) {
        moved = true;
      }
      lastTime = timeFromEvent(ev.clientX, originEl);
      lastLane = laneAt(ev.clientX, ev.clientY);
      if (moved) {
        const p = localOf(ev.clientX, ev.clientY);
        setMarquee({ x0: originLocal.x, y0: originLocal.y, x1: p.x, y1: p.y });
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      dragKindRef.current = null;
      setMarquee(null);
      if (!moved) {
        if (lane === "VIS") {
          if (onInsertVisEvent) onInsertVisEvent();
          else onSelectVis?.();
        } else onSelect(null);
        return;
      }
      const hits = clipsIntersectingMarquee(
        project.clips,
        {
          aMs: originTime,
          bMs: lastTime,
          aLane: lane,
          bLane: lastLane,
        },
        marqueeLanesOf(project),
      );
      onSelectClips?.(
        hits.map((c) => c.id),
        { union },
      );
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const onMarkerPointerDown = (e: ReactPointerEvent, markerId: string, timeMs: number) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    setMenu(null);
    setMarkerMenu(null);
    if (dragKindRef.current) return;
    dragKindRef.current = "marker";
    onSelectMarker?.(markerId);
    const originX = e.clientX;
    const originTime = timeMs;
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (dragKindRef.current !== "marker") return;
      const dx = ev.clientX - originX;
      if (Math.abs(dx) > 1) moved = true;
      const next = Math.max(0, originTime + (dx / project.zoomPxPerSec) * 1000);
      onMarkerMoveLive?.(markerId, next);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      dragKindRef.current = null;
      if (moved) onMarkerMoveCommit?.();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const onMarkerContext = (e: ReactMouseEvent, markerId: string) => {
    e.preventDefault();
    e.stopPropagation();
    onSelectMarker?.(markerId);
    setMenu(null);
    setMarkerMenu({ x: e.clientX, y: e.clientY, markerId });
  };

  const selectedIds = selectedClipIds?.length
    ? selectedClipIds
    : selectedClipId
      ? [selectedClipId]
      : [];
  const primaryId = selectedClipId ?? selectedIds[0] ?? null;
  const overlapMarks = useMemo(() => listStackedEditPairs(project), [project]);

  const onClipPointerDown = (e: ReactPointerEvent, clip: Clip) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    setMenu(null);
    setMarkerMenu(null);
    if ((e.ctrlKey || e.metaKey) && e.altKey) {
      if (clipIsLocked(clip)) {
        if (!selectedIds.includes(clip.id)) onSelect(clip.id);
        return;
      }
      if (dragKindRef.current) return;
      const inSelectedBlock = selectedIds.includes(clip.id) && isSlideBlock(project, selectedIds);
      if (!inSelectedBlock && !selectedIds.includes(clip.id)) onSelect(clip.id);
      const slidingIds = inSelectedBlock ? selectedIds : [clip.id];
      dragKindRef.current = "slide";
      const originX = e.clientX;
      const move = (ev: PointerEvent) => {
        if (dragKindRef.current !== "slide") return;
        const deltaMs = ((ev.clientX - originX) / project.zoomPxPerSec) * 1000;
        onSlideLive?.(clip.id, deltaMs, slidingIds);
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        dragKindRef.current = null;
        onSlideCommit?.();
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      onSelect(clip.id, { toggle: true });
      return;
    }
    if (e.shiftKey) {
      onSelect(clip.id, { range: true });
      return;
    }
    if (e.altKey) {
      if (clipIsLocked(clip)) {
        if (!selectedIds.includes(clip.id)) onSelect(clip.id);
        return;
      }
      if (dragKindRef.current) return;
      if (!selectedIds.includes(clip.id)) onSelect(clip.id);
      const slippingIds =
        selectedIds.includes(clip.id) && selectedIds.length >= 2 ? selectedIds : [clip.id];
      dragKindRef.current = "slip";
      const originX = e.clientX;
      const move = (ev: PointerEvent) => {
        if (dragKindRef.current !== "slip") return;
        const deltaMs = ((ev.clientX - originX) / project.zoomPxPerSec) * 1000;
        onSlipLive?.(clip.id, deltaMs, slippingIds);
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        dragKindRef.current = null;
        onSlipCommit?.();
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      return;
    }
    if (dragKindRef.current) return;
    const inGroup = selectedIds.includes(clip.id);
    if (!inGroup) onSelect(clip.id);
    if (clipIsLocked(clip)) return;
    const movingIds = inGroup ? selectedIds : [clip.id];
    dragKindRef.current = "move";
    const originX = e.clientX;
    const originStart = clip.startMs;
    const originY = e.clientY;
    const originTrack = clip.trackId;
    const move = (ev: PointerEvent) => {
      if (dragKindRef.current !== "move") return;
      const dx = ev.clientX - originX;
      const nextStart = originStart + (dx / project.zoomPxPerSec) * 1000;
      const dy = ev.clientY - originY;
      let trackId: TrackId | undefined;
      if (movingIds.length === 1) {
        const over = trackIdFromPoint(ev.clientX, ev.clientY);
        if (over && kindOfTrack(over) === kindOfTrack(originTrack)) trackId = over;
        else if (Math.abs(dy) > 24) {
          const ids = trackIdsOf(project);
          const idx = ids.indexOf(originTrack);
          const next = ids[idx + (dy > 0 ? 1 : -1)];
          if (next && kindOfTrack(next) === kindOfTrack(originTrack)) trackId = next;
        }
      }
      onMoveLive(clip.id, nextStart, trackId, movingIds);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      dragKindRef.current = null;
      onMoveCommit();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const onTrimPointerDown = (e: ReactPointerEvent, clip: Clip, edge: "in" | "out") => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    setMenu(null);
    if (clipIsLocked(clip)) {
      onSelect(clip.id);
      return;
    }
    if (dragKindRef.current) return;
    dragKindRef.current = "trim";
    onSelect(clip.id);
    const originX = e.clientX;
    const originEdge = edge === "in" ? clip.startMs : clipEndMs(clip);
    const dimmed = clip.enabled === false;
    const mode: "lift" | "ripple" | "roll" = dimmed
      ? "lift"
      : e.shiftKey
        ? "ripple"
        : abuttingNeighbor(project, clip.id, edge)
          ? "roll"
          : "lift";
    const move = (ev: PointerEvent) => {
      if (dragKindRef.current !== "trim") return;
      const dx = ev.clientX - originX;
      const nextEdge = originEdge + (dx / project.zoomPxPerSec) * 1000;
      onTrimLive(clip.id, edge, nextEdge, dimmed ? "lift" : ev.shiftKey ? "ripple" : mode);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      dragKindRef.current = null;
      onTrimCommit();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const onVisEventPointerDown = (e: ReactPointerEvent, event: VisualizerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    setMenu(null);
    setMarkerMenu(null);
    setVisMenu(null);
    // Event fill is the VIS lane — seek like empty V1/V2/A body clicks (P86 snap).
    const laneBody =
      (e.currentTarget.closest("[data-testid='lane-VIS-body']") as HTMLElement | null) ??
      bodyRef.current;
    onPlayhead(snapPlayheadSeek(project, timeFromEvent(e.clientX, laneBody)));
    if (dragKindRef.current) return;
    onSelectVisEvent?.(event.id);
    if (!onVisEventMoveLive) return;
    dragKindRef.current = "vis-move";
    const originX = e.clientX;
    const originStart = event.startMs;
    const move = (ev: PointerEvent) => {
      if (dragKindRef.current !== "vis-move") return;
      const nextStart = originStart + ((ev.clientX - originX) / project.zoomPxPerSec) * 1000;
      onVisEventMoveLive(event.id, nextStart);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      dragKindRef.current = null;
      onVisEventMoveCommit?.();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const onVisEventTrimPointerDown = (
    e: ReactPointerEvent,
    event: VisualizerEvent,
    edge: "in" | "out",
  ) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    setMenu(null);
    setMarkerMenu(null);
    setVisMenu(null);
    if (dragKindRef.current) return;
    onSelectVisEvent?.(event.id);
    if (!onVisEventStretchLive) return;
    dragKindRef.current = "vis-trim";
    const originX = e.clientX;
    const originEdge = edge === "in" ? event.startMs : event.startMs + event.durationMs;
    const move = (ev: PointerEvent) => {
      if (dragKindRef.current !== "vis-trim") return;
      const nextEdge = originEdge + ((ev.clientX - originX) / project.zoomPxPerSec) * 1000;
      onVisEventStretchLive(event.id, edge, nextEdge);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      dragKindRef.current = null;
      onVisEventStretchCommit?.();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const onFadePointerDown = (e: ReactPointerEvent, clip: Clip, edge: "in" | "out") => {
    if (e.button !== 0) return;
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    e.stopPropagation();
    e.preventDefault();
    setMenu(null);
    if (dragKindRef.current) return;
    dragKindRef.current = "fade";
    onSelect(clip.id);
    const originX = e.clientX;
    const originIn = clip.fadeInMs;
    const originOut = clip.fadeOutMs;
    const move = (ev: PointerEvent) => {
      if (dragKindRef.current !== "fade") return;
      const next = fadesFromHandleDrag(
        originIn,
        originOut,
        clip.durationMs,
        ev.clientX - originX,
        project.zoomPxPerSec,
        edge,
      );
      onFadesLive?.(clip.id, next.fadeInMs, next.fadeOutMs);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      dragKindRef.current = null;
      onFadesCommit?.();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const onTransitionDurationPointerDown = (
    e: ReactPointerEvent,
    mark: StackedOverlapMark,
    kind: "video" | "audio",
  ) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    setMenu(null);
    if (dragKindRef.current) return;
    dragKindRef.current = "transition-duration";
    const clipIds = [mark.sourceA.id, mark.sourceB.id];
    onSelectClips?.(clipIds);
    const originX = e.clientX;
    const originMs = kind === "video" ? mark.durationMs : mark.audioDurationMs;
    const targets = project.snap ? transitionDurationSnapTargets(project) : [];
    const move = (ev: PointerEvent) => {
      if (dragKindRef.current !== "transition-duration") return;
      const next = durationMsFromHandleDrag({
        originDurationMs: originMs,
        startMs: mark.startMs,
        deltaPx: ev.clientX - originX,
        zoomPxPerSec: project.zoomPxPerSec,
        snap: project.snap,
        snapTargets: targets,
      });
      if (kind === "video") onTransitionDurationLive?.(next, clipIds);
      else onTransitionAudioDurationLive?.(next, clipIds);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      dragKindRef.current = null;
      if (kind === "video") onTransitionDurationCommit?.();
      else onTransitionAudioDurationCommit?.();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const heights: LaneHeights = laneHeights ?? {
    vis: DEFAULT_LANE_HEIGHT_PX,
    video: DEFAULT_LANE_HEIGHT_PX,
    audio: DEFAULT_LANE_HEIGHT_PX,
  };
  const visHeaderInline = laneHeaderPacksInline(heights.vis);
  const visHeaderPresent: HeaderControlId[] = ["identity", "mute", "scene"];
  const visHeaderPlan = planTrackHeaderOverflow({
    kind: "vis",
    widthPx: headerWidthPx,
    pack: visHeaderInline ? "inline" : "stack",
    present: visHeaderPresent,
  });
  const headerPlanFor = (
    kind: "vis" | "video" | "audio",
    present: readonly HeaderControlId[],
    pack: boolean,
  ) =>
    planTrackHeaderOverflow({
      kind,
      widthPx: headerWidthPx,
      pack: pack ? "inline" : "stack",
      present,
    });
  const placeOpenOverflow = (id: string | null = overflowOpenId) => {
    const anchor = overflowAnchorRef.current;
    if (!id || !anchor) return;
    const trigger = anchor.getBoundingClientRect();
    const menuEl = document.querySelector(`[data-testid="lane-overflow-menu-${id}"]`) as HTMLElement | null;
    const menuRect = menuEl && !menuEl.hidden ? menuEl.getBoundingClientRect() : null;
    const naturalHeight = menuEl && !menuEl.hidden ? menuEl.scrollHeight : 0;
    setOverflowPos(
      placeOverflowMenu({
        trigger,
        menu: {
          width: menuRect && menuRect.width > 0 ? menuRect.width : OVERFLOW_MENU_FALLBACK_WIDTH_PX,
          height: naturalHeight > 0 ? naturalHeight : OVERFLOW_MENU_FALLBACK_HEIGHT_PX,
        },
        viewport: {
          width: window.innerWidth || 1024,
          height: window.innerHeight || 768,
        },
      }),
    );
  };

  const toggleOverflow = (id: string, anchor?: HTMLElement) => {
    setMenu(null);
    setMarkerMenu(null);
    setVisMenu(null);
    setOverflowOpenId((cur) => {
      if (cur === id) {
        overflowAnchorRef.current = null;
        return null;
      }
      overflowAnchorRef.current = anchor ?? overflowAnchorRef.current;
      return id;
    });
  };

  useLayoutEffect(() => {
    if (!overflowOpenId) return;
    placeOpenOverflow(overflowOpenId);
    const frame = requestAnimationFrame(() => placeOpenOverflow(overflowOpenId));
    return () => cancelAnimationFrame(frame);
  }, [overflowOpenId]);

  useEffect(() => {
    if (!overflowOpenId) return;
    const onReposition = () => placeOpenOverflow(overflowOpenId);
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [overflowOpenId]);

  const onLaneLabelSplitterDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    setMenu(null);
    if (dragKindRef.current) return;
    dragKindRef.current = "lane-label";
    const originX = e.clientX;
    const origin = laneLabelPx;
    const move = (ev: PointerEvent) => {
      if (dragKindRef.current !== "lane-label") return;
      onLaneLabelPx?.(clampLaneLabelPx(origin + (ev.clientX - originX)));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      dragKindRef.current = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const onLaneHeightPointerDown = (e: ReactPointerEvent, group: LaneHeightGroup) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    setMenu(null);
    if (dragKindRef.current) return;
    dragKindRef.current = "lane-height";
    const originY = e.clientY;
    const origin = heights[group];
    const move = (ev: PointerEvent) => {
      if (dragKindRef.current !== "lane-height") return;
      onLaneHeight?.(group, clampLaneHeightPx(origin + (ev.clientY - originY)));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      dragKindRef.current = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const laneLabelSplitter = (
    <div
      className="lane-label-splitter"
      data-testid="lane-label-splitter"
      title="Resize headers"
      onPointerDown={onLaneLabelSplitterDown}
    />
  );

  const onLoopHandlePointerDown = (e: ReactPointerEvent, edge: "in" | "out") => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    setMenu(null);
    if (dragKindRef.current) return;
    const originX = e.clientX;
    const origin = edge === "in" ? project.inPointMs : project.outPointMs;
    if (origin == null) return;
    dragKindRef.current = edge === "in" ? "loop-in" : "loop-out";
    const kind = dragKindRef.current;
    const move = (ev: PointerEvent) => {
      if (dragKindRef.current !== kind) return;
      const dx = ev.clientX - originX;
      const next = origin + (dx / project.zoomPxPerSec) * 1000;
      const snapped = snapIf(next, [edge]);
      if (edge === "in") onLoopInLive(snapped);
      else onLoopOutLive(snapped);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      dragKindRef.current = null;
      onLoopCommit();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const onLoopRangePointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    setMenu(null);
    if (dragKindRef.current) return;
    if (project.inPointMs == null || project.outPointMs == null) return;
    dragKindRef.current = "loop-move";
    const originX = e.clientX;
    const originIn = project.inPointMs;
    const move = (ev: PointerEvent) => {
      if (dragKindRef.current !== "loop-move") return;
      const dx = ev.clientX - originX;
      let delta = (dx / project.zoomPxPerSec) * 1000;
      let nextIn = originIn + delta;
      if (project.snap) {
        nextIn = snapIf(nextIn, ["in", "out"]);
        delta = nextIn - originIn;
      }
      onLoopMoveLive(delta);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      dragKindRef.current = null;
      onLoopCommit();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const onClipContext = (e: ReactMouseEvent, clip: Clip) => {
    e.preventDefault();
    e.stopPropagation();
    onSelect(clip.id);
    setMarkerMenu(null);
    setOverflowOpenId(null);
    setMenu({
      x: e.clientX,
      y: e.clientY,
      clipId: clip.id,
      timeMs: snapPlayheadSeek(project, timeFromEvent(e.clientX, bodyRef.current)),
    });
  };

  const range = project.inPointMs != null && project.outPointMs != null
    ? {
        left: msToX(project.inPointMs, project.zoomPxPerSec, project.scrollMs),
        width: msToWidth(project.outPointMs - project.inPointMs, project.zoomPxPerSec),
      }
    : null;

  const loopOverlay = (interactive: boolean) =>
    range ? (
      <>
        <div
          className={interactive ? "in-out interactive" : "in-out"}
          data-testid={interactive ? "loop-range" : undefined}
          style={{ left: range.left, width: range.width }}
          onPointerDown={interactive ? onLoopRangePointerDown : undefined}
        />
        {interactive ? (
          <>
            <div
              className="loop-handle in"
              data-testid="loop-handle-in"
              style={{ left: range.left }}
              onPointerDown={(e) => onLoopHandlePointerDown(e, "in")}
            />
            <div
              className="loop-handle out"
              data-testid="loop-handle-out"
              style={{ left: range.left + range.width }}
              onPointerDown={(e) => onLoopHandlePointerDown(e, "out")}
            />
          </>
        ) : null}
      </>
    ) : null;

  return (
    <section
      ref={timelineRef}
      className="timeline"
      data-testid="timeline"
      onDragOver={(e) => {
        if (!onPlaceAsset || !isAssetDrag(e.dataTransfer)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDrop={(e) => {
        if (!onPlaceAsset) return;
        const assetId = readAssetDrag(e.dataTransfer);
        if (!assetId) return;
        const asset = project.assets.find((a) => a.id === assetId);
        if (!asset) return;
        const over = trackIdFromPoint(e.clientX, e.clientY);
        const body = over
          ? (e.currentTarget.querySelector(`[data-testid="lane-${over}-body"]`) as HTMLElement | null)
          : null;
        const rect = body?.getBoundingClientRect();
        const x = rect ? e.clientX - rect.left : 0;
        const startMs = Math.max(0, xToMs(x, project.zoomPxPerSec, project.scrollMs));
        const placed = mediaDropPlace({
          assetId,
          assetKind: asset.kind,
          overTrackId: over,
          startMs,
        });
        if (!placed) return;
        e.preventDefault();
        onPlaceAsset(placed.assetId, placed.trackId, placed.startMs);
      }}
      style={
        {
          "--lane-label-px": `${laneLabelPx}px`,
          "--lane-label-min": `${LANE_LABEL_MIN_PX}px`,
          "--lane-height-vis": `${heights.vis}px`,
          "--lane-height-video": `${heights.video}px`,
          "--lane-height-audio": `${heights.audio}px`,
          "--lane-height-volume": `${VOLUME_LANE_HEIGHT_PX}px`,
          "--lane-height-group": `${GROUP_LANE_HEIGHT_PX}px`,
        } as CSSProperties
      }
    >
      <div className="timeline-tools">
        <button
          type="button"
          data-testid="timeline-zoom-out"
          onClick={() => onZoom(project.zoomPxPerSec / 1.2, measureWidth())}
        >
          −
        </button>
        <button
          type="button"
          data-testid="timeline-zoom-in"
          onClick={() => onZoom(project.zoomPxPerSec * 1.2, measureWidth())}
        >
          +
        </button>
        <button type="button" data-testid="timeline-fit" onClick={() => onFit(measureWidth())}>
          Fit
        </button>
        <span className="timeline-zoom">
          {project.zoomPxPerSec < 10
            ? project.zoomPxPerSec.toFixed(1)
            : Math.round(project.zoomPxPerSec)}{" "}
          px/s
        </span>
        <label>
          Pan
          <input
            type="range"
            data-testid="timeline-pan"
            min={0}
            max={panMaxMs}
            value={Math.min(project.scrollMs, panMaxMs)}
            onChange={(e) => onScroll(Number(e.target.value))}
          />
        </label>
      </div>
      <div className="ruler">
        <div className="ruler-gutter" aria-hidden="true">
          {laneLabelSplitter}
        </div>
        <div
          className="ruler-body"
          ref={bodyRef}
          onPointerDown={onRulerPointer}
          onContextMenu={onEmptyContext}
          data-testid="ruler"
        >
          {ticks.map((t) => (
            <div
              key={`${t.kind}-${t.timeMs}`}
              className={`ruler-tick ${t.kind}`}
              style={{ left: msToX(t.timeMs, project.zoomPxPerSec, project.scrollMs) }}
            >
              {t.label}
            </div>
          ))}
          {project.markers.map((m) => {
            const selected = selectedMarkerId === m.id;
            return (
              <div
                key={m.id}
                className={`marker${selected ? " selected" : ""}`}
                data-testid={`marker-${m.id}`}
                data-selected={selected ? "true" : "false"}
                title={m.label}
                style={{ left: msToX(m.timeMs, project.zoomPxPerSec, project.scrollMs) }}
                onPointerDown={(e) => onMarkerPointerDown(e, m.id, m.timeMs)}
                onContextMenu={(e) => onMarkerContext(e, m.id)}
              >
                <span className="marker-flag" aria-hidden="true" />
                <button
                  type="button"
                  className="marker-x"
                  data-testid={`marker-delete-${m.id}`}
                  aria-label={`Delete ${m.label}`}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteMarker?.(m.id);
                    setMarkerMenu(null);
                  }}
                >
                  ×
                </button>
              </div>
            );
          })}
          {loopOverlay(true)}
          <div
            className="playhead"
            style={{ left: msToX(project.playheadMs, project.zoomPxPerSec, project.scrollMs) }}
          />
        </div>
      </div>
      <div
        className="timeline-lanes"
        data-testid="timeline-lanes"
        ref={lanesRef}
        style={{ overflowY: "scroll" }}
      >
      <div
        className={`lane vis-lane${project.visualizer.muted || !project.visualizer.enabled ? " muted" : ""}${selectedVis || selectedVisEventId || (selectedVisEventIds && selectedVisEventIds.length > 0) ? " track-selected" : ""}${visHeaderInline ? " lane-header-compact" : ""}`}
        data-testid="lane-VIS"
        data-header-pack={visHeaderInline ? "inline" : "stack"}
        data-header-overflow={visHeaderPlan.overflow.length > 0 ? "true" : "false"}
        style={fixedLaneBoxStyle(heights.vis)}
      >
        {(() => {
          const visPlan = visHeaderPlan;
          const visMute = (inOverflow: boolean) => (
            <button
              type="button"
              className={project.visualizer.muted ? "active mute-btn" : "mute-btn"}
              title={project.visualizer.muted ? "Unmute VIS" : "Mute VIS"}
              data-testid="mute-VIS"
              data-header-control="mute"
              aria-pressed={project.visualizer.muted}
              onClick={(e) => {
                e.stopPropagation();
                onToggleVisualizerMute();
              }}
            >
              {inOverflow
                ? headerOverflowLabel("mute", { muted: project.visualizer.muted })
                : "M"}
            </button>
          );
          const visScene = (inOverflow: boolean) => (
            <button
              type="button"
              className={`scene-btn${visBrowserOpen ? " open" : ""}`}
              title={visHeaderSceneId}
              data-testid="visualizer-scene"
              data-header-control="scene"
              aria-haspopup={onSetVisualizerScene ? "dialog" : undefined}
              aria-expanded={onSetVisualizerScene ? visBrowserOpen : undefined}
              onClick={(e) => {
                e.stopPropagation();
                if (onSetVisualizerScene) {
                  onSelectVis?.();
                  toggleVisBrowser();
                  return;
                }
                onCycleVisualizerScene();
              }}
            >
              {inOverflow
                ? headerOverflowLabel("scene", { sceneName: sceneShortName(visHeaderSceneId) })
                : sceneShortName(visHeaderSceneId)}
            </button>
          );
          return (
        <div
          ref={visHeaderRef}
          className={`lane-label${onSetVisualizerScene ? " vis-lane-label-menu" : ""}`}
          data-testid="lane-label-VIS"
          data-header-pack={visHeaderInline ? "inline" : "stack"}
          data-header-overflow={visPlan.overflow.length > 0 ? "true" : "false"}
          data-header-overflow-root=""
          aria-haspopup={onSetVisualizerScene ? "dialog" : undefined}
          aria-expanded={onSetVisualizerScene ? visBrowserOpen : undefined}
          onClick={(e) => {
            if ((e.target as HTMLElement).closest("[data-testid=mute-VIS]")) return;
            if ((e.target as HTMLElement).closest("[data-testid=lane-overflow-VIS]")) return;
            if ((e.target as HTMLElement).closest("[data-testid=lane-label-splitter]")) return;
            onSelectVis?.();
            if (
              onSetVisualizerScene &&
              !(e.target as HTMLElement).closest("[data-testid=visualizer-scene]")
            ) {
              toggleVisBrowser();
            }
          }}
        >
          {laneLabelSplitter}
          <span data-testid="vis-lane-name" data-header-control="identity">VIS</span>
          <div className="vis-lane-btns" data-header-slot="direct">
            {controlIsDirect(visPlan, "mute") ? visMute(false) : null}
            {controlIsDirect(visPlan, "scene") ? visScene(false) : null}
            {visPlan.overflow.length > 0 ? (
              <TrackHeaderOverflowButton
                trackId="VIS"
                open={overflowOpenId === "VIS"}
                onToggle={(el) => toggleOverflow("VIS", el)}
              />
            ) : null}
          </div>
          {visPlan.overflow.length > 0 ? (
            <TrackHeaderOverflowMenu
              trackId="VIS"
              open={overflowOpenId === "VIS"}
              left={overflowPos.left}
              top={overflowPos.top}
              maxHeight={overflowPos.maxHeight}
              placement={overflowPos.placement}
              constrained={overflowPos.constrained}
            >
              {controlIsOverflowed(visPlan, "mute") ? visMute(true) : null}
              {controlIsOverflowed(visPlan, "scene") ? visScene(true) : null}
            </TrackHeaderOverflowMenu>
          ) : null}
        </div>
          );
        })()}
        <div
          className="lane-body vis-body"
          data-testid="lane-VIS-body"
          data-marquee-lane="VIS"
          onPointerDown={(e) => onLaneBodyPointer(e, "VIS")}
          onContextMenu={onEmptyContext}
        >
          {loopOverlay(false)}
          <div className="vis-lane-fill" aria-hidden="true" />
          {(() => {
            const events = visualizerEventsOf(project);
            if (events.length > 0) {
              return events.map((event) => (
                <div
                  key={event.id}
                  role="button"
                  tabIndex={0}
                  className={`vis-span${
                    (selectedVisEventIds?.length
                      ? selectedVisEventIds.includes(event.id)
                      : selectedVisEventId === event.id)
                      ? " selected"
                      : ""
                  }`}
                  data-testid={`vis-event-${event.id}`}
                  data-vis-event={event.id}
                  data-scene={event.sceneId}
                  style={{
                    left: msToX(event.startMs, project.zoomPxPerSec, project.scrollMs),
                    width: Math.max(28, msToWidth(event.durationMs, project.zoomPxPerSec)),
                  }}
                  onPointerDown={(e) => onVisEventPointerDown(e, event)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onSelectVisEvent?.(event.id);
                    setMenu(null);
                    setMarkerMenu(null);
                    setVisMenu({ x: e.clientX, y: e.clientY, eventId: event.id });
                  }}
                >
                  <span className="vis-span-label">{formatVisEventLabel(event)}</span>
                  <div
                    className="trim-handle in"
                    data-testid={`vis-event-in-${event.id}`}
                    onPointerDown={(e) => onVisEventTrimPointerDown(e, event, "in")}
                  />
                  <div
                    className="trim-handle out"
                    data-testid={`vis-event-out-${event.id}`}
                    onPointerDown={(e) => onVisEventTrimPointerDown(e, event, "out")}
                  />
                </div>
              ));
            }
            const start = Math.round(project.visualizer.startMs ?? 0);
            const rawDur = project.visualizer.durationMs ?? 0;
            const dur = rawDur > 0 ? Math.round(rawDur) : Math.max(10_000, projectDurationMs(project));
            return (
              <button
                type="button"
                className="vis-span"
                data-testid="vis-span"
                data-scene={project.visualizer.sceneId}
                style={{
                  left: msToX(start, project.zoomPxPerSec, project.scrollMs),
                  width: Math.max(28, msToWidth(dur, project.zoomPxPerSec)),
                }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  onPlayhead(snapPlayheadSeek(project, timeFromEvent(e.clientX)));
                  if (onInsertVisEvent) onInsertVisEvent();
                  else onSelectVis?.();
                }}
              >
                {sceneShortName(project.visualizer.sceneId)} {start}–{start + dur}ms
              </button>
            );
          })()}
          <div
            className="playhead"
            style={{ left: msToX(project.playheadMs, project.zoomPxPerSec, project.scrollMs) }}
          />
        </div>
        <div
          className="lane-height-handle"
          data-testid="lane-height-VIS"
          title="Resize VIS lane"
          onPointerDown={(e) => onLaneHeightPointerDown(e, "vis")}
        />
      </div>
      {(() => {
        const visibleIds = visibleTrackIds ?? trackIdsOf(project);
        const rows = arrangeRows(project, {
          visibleTrackIds: visibleIds,
          collapsedGroupIds,
        });
        const chrome = lastAudioChromeHost(project, rows);
        const listedGroups = groupsOf(project);
        const audioChrome = (host: "track" | "group", hostId: string) => {
          const isHost =
            chrome?.kind === host &&
            (chrome.kind === "track" ? chrome.trackId === hostId : chrome.groupId === hostId);
          return {
            showAdd: Boolean(isHost && onAddAudioTrack),
            showRemove: Boolean(isHost && onRemoveAudioTrack && canRemoveAudioTrack),
            showGroup: Boolean(isHost && onCreateTrackGroup),
          };
        };
        return rows.map((row: ArrangeRow) => {
        if (row.kind === "group") {
          const buttons = audioChrome("group", row.group.id);
          return (
            <div
              className={`lane group-lane${row.collapsed ? " collapsed" : ""}`}
              key={`group:${row.group.id}`}
              data-testid={`lane-group-${row.group.id}`}
              data-collapsed={row.collapsed ? "true" : "false"}
              style={fixedLaneBoxStyle(GROUP_LANE_HEIGHT_PX)}
            >
              <div className="lane-label" data-testid={`lane-group-label-${row.group.id}`}>
                {laneLabelSplitter}
                <button
                  type="button"
                  className="lane-group-collapse"
                  data-testid={`lane-group-collapse-${row.group.id}`}
                  title={row.collapsed ? "Expand group" : "Collapse group"}
                  aria-expanded={!row.collapsed}
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleGroupCollapsed?.(row.group.id);
                  }}
                >
                  <GroupCollapseIcon collapsed={row.collapsed} />
                </button>
                <GroupNameField
                  groupId={row.group.id}
                  name={row.group.name}
                  onRename={onRenameTrackGroup}
                />
                <span className="lane-group-count" data-testid={`lane-group-count-${row.group.id}`}>
                  {row.memberIds.length}
                </span>
                {buttons.showAdd || buttons.showRemove || buttons.showGroup ? (
                  <div className="lane-audio-count" data-testid={`lane-audio-count-group-${row.group.id}`}>
                    {buttons.showGroup ? (
                      <button
                        type="button"
                        className="lane-audio-count-btn"
                        data-testid="create-track-group"
                        title="Group selected audio tracks"
                        onClick={(e) => {
                          e.stopPropagation();
                          onCreateTrackGroup?.();
                        }}
                      >
                        Grp
                      </button>
                    ) : null}
                    {buttons.showAdd ? (
                      <button
                        type="button"
                        className="lane-audio-count-btn"
                        data-testid="add-audio-track"
                        title="Add audio track"
                        disabled={canAddAudioTrack === false}
                        onClick={(e) => {
                          e.stopPropagation();
                          onAddAudioTrack?.();
                        }}
                      >
                        +
                      </button>
                    ) : null}
                    {buttons.showRemove ? (
                      <button
                        type="button"
                        className="lane-audio-count-btn"
                        data-testid="remove-audio-track"
                        title="Remove audio track"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemoveAudioTrack?.();
                        }}
                      >
                        −
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <div className="lane-body" data-testid={`lane-group-${row.group.id}-body`} />
            </div>
          );
        }
        const id = row.trackId;
        const track = trackById(project, id);
        const muted = track?.muted === true;
        const soloed = track?.solo === true;
        const group = heightGroupOfLane(id);
        const kind = track?.kind ?? kindOfTrack(id);
        const label = track?.name || id;
        const headerInline = laneHeaderPacksInline(heights[group]);
        const buttons = audioChrome("track", id);
        const showAudioAdd = buttons.showAdd;
        const showAudioRemove = buttons.showRemove;
        const showCreateGroup = buttons.showGroup;
        const headerKind = kind === "audio" ? "audio" : "video";
        const headerPresent: HeaderControlId[] = ["identity", "mute", "solo"];
        if (kind === "audio" && onToggleVolumeWriteArm) headerPresent.push("write");
        if (kind === "audio" && onToggleVolumeLane) headerPresent.push("volume");
        if (kind === "audio" && onAssignTracksToGroup) headerPresent.push("groupAssign");
        if (showCreateGroup) headerPresent.push("groupCreate");
        if (showAudioAdd) headerPresent.push("addAudio");
        if (showAudioRemove) headerPresent.push("removeAudio");
        const headerPlan = headerPlanFor(headerKind, headerPresent, headerInline);
        const clipLane = (
          <div
            className={`lane ${kind}-lane${muted ? " muted" : ""}${soloed ? " soloed" : ""}${selectedTrackIds?.includes(id) ? " track-selected" : ""}${headerInline ? " lane-header-compact" : ""}`}
            key={id}
            data-testid={`lane-${id}`}
            data-header-pack={headerInline ? "inline" : "stack"}
            data-header-overflow={headerPlan.overflow.length > 0 ? "true" : "false"}
            style={fixedLaneBoxStyle(heights[group])}
          >
            <div
              className="lane-label"
              data-testid={`lane-label-${id}`}
              data-header-pack={headerInline ? "inline" : "stack"}
              data-header-overflow={headerPlan.overflow.length > 0 ? "true" : "false"}
              data-header-overflow-root=""
              onClick={(e) => {
                if ((e.target as HTMLElement).closest("button, select, input")) return;
                onSelectTrack?.(id, { toggle: e.ctrlKey || e.metaKey });
              }}
            >
              {laneLabelSplitter}
              {id === "V1" || id === "V2" ? (
                <button
                  type="button"
                  className={`track-front-btn${(project.frontVideoTrackId === "V1" ? "V1" : "V2") === id ? " on" : ""}`}
                  data-testid={`front-${id}`}
                  data-header-control="identity"
                  title={`Show ${id} on overlap`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSetFrontVideoTrack?.(id);
                  }}
                >
                  {id}
                </button>
              ) : (
                <span data-header-control="identity">{label}</span>
              )}
              {(() => {
                const groupAssign =
                  kind === "audio" && onAssignTracksToGroup ? (
                    <LaneGroupAssign
                      trackId={id}
                      groupId={track?.groupId}
                      groups={listedGroups}
                      onAssign={onAssignTracksToGroup}
                      onCreate={(trackIds) => onCreateTrackGroup?.(trackIds)}
                    />
                  ) : null;
                const writeArmed = volumeWriteArmedIds?.includes(id) === true;
                const volumeOpen = openVolumeLaneIds?.includes(id) === true;
                const groupName = listedGroups.find((group) => group.id === track?.groupId)?.name;
                const muteBtn = (inOverflow: boolean) => (
                  <button
                    type="button"
                    className={muted ? "active mute-btn" : "mute-btn"}
                    title={muted ? `Unmute ${label}` : `Mute ${label}`}
                    data-testid={`mute-${id}`}
                    data-header-control="mute"
                    aria-pressed={muted}
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleMute(id);
                    }}
                  >
                    {inOverflow ? headerOverflowLabel("mute", { muted }) : "M"}
                  </button>
                );
                const soloBtn = (inOverflow: boolean) => (
                  <button
                    type="button"
                    className={soloed ? "active solo-btn" : "solo-btn"}
                    title={soloed ? `Unsolo ${label}` : `Solo ${label}`}
                    data-testid={`solo-${id}`}
                    data-header-control="solo"
                    aria-pressed={soloed}
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleSolo?.(id);
                    }}
                  >
                    {inOverflow ? headerOverflowLabel("solo", { soloed }) : "S"}
                  </button>
                );
                const writeBtn = (inOverflow: boolean) =>
                  kind === "audio" && onToggleVolumeWriteArm ? (
                    <button
                      type="button"
                      className={writeArmed ? "active write-arm-btn" : "write-arm-btn"}
                      title={writeArmed ? "Disarm volume write" : "Arm volume write"}
                      aria-label={writeArmed ? "Disarm volume write" : "Arm volume write"}
                      data-testid={`write-arm-${id}`}
                      data-header-control="write"
                      aria-pressed={writeArmed}
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleVolumeWriteArm(id);
                        if (e.currentTarget instanceof HTMLElement) e.currentTarget.blur();
                      }}
                    >
                      {inOverflow ? headerOverflowLabel("write", { writeArmed }) : "W"}
                    </button>
                  ) : null;
                const volumeBtn = (inOverflow: boolean) =>
                  kind === "audio" && onToggleVolumeLane ? (
                    <button
                      type="button"
                      className={volumeOpen ? "active volume-lane-btn" : "volume-lane-btn"}
                      title={volumeOpen ? "Hide volume automation" : "Show volume automation"}
                      aria-label={volumeOpen ? "Hide volume automation" : "Show volume automation"}
                      data-testid={`volume-lane-toggle-${id}`}
                      data-header-control="volume"
                      aria-pressed={volumeOpen}
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleVolumeLane(id);
                      }}
                    >
                      {inOverflow ? headerOverflowLabel("volume", { volumeLaneOpen: volumeOpen }) : "VOL"}
                    </button>
                  ) : null;
                const groupCreateBtn = (inOverflow: boolean) =>
                  showCreateGroup ? (
                    <button
                      type="button"
                      className="lane-audio-count-btn lane-group-create-btn"
                      data-testid="create-track-group"
                      data-header-control="groupCreate"
                      title="Group selected audio tracks"
                      onClick={(e) => {
                        e.stopPropagation();
                        onCreateTrackGroup?.();
                      }}
                    >
                      {inOverflow ? headerOverflowLabel("groupCreate") : "Grp"}
                    </button>
                  ) : null;
                const addAudioBtn = (inOverflow: boolean) =>
                  showAudioAdd ? (
                    <button
                      type="button"
                      className="lane-audio-count-btn"
                      data-testid="add-audio-track"
                      data-header-control="addAudio"
                      title="Add audio track"
                      disabled={canAddAudioTrack === false}
                      onClick={(e) => {
                        e.stopPropagation();
                        onAddAudioTrack?.();
                      }}
                    >
                      {inOverflow ? headerOverflowLabel("addAudio") : "+"}
                    </button>
                  ) : null;
                const removeAudioBtn = (inOverflow: boolean) =>
                  showAudioRemove ? (
                    <button
                      type="button"
                      className="lane-audio-count-btn"
                      data-testid="remove-audio-track"
                      data-header-control="removeAudio"
                      title="Remove audio track"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveAudioTrack?.();
                      }}
                    >
                      {inOverflow ? headerOverflowLabel("removeAudio") : "−"}
                    </button>
                  ) : null;
                const showDirectChrome =
                  (showCreateGroup && controlIsDirect(headerPlan, "groupCreate")) ||
                  (showAudioAdd && controlIsDirect(headerPlan, "addAudio")) ||
                  (showAudioRemove && controlIsDirect(headerPlan, "removeAudio"));
                const showOverflowChrome =
                  (showCreateGroup && controlIsOverflowed(headerPlan, "groupCreate")) ||
                  (showAudioAdd && controlIsOverflowed(headerPlan, "addAudio")) ||
                  (showAudioRemove && controlIsOverflowed(headerPlan, "removeAudio"));
                return (
                  <>
                    {controlIsDirect(headerPlan, "groupAssign") ? groupAssign : null}
                    <div className="lane-ms" data-header-slot="direct">
                      {controlIsDirect(headerPlan, "mute") ? muteBtn(false) : null}
                      {controlIsDirect(headerPlan, "solo") ? soloBtn(false) : null}
                      {controlIsDirect(headerPlan, "write") ? writeBtn(false) : null}
                      {controlIsDirect(headerPlan, "volume") ? volumeBtn(false) : null}
                      {headerPlan.overflow.length > 0 ? (
                        <TrackHeaderOverflowButton
                          trackId={id}
                          open={overflowOpenId === id}
                          onToggle={(el) => toggleOverflow(id, el)}
                        />
                      ) : null}
                    </div>
                    {showDirectChrome ? (
                      <div className="lane-audio-count" data-testid={`lane-audio-count-${id}`}>
                        {controlIsDirect(headerPlan, "groupCreate") ? groupCreateBtn(false) : null}
                        {controlIsDirect(headerPlan, "addAudio") ? addAudioBtn(false) : null}
                        {controlIsDirect(headerPlan, "removeAudio") ? removeAudioBtn(false) : null}
                      </div>
                    ) : null}
                    {headerPlan.overflow.length > 0 ? (
                      <TrackHeaderOverflowMenu
                        trackId={id}
                        open={overflowOpenId === id}
                        left={overflowPos.left}
                        top={overflowPos.top}
                        maxHeight={overflowPos.maxHeight}
                        placement={overflowPos.placement}
                        constrained={overflowPos.constrained}
                      >
                        {controlIsOverflowed(headerPlan, "mute") ? muteBtn(true) : null}
                        {controlIsOverflowed(headerPlan, "solo") ? soloBtn(true) : null}
                        {controlIsOverflowed(headerPlan, "write") ? writeBtn(true) : null}
                        {controlIsOverflowed(headerPlan, "volume") ? volumeBtn(true) : null}
                        {controlIsOverflowed(headerPlan, "groupAssign") ? (
                          <label className="lane-overflow-field">
                            <span>{headerOverflowLabel("groupAssign", { groupName })}</span>
                            {groupAssign}
                          </label>
                        ) : null}
                        {showOverflowChrome ? (
                          <div className="lane-audio-count" data-testid={`lane-audio-count-${id}`}>
                            {controlIsOverflowed(headerPlan, "groupCreate") ? groupCreateBtn(true) : null}
                            {controlIsOverflowed(headerPlan, "addAudio") ? addAudioBtn(true) : null}
                            {controlIsOverflowed(headerPlan, "removeAudio") ? removeAudioBtn(true) : null}
                          </div>
                        ) : null}
                      </TrackHeaderOverflowMenu>
                    ) : null}
                  </>
                );
              })()}
            </div>
            <div
              className="lane-body"
              data-testid={`lane-${id}-body`}
              data-marquee-lane={id}
              onPointerDown={(e) => onLaneBodyPointer(e, id)}
              onContextMenu={onEmptyContext}
            >
              {loopOverlay(false)}
              {project.clips
                .filter((c) => c.trackId === id)
                .map((clip) => {
                  const asset = project.assets.find((a) => a.id === clip.assetId);
                  const selected = selectedIds.includes(clip.id);
                  const primary = primaryId === clip.id;
                  const label = asset?.missing ? `missing:${asset.name}` : asset?.name ?? clip.id;
                  const clipW = Math.max(8, msToWidth(clip.durationMs, project.zoomPxPerSec));
                  const kind = kindOfTrack(clip.trackId);
                  return (
                    <div
                      key={clip.id}
                      className={`clip ${kind}${selected ? " selected" : ""}${asset?.missing ? " missing" : ""}${clip.enabled === false ? " disabled" : ""}${clipIsLocked(clip) ? " locked" : ""}`}
                      data-testid={`clip-${clip.id}`}
                      data-selected={selected ? "true" : "false"}
                      data-enabled={clip.enabled === false ? "false" : "true"}
                      data-locked={clipIsLocked(clip) ? "true" : "false"}
                      style={{
                        left: msToX(clip.startMs, project.zoomPxPerSec, project.scrollMs),
                        width: clipW,
                      }}
                      title={label}
                      onPointerDown={(e) => onClipPointerDown(e, clip)}
                      onContextMenu={(e) => onClipContext(e, clip)}
                    >
                      {asset && kind === "audio" && !asset.missing ? (
                        <AudioClipWave clip={clip} asset={asset} clipWidthPx={clipW} />
                      ) : null}
                      {asset && kind === "video" && !asset.missing ? (
                        <VideoClipStrip clip={clip} asset={asset} clipWidthPx={clipW} />
                      ) : null}
                      {asset?.missing && onRelink ? (
                        <button
                          type="button"
                          className="clip-relink"
                          data-testid={`clip-relink-${clip.id}`}
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            onRelink([clip.id]);
                          }}
                        >
                          Relink
                        </button>
                      ) : null}
                      {(() => {
                        const fades = normalizeClipFades(
                          clip.fadeInMs,
                          clip.fadeOutMs,
                          clip.durationMs,
                        );
                        const inPct =
                          clip.durationMs > 0 ? (fades.fadeInMs / clip.durationMs) * 100 : 0;
                        const outPct =
                          clip.durationMs > 0 ? (fades.fadeOutMs / clip.durationMs) * 100 : 0;
                        return (
                          <>
                            {inPct > 0 ? (
                              <span
                                className="clip-fade-in"
                                data-testid={`fade-in-${clip.id}`}
                                style={{ width: `${inPct}%` }}
                              />
                            ) : null}
                            {outPct > 0 ? (
                              <span
                                className="clip-fade-out"
                                data-testid={`fade-out-${clip.id}`}
                                style={{ width: `${outPct}%` }}
                              />
                            ) : null}
                          </>
                        );
                      })()}
                      <span className="clip-name">{label}</span>
                      {primary ? (
                        <>
                          {fadeHandlesVisible(clipW) ? (
                            <>
                              <div
                                className="fade-handle in"
                                data-testid={`fade-handle-in-${clip.id}`}
                                title="Fade in"
                                style={{ cursor: "w-resize" }}
                                onPointerDown={(e) => onFadePointerDown(e, clip, "in")}
                              />
                              <div
                                className="fade-handle out"
                                data-testid={`fade-handle-out-${clip.id}`}
                                title="Fade out"
                                style={{ cursor: "e-resize" }}
                                onPointerDown={(e) => onFadePointerDown(e, clip, "out")}
                              />
                            </>
                          ) : null}
                          <div
                            className={`trim-handle in${abuttingNeighbor(project, clip.id, "in") ? " roll" : ""}`}
                            data-testid={`trim-in-${clip.id}`}
                            title={
                              abuttingNeighbor(project, clip.id, "in")
                                ? "Roll edit (Shift+drag = ripple trim)"
                                : "Trim in (Shift+drag = ripple trim)"
                            }
                            onPointerDown={(e) => onTrimPointerDown(e, clip, "in")}
                          />
                          <div
                            className={`trim-handle out${abuttingNeighbor(project, clip.id, "out") ? " roll" : ""}`}
                            data-testid={`trim-out-${clip.id}`}
                            title={
                              abuttingNeighbor(project, clip.id, "out")
                                ? "Roll edit (Shift+drag = ripple trim)"
                                : "Trim out (Shift+drag = ripple trim)"
                            }
                            onPointerDown={(e) => onTrimPointerDown(e, clip, "out")}
                          />
                        </>
                      ) : null}
                    </div>
                  );
                })}
              {kindOfTrack(id) === "video"
                ? overlapMarks
                    .filter((m) => m.sourceA.trackId === id)
                    .map((m) => (
                      <div
                        key={`${m.sourceA.id}:${m.sourceB.id}`}
                        role="button"
                        tabIndex={0}
                        className="overlap-mark"
                        data-testid="overlap-mark"
                        data-type={m.type}
                        data-duration-ms={String(m.durationMs)}
                        data-a={m.sourceA.id}
                        data-b={m.sourceB.id}
                        style={{
                          left: msToX(m.overlapStartMs, project.zoomPxPerSec, project.scrollMs),
                          width: Math.max(28, msToWidth(m.durationMs, project.zoomPxPerSec)),
                        }}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          onSelectClips?.([m.sourceA.id, m.sourceB.id]);
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectClips?.([m.sourceA.id, m.sourceB.id]);
                        }}
                      >
                        {m.type} {m.durationMs}ms
                        <div
                          className="transition-duration-handle video"
                          data-testid="overlap-duration-handle-video"
                          title="Video duration"
                          onPointerDown={(e) => onTransitionDurationPointerDown(e, m, "video")}
                        />
                        {m.audio === "crossfade" || m.audioDurationMs > 0 ? (
                          <div
                            className="transition-duration-handle audio"
                            data-testid="overlap-duration-handle-audio"
                            title="Audio duration"
                            style={{
                              left: Math.max(0, msToWidth(m.audioDurationMs, project.zoomPxPerSec) - 3),
                              right: "auto",
                            }}
                            onPointerDown={(e) => onTransitionDurationPointerDown(e, m, "audio")}
                          />
                        ) : null}
                      </div>
                    ))
                : null}
              <div
                className="playhead"
                style={{ left: msToX(project.playheadMs, project.zoomPxPerSec, project.scrollMs) }}
              />
            </div>
            <div
              className="lane-height-handle"
              data-testid={`lane-height-${id}`}
              title={`Resize ${group} lanes`}
              onPointerDown={(e) => onLaneHeightPointerDown(e, group)}
            />
          </div>
        );
        if (
          kind !== "audio" ||
          !onToggleVolumeLane ||
          !openVolumeLaneIds?.includes(id)
        ) {
          return clipLane;
        }
        return [
          clipLane,
          <VolumeAutomationLane
            key={`vol:${id}`}
            project={project}
            trackId={id}
            selectedTimeMs={
              selectedVolumeAutomation?.trackId === id ? selectedVolumeAutomation.timeMs : null
            }
            onToggle={() => onToggleVolumeLane(id)}
            onSetEnabled={(enabled) => onSetVolumeAutomationEnabled?.(id, enabled)}
            onSelectPoint={(timeMs) => onSelectVolumeAutomationPoint?.(id, timeMs)}
            onAddPoint={(timeMs, value) => onAddVolumeAutomationPoint?.(id, timeMs, value)}
            onDeletePoint={(timeMs) => onDeleteVolumeAutomationPoint?.(id, timeMs)}
            onPointLive={(fromTimeMs, timeMs, value) =>
              onVolumeAutomationPointLive?.(id, fromTimeMs, timeMs, value)
            }
            onPointCommit={() => onVolumeAutomationPointCommit?.()}
          />,
        ];
        });
      })()}
      </div>
      {marquee ? (
        <div
          className="marquee-rect"
          data-testid="marquee-rect"
          style={{
            left: Math.min(marquee.x0, marquee.x1),
            top: Math.min(marquee.y0, marquee.y1),
            width: Math.abs(marquee.x1 - marquee.x0),
            height: Math.abs(marquee.y1 - marquee.y0),
          }}
        />
      ) : null}
      {menu ? (
        <div
          className="clip-menu"
          data-testid="clip-menu"
          style={{ left: menu.x, top: menu.y }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => {
              onSplitHere(menu.clipId, menu.timeMs);
              setMenu(null);
            }}
          >
            <span>Split here</span>
            <kbd>{CLIP_MENU_SHORTCUTS.split}</kbd>
          </button>
          <button
            type="button"
            onClick={() => {
              onCut();
              setMenu(null);
            }}
          >
            <span>Cut</span>
            <kbd>{CLIP_MENU_SHORTCUTS.cut}</kbd>
          </button>
          <button
            type="button"
            onClick={() => {
              onCopy();
              setMenu(null);
            }}
          >
            <span>Copy</span>
            <kbd>{CLIP_MENU_SHORTCUTS.copy}</kbd>
          </button>
          <button
            type="button"
            onClick={() => {
              onPaste();
              setMenu(null);
            }}
          >
            <span>Paste</span>
            <kbd>{CLIP_MENU_SHORTCUTS.paste}</kbd>
          </button>
          {onDuplicate ? (
            <button
              type="button"
              data-testid="clip-menu-duplicate"
              onClick={() => {
                onDuplicate();
                setMenu(null);
              }}
            >
              <span>Duplicate</span>
              <kbd>{CLIP_MENU_SHORTCUTS.duplicate}</kbd>
            </button>
          ) : null}
          {onSelectAll ? (
            <button
              type="button"
              data-testid="clip-menu-select-all"
              onClick={() => {
                onSelectAll();
                setMenu(null);
              }}
            >
              <span>Select All</span>
              <kbd>{CLIP_MENU_SHORTCUTS.selectAll}</kbd>
            </button>
          ) : null}
          {onSelectAllOnTrack ? (
            <button
              type="button"
              data-testid="clip-menu-select-all-on-track"
              onClick={() => {
                onSelectAllOnTrack();
                setMenu(null);
              }}
            >
              <span>Select All on Track</span>
              <kbd>{CLIP_MENU_SHORTCUTS.selectAllOnTrack}</kbd>
            </button>
          ) : null}
          {onSetClipsEnabled ? (
            <button
              type="button"
              data-testid="clip-menu-toggle-enabled"
              onClick={() => {
                const target = project.clips.find((c) => c.id === menu.clipId);
                onSetClipsEnabled(target?.enabled === false);
                setMenu(null);
              }}
            >
              <span>
                {project.clips.find((c) => c.id === menu.clipId)?.enabled === false
                  ? "Enable"
                  : "Disable"}
              </span>
            </button>
          ) : null}
          {onSetClipsLocked ? (
            <button
              type="button"
              data-testid="clip-menu-toggle-locked"
              onClick={() => {
                const target = project.clips.find((c) => c.id === menu.clipId);
                onSetClipsLocked(!clipIsLocked(target ?? {}));
                setMenu(null);
              }}
            >
              <span>
                {clipIsLocked(project.clips.find((c) => c.id === menu.clipId) ?? {})
                  ? "Unlock"
                  : "Lock"}
              </span>
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              onDelete();
              setMenu(null);
            }}
          >
            <span>Delete</span>
            <kbd>{CLIP_MENU_SHORTCUTS.delete}</kbd>
          </button>
          <button
            type="button"
            data-testid="clip-menu-ripple-delete"
            onClick={() => {
              (onRippleDelete ?? onDelete)();
              setMenu(null);
            }}
          >
            <span>Ripple delete</span>
            <kbd>{CLIP_MENU_SHORTCUTS.rippleDelete}</kbd>
          </button>
          <button
            type="button"
            data-testid="clip-menu-lift-range"
            onClick={() => {
              onLiftRange?.();
              setMenu(null);
            }}
          >
            <span>Lift range</span>
            <kbd>{CLIP_MENU_SHORTCUTS.liftRange}</kbd>
          </button>
          <button
            type="button"
            data-testid="clip-menu-extract-range"
            onClick={() => {
              onExtractRange?.();
              setMenu(null);
            }}
          >
            <span>Extract range</span>
            <kbd>{CLIP_MENU_SHORTCUTS.extractRange}</kbd>
          </button>
          {onRelink ? (
            <button
              type="button"
              data-testid="clip-menu-relink"
              onClick={() => {
                onRelink();
                setMenu(null);
              }}
            >
              <span>Relink</span>
            </button>
          ) : null}
          {onCloseGap ? (
            <button
              type="button"
              data-testid="clip-menu-close-gap"
              onClick={() => {
                onCloseGap();
                setMenu(null);
              }}
            >
              <span>Close gap</span>
              <kbd>{CLIP_MENU_SHORTCUTS.closeGap}</kbd>
            </button>
          ) : null}
          {onTrimToPlayhead ? (
            <>
              <button
                type="button"
                data-testid="clip-menu-trim-in"
                onClick={() => {
                  onTrimToPlayhead("in", menu.timeMs);
                  setMenu(null);
                }}
              >
                <span>Trim in to playhead</span>
                <kbd>{CLIP_MENU_SHORTCUTS.trimInToPlayhead}</kbd>
              </button>
              <button
                type="button"
                data-testid="clip-menu-trim-out"
                onClick={() => {
                  onTrimToPlayhead("out", menu.timeMs);
                  setMenu(null);
                }}
              >
                <span>Trim out to playhead</span>
                <kbd>{CLIP_MENU_SHORTCUTS.trimOutToPlayhead}</kbd>
              </button>
            </>
          ) : null}
          {onFadeEdge ? (
            <>
              <button
                type="button"
                data-testid="clip-menu-fade-in"
                onClick={() => {
                  onFadeEdge("in");
                  setMenu(null);
                }}
              >
                <span>Fade in</span>
                <kbd>{CLIP_MENU_SHORTCUTS.fadeIn}</kbd>
              </button>
              <button
                type="button"
                data-testid="clip-menu-fade-out"
                onClick={() => {
                  onFadeEdge("out");
                  setMenu(null);
                }}
              >
                <span>Fade out</span>
                <kbd>{CLIP_MENU_SHORTCUTS.fadeOut}</kbd>
              </button>
            </>
          ) : null}
          {onAddCrossfade ? (
            <button
              type="button"
              data-testid="clip-menu-crossfade"
              onClick={() => {
                onAddCrossfade();
                setMenu(null);
              }}
            >
              <span>Crossfade</span>
              <kbd>{CLIP_MENU_SHORTCUTS.crossfade}</kbd>
            </button>
          ) : null}
          {onToggleReverse ? (
            <button
              type="button"
              data-testid="clip-menu-reverse"
              onClick={() => {
                onToggleReverse();
                setMenu(null);
              }}
            >
              <span>Reverse</span>
              <kbd>{CLIP_MENU_SHORTCUTS.reverse}</kbd>
            </button>
          ) : null}
          {onFreezeFrame ? (
            <button
              type="button"
              data-testid="clip-menu-freeze"
              onClick={() => {
                onFreezeFrame();
                setMenu(null);
              }}
            >
              <span>Freeze frame</span>
              <kbd>{CLIP_MENU_SHORTCUTS.freeze}</kbd>
            </button>
          ) : null}
          {onSetRate ? (
            <>
              <button
                type="button"
                data-testid="clip-menu-speed-half"
                onClick={() => {
                  onSetRate(0.5);
                  setMenu(null);
                }}
              >
                <span>Speed 0.5x</span>
                <kbd>{CLIP_MENU_SHORTCUTS.speedHalf}</kbd>
              </button>
              <button
                type="button"
                data-testid="clip-menu-speed-double"
                onClick={() => {
                  onSetRate(2);
                  setMenu(null);
                }}
              >
                <span>Speed 2x</span>
                <kbd>{CLIP_MENU_SHORTCUTS.speedDouble}</kbd>
              </button>
            </>
          ) : null}
          {onRippleTrimToPlayhead ? (
            <>
              <button
                type="button"
                data-testid="clip-menu-ripple-trim-in"
                onClick={() => {
                  onRippleTrimToPlayhead("in", menu.timeMs);
                  setMenu(null);
                }}
              >
                <span>Ripple trim in to playhead</span>
                <kbd>{CLIP_MENU_SHORTCUTS.rippleTrimInToPlayhead}</kbd>
              </button>
              <button
                type="button"
                data-testid="clip-menu-ripple-trim-out"
                onClick={() => {
                  onRippleTrimToPlayhead("out", menu.timeMs);
                  setMenu(null);
                }}
              >
                <span>Ripple trim out to playhead</span>
                <kbd>{CLIP_MENU_SHORTCUTS.rippleTrimOutToPlayhead}</kbd>
              </button>
            </>
          ) : null}
        </div>
      ) : null}
      {visBrowserOpen && onSetVisualizerScene
        ? createPortal(
            <div
              ref={visBrowserRef}
              className="vis-lane-browser"
              data-testid="vis-lane-browser"
              style={{ left: visBrowserPos.left, top: visBrowserPos.top }}
              onPointerDown={(e) => {
                e.stopPropagation();
                onVisBrowserDragPointerDown(e);
              }}
              onPointerMove={onVisBrowserDragPointerMove}
              onPointerUp={onVisBrowserDragPointerUp}
              onPointerCancel={onVisBrowserDragPointerUp}
            >
              <VisSceneBrowser
                value={visHeaderSceneId}
                onSelect={(sceneId) => {
                  onSetVisualizerScene(sceneId);
                  setVisBrowserOpen(false);
                }}
                variant="overlay"
                hideTrigger
                defaultOpen
                testIdPrefix="vis-lane-browser"
                onCycle={() => {
                  onCycleVisualizerScene();
                }}
              />
            </div>,
            document.body,
          )
        : null}
      {visMenu ? (
        <div
          className="clip-menu"
          data-testid="vis-event-menu"
          style={{ left: visMenu.x, top: visMenu.y }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            data-testid="vis-event-menu-copy"
            onClick={() => {
              onCopy();
              setVisMenu(null);
            }}
          >
            <span>Copy</span>
            <kbd>{CLIP_MENU_SHORTCUTS.copy}</kbd>
          </button>
          <button
            type="button"
            data-testid="vis-event-menu-cut"
            onClick={() => {
              onCut();
              setVisMenu(null);
            }}
          >
            <span>Cut</span>
            <kbd>{CLIP_MENU_SHORTCUTS.cut}</kbd>
          </button>
          <button
            type="button"
            data-testid="vis-event-menu-paste"
            onClick={() => {
              onPaste();
              setVisMenu(null);
            }}
          >
            <span>Paste</span>
            <kbd>{CLIP_MENU_SHORTCUTS.paste}</kbd>
          </button>
          <button
            type="button"
            data-testid="vis-event-menu-delete"
            onClick={() => {
              onDelete();
              setVisMenu(null);
            }}
          >
            <span>Delete</span>
            <kbd>{CLIP_MENU_SHORTCUTS.delete}</kbd>
          </button>
        </div>
      ) : null}
      {markerMenu ? (
        <div
          className="clip-menu"
          data-testid="marker-menu"
          style={{ left: markerMenu.x, top: markerMenu.y }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            data-testid="marker-menu-delete"
            onClick={() => {
              onDeleteMarker?.(markerMenu.markerId);
              setMarkerMenu(null);
            }}
          >
            <span>Delete marker</span>
            <kbd>{CLIP_MENU_SHORTCUTS.delete}</kbd>
          </button>
        </div>
      ) : null}
    </section>
  );
}

export function clipUnderPlayhead(project: Project): Clip | undefined {
  return project.clips.find(
    (c) => project.playheadMs >= c.startMs && project.playheadMs < clipEndMs(c),
  );
}
