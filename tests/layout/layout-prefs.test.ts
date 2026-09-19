import { describe, expect, it } from "vitest";
import {
  ARRANGE_MIN_PX,
  LOWER_STAGE_MIN_PX,
  legalSplitMins,
  normalizePersistedSplitRatio,
  stageAvailableFromWindow,
  TRANSPORT_MIN_PX,
  COMPOSER_MAX_PX,
  COMPOSER_MIN_PX,
  DEFAULT_COMPOSER_HEIGHT_PX,
  DEFAULT_DIRECTOR_SPLIT_RATIO,
  DEFAULT_H_SPLIT_RATIO,
  DEFAULT_SPLIT_RATIO,
  DIRECTOR_FOCUS_KEY,
  DIRECTOR_SECTION_MIN_PX,
  DIRECTOR_SPLIT_RATIO_KEY,
  H_SPLIT_RATIO_KEY,
  INSPECTOR_COLLAPSED_KEY,
  INSPECTOR_COLLAPSED_PX,
  INSPECTOR_MAX_PX,
  INSPECTOR_MIN_PX,
  INSPECTOR_SECTION_COLLAPSED_KEY,
  INSPECTOR_SECTION_MIN_PX,
  MIXER_AUTO_COMPACT_ARRANGE_PX,
  MIXER_COLLAPSED_KEY,
  MIXER_EXPANDED_PX,
  MIXER_MAX_PX,
  MIXER_MIN_PX,
  mixerChromeOf,
  shouldAutoCompactMixer,
  MIXER_WIDTH_KEY,
  NORMAL_SPLIT_RATIO_KEY,
  TIMELINE_FOCUS_KEY,
  TIMELINE_FOCUS_PREVIEW_PX,
  TIMELINE_MIN_PX,
  PREVIEW_H_MIN_PX,
  PREVIEW_MIN_PX,
  SPLITTER_PX,
  SPLIT_RATIO_KEY,
  applyHSplitPointer,
  applyMixerWidthPointer,
  applySplitPointer,
  applyTimelineFocusToggle,
  timelineFocusSplitRatio,
  DEFAULT_LANE_HEIGHT_PX,
  DEFAULT_LANE_LABEL_PX,
  LANE_HEIGHT_MAX_PX,
  LANE_HEIGHT_MIN_PX,
  LANE_HEADER_STACK_MIN_PX,
  LANE_HEIGHTS_KEY,
  LANE_LABEL_MAX_PX,
  LANE_LABEL_MIN_PX,
  LANE_LABEL_PX_KEY,
  applyDirectorFocusToggle,
  applyDirectorSplitPointer,
  applyDirectorWorkSplitPointer,
  applyFocusHSplitPointer,
  clampComposerHeightPx,
  clampDirectorSplitRatio,
  clampDirectorWorkSplitRatio,
  clampFocusHSplitRatio,
  clampHSplitRatio,
  DEFAULT_DIRECTOR_FOCUS_H_SPLIT,
  DEFAULT_DIRECTOR_FOCUS_RATIO,
  DEFAULT_DIRECTOR_WORK_SPLIT,
  DIRECTOR_CONVERSATION_MIN_PX,
  DIRECTOR_DIAGNOSTICS_COLLAPSED_KEY,
  DIRECTOR_FOCUS_H_SPLIT_KEY,
  DIRECTOR_FOCUS_RATIO_MAX,
  DIRECTOR_FOCUS_RATIO_MIN,
  DIRECTOR_PRESENTATION_KEY,
  DIRECTOR_RESULT_MIN_PX,
  DIRECTOR_WORK_SPLIT_KEY,
  directorPresentationOf,
  clampLaneHeightPx,
  clampMixerWidth,
  clampLaneLabelPx,
  clampSplitRatio,
  loadDirectorComposerHeight,
  loadDirectorDiagnosticsCollapsed,
  loadDirectorFocus,
  loadDirectorFocusHSplitRatio,
  loadDirectorPresentation,
  loadDirectorSplitRatio,
  loadDirectorWorkSplitRatio,
  loadHSplitRatio,
  loadInspectorSectionCollapsed,
  laneHeaderPacksInline,
  loadLaneHeights,
  loadLaneLabelPx,
  GROUP_COLLAPSED_KEY,
  VOLUME_LANE_OPEN_KEY,
  loadCollapsedGroupIds,
  loadOpenVolumeLaneIds,
  loadInspectorCollapsed,
  loadInspectorOpen,
  loadMixerCollapsed,
  loadMixerWidth,
  loadNormalSplitRatio,
  loadSplitRatio,
  loadTimelineFocus,
  saveCollapsedGroupIds,
  saveOpenVolumeLaneIds,
  saveDirectorComposerHeight,
  saveDirectorDiagnosticsCollapsed,
  saveDirectorFocus,
  saveDirectorFocusHSplitRatio,
  saveDirectorPresentation,
  saveDirectorSplitRatio,
  saveDirectorWorkSplitRatio,
  saveHSplitRatio,
  saveInspectorCollapsed,
  saveInspectorSectionCollapsed,
  saveInspectorOpen,
  saveNormalSplitRatio,
  saveTimelineFocus,
  toggleCollapsedGroupId,
  toggleOpenVolumeLaneId,
  saveLaneHeights,
  saveLaneLabelPx,
  saveMixerCollapsed,
  saveMixerWidth,
  saveSplitRatio,
} from "../../src/core/layout-prefs";

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    setItem(key: string, value: string) {
      map.set(key, value);
    },
    map,
  };
}

describe("layout prefs", () => {
  it("clamps the preview/arrange split to the min heights", () => {
    expect(PREVIEW_MIN_PX).toBe(120);
    expect(ARRANGE_MIN_PX).toBe(200);
    expect(LOWER_STAGE_MIN_PX).toBe(TRANSPORT_MIN_PX + ARRANGE_MIN_PX);
    const available = 600;
    expect(clampSplitRatio(0, available) * available).toBeCloseTo(PREVIEW_MIN_PX, 5);
    expect((1 - clampSplitRatio(1, available)) * available).toBeCloseTo(LOWER_STAGE_MIN_PX, 5);
    expect(clampSplitRatio(0.5, available)).toBeCloseTo(0.5, 5);
  });

  it("pointer drag maps to a clamped ratio", () => {
    const stage = PREVIEW_MIN_PX + LOWER_STAGE_MIN_PX + 400 + SPLITTER_PX;
    const available = stage - SPLITTER_PX;
    const tall = applySplitPointer({ clientY: 80, stageTop: 0, stageHeight: stage });
    expect(tall.previewPx).toBeGreaterThanOrEqual(PREVIEW_MIN_PX);
    expect(tall.arrangePx).toBeGreaterThanOrEqual(LOWER_STAGE_MIN_PX);

    const low = applySplitPointer({ clientY: 20, stageTop: 0, stageHeight: stage });
    expect(low.previewPx).toBe(PREVIEW_MIN_PX);

    const high = applySplitPointer({ clientY: stage - 10, stageTop: 0, stageHeight: stage });
    expect(high.arrangePx).toBe(LOWER_STAGE_MIN_PX);
    expect(high.previewPx).toBe(available - LOWER_STAGE_MIN_PX);
  });

  it("normalizes extreme persisted split ratios against live stage geometry", () => {
    const available = 500;
    expect(normalizePersistedSplitRatio(0.99, available)).toBeCloseTo(
      1 - LOWER_STAGE_MIN_PX / available,
      5,
    );
    expect(normalizePersistedSplitRatio(-1, available)).toBeCloseTo(PREVIEW_MIN_PX / available, 5);
    expect(normalizePersistedSplitRatio(Number.NaN, available)).toBe(DEFAULT_SPLIT_RATIO);
    const short = legalSplitMins(200);
    expect(short.previewMin).toBeGreaterThan(0);
    expect(short.lowerMin).toBeGreaterThan(0);
    expect(short.previewMin + short.lowerMin).toBeLessThanOrEqual(200 + 1);
    expect(stageAvailableFromWindow(800)).toBeLessThan(800);
    expect(stageAvailableFromWindow(800)).toBeGreaterThan(PREVIEW_MIN_PX);
  });

  it("round-trips mixer collapsed and split ratio", () => {
    const store = memoryStorage();
    expect(loadMixerCollapsed(store)).toBe(false);
    saveMixerCollapsed(store, true);
    expect(store.map.get(MIXER_COLLAPSED_KEY)).toBe("1");
    expect(loadMixerCollapsed(store)).toBe(true);
    saveMixerCollapsed(store, false);
    expect(loadMixerCollapsed(store)).toBe(false);

    saveSplitRatio(store, 0.7);
    expect(store.map.get(SPLIT_RATIO_KEY)).toBe("0.7");
    expect(loadSplitRatio(store)).toBeCloseTo(0.7, 5);
    expect(loadSplitRatio(memoryStorage())).toBe(DEFAULT_SPLIT_RATIO);
    expect(loadSplitRatio(memoryStorage({ [SPLIT_RATIO_KEY]: "nope" }))).toBe(DEFAULT_SPLIT_RATIO);
  });

  it("horizontal preview/inspector split persists and clamps", () => {
    const available = 800;
    expect(clampHSplitRatio(0, available) * available).toBeCloseTo(PREVIEW_H_MIN_PX, 5);
    expect((1 - clampHSplitRatio(1, available)) * available).toBeCloseTo(INSPECTOR_MIN_PX, 5);

    const wide = applyHSplitPointer({ clientX: 20, workspaceLeft: 0, workspaceWidth: 808 });
    expect(wide.previewPx).toBe(PREVIEW_H_MIN_PX);
    const right = applyHSplitPointer({ clientX: 800, workspaceLeft: 0, workspaceWidth: 808 });
    expect(right.inspectorPx).toBe(INSPECTOR_MIN_PX);

    const store = memoryStorage();
    saveHSplitRatio(store, 0.62);
    expect(store.map.get(H_SPLIT_RATIO_KEY)).toBe("0.62");
    expect(loadHSplitRatio(store)).toBeCloseTo(0.62, 5);
    expect(loadHSplitRatio(memoryStorage())).toBe(DEFAULT_H_SPLIT_RATIO);
  });

  it("lane label width persists and clamps semantic min–160", () => {
    expect(clampLaneLabelPx(96)).toBe(DEFAULT_LANE_LABEL_PX);
    expect(clampLaneLabelPx(10)).toBe(LANE_LABEL_MIN_PX);
    expect(clampLaneLabelPx(400)).toBe(LANE_LABEL_MAX_PX);
    expect(clampLaneLabelPx(Number.NaN)).toBe(DEFAULT_LANE_LABEL_PX);
    const store = memoryStorage();
    expect(loadLaneLabelPx(store)).toBe(DEFAULT_LANE_LABEL_PX);
    saveLaneLabelPx(store, 140);
    expect(store.map.get(LANE_LABEL_PX_KEY)).toBe("140");
    expect(loadLaneLabelPx(store)).toBe(140);
    saveLaneLabelPx(store, 8);
    expect(loadLaneLabelPx(store)).toBe(LANE_LABEL_MIN_PX);
  });

  it("lane heights persist and clamp 36–120 per vis/video/audio group", () => {
    expect(clampLaneHeightPx(20)).toBe(LANE_HEIGHT_MIN_PX);
    expect(clampLaneHeightPx(200)).toBe(LANE_HEIGHT_MAX_PX);
    const store = memoryStorage();
    expect(loadLaneHeights(store)).toEqual({
      vis: DEFAULT_LANE_HEIGHT_PX,
      video: DEFAULT_LANE_HEIGHT_PX,
      audio: DEFAULT_LANE_HEIGHT_PX,
    });
    saveLaneHeights(store, { vis: 40, video: 80, audio: 200 });
    expect(JSON.parse(store.map.get(LANE_HEIGHTS_KEY)!)).toEqual({ vis: 40, video: 80, audio: 120 });
    expect(loadLaneHeights(store)).toEqual({ vis: 40, video: 80, audio: 120 });
  });

  it("clamps mixer width so the panel cannot collapse and the timeline stays usable", () => {
    expect(MIXER_MIN_PX).toBeGreaterThan(0);
    expect(MIXER_MIN_PX).toBeLessThan(MIXER_EXPANDED_PX);
    expect(MIXER_MAX_PX).toBeGreaterThan(MIXER_EXPANDED_PX);
    expect(clampMixerWidth(MIXER_EXPANDED_PX)).toBe(MIXER_EXPANDED_PX);
    expect(clampMixerWidth(0)).toBe(MIXER_MIN_PX);
    expect(clampMixerWidth(4000)).toBe(4000);
    expect(clampMixerWidth(20_000)).toBe(MIXER_MAX_PX);
    expect(clampMixerWidth(Number.NaN)).toBe(MIXER_EXPANDED_PX);
    const tight = MIXER_MIN_PX + TIMELINE_MIN_PX + 80;
    expect(clampMixerWidth(MIXER_MAX_PX, tight)).toBe(tight - TIMELINE_MIN_PX);
    expect(clampMixerWidth(10, tight)).toBe(MIXER_MIN_PX);
    const desktop = 1920;
    const followX = 400;
    const atFollow = applyMixerWidthPointer({ clientX: followX, arrangeLeft: 0, arrangeWidth: desktop });
    expect(atFollow.widthPx).toBe(desktop - followX);
    expect(atFollow.widthPx).toBeGreaterThan(1000);
    expect(clampMixerWidth(8000, desktop)).toBe(desktop - TIMELINE_MIN_PX);
    expect(clampMixerWidth(8000, 1440)).toBe(1440 - TIMELINE_MIN_PX);
    expect(TIMELINE_MIN_PX).toBeGreaterThan(0);
    expect(TIMELINE_MIN_PX).toBeLessThanOrEqual(200);
  });

  it("left-edge mixer drag: left widens, right narrows; persist round-trips", () => {
    const arrangeWidth = 900;
    const defaultRight = arrangeWidth - MIXER_EXPANDED_PX;
    const wider = applyMixerWidthPointer({ clientX: defaultRight - 80, arrangeLeft: 0, arrangeWidth });
    expect(wider.widthPx).toBe(MIXER_EXPANDED_PX + 80);
    const narrower = applyMixerWidthPointer({ clientX: defaultRight + 40, arrangeLeft: 0, arrangeWidth });
    expect(narrower.widthPx).toBe(MIXER_EXPANDED_PX - 40);
    const maxed = applyMixerWidthPointer({ clientX: 0, arrangeLeft: 0, arrangeWidth });
    expect(maxed.widthPx).toBeLessThanOrEqual(MIXER_MAX_PX);
    expect(maxed.widthPx).toBeLessThanOrEqual(arrangeWidth - TIMELINE_MIN_PX);
    const mined = applyMixerWidthPointer({ clientX: arrangeWidth, arrangeLeft: 0, arrangeWidth });
    expect(mined.widthPx).toBe(MIXER_MIN_PX);

    const store = memoryStorage();
    expect(loadMixerWidth(store)).toBe(MIXER_EXPANDED_PX);
    saveMixerWidth(store, 360);
    expect(store.map.get(MIXER_WIDTH_KEY)).toBe("360");
    expect(loadMixerWidth(store)).toBe(360);
    saveMixerWidth(store, 8);
    expect(loadMixerWidth(store)).toBe(MIXER_MIN_PX);
    expect(loadMixerWidth(memoryStorage({ [MIXER_WIDTH_KEY]: "nope" }))).toBe(MIXER_EXPANDED_PX);
  });

  it("auto-compacts mixer when Arrange is too narrow; unknown width stays expanded", () => {
    expect(MIXER_AUTO_COMPACT_ARRANGE_PX).toBe(TIMELINE_MIN_PX + MIXER_MIN_PX);
    expect(shouldAutoCompactMixer(0)).toBe(false);
    expect(shouldAutoCompactMixer(Number.NaN)).toBe(false);
    expect(shouldAutoCompactMixer(MIXER_AUTO_COMPACT_ARRANGE_PX - 1)).toBe(true);
    expect(shouldAutoCompactMixer(MIXER_AUTO_COMPACT_ARRANGE_PX)).toBe(false);
    expect(shouldAutoCompactMixer(1920)).toBe(false);
    expect(mixerChromeOf({ collapsed: false, autoCompact: false })).toBe("expanded");
    expect(mixerChromeOf({ collapsed: true, autoCompact: false })).toBe("compact");
    expect(mixerChromeOf({ collapsed: false, autoCompact: true })).toBe("compact");
  });

  it("persists chapter-group collapse ids in layout prefs", () => {
    const store = memoryStorage();
    expect(loadCollapsedGroupIds(store)).toEqual([]);
    saveCollapsedGroupIds(store, ["01", "g_x"]);
    expect(store.map.get(GROUP_COLLAPSED_KEY)).toBe(JSON.stringify(["01", "g_x"]));
    expect(loadCollapsedGroupIds(store)).toEqual(["01", "g_x"]);
    expect(toggleCollapsedGroupId(["01"], "01")).toEqual([]);
    expect(toggleCollapsedGroupId(["01"], "g_x")).toEqual(["01", "g_x"]);
    expect(loadCollapsedGroupIds(memoryStorage({ [GROUP_COLLAPSED_KEY]: '{"01":true,"g_x":false}' }))).toEqual([
      "01",
    ]);
  });

  it("persists open volume-automation lane ids (UI state only)", () => {
    const store = memoryStorage();
    expect(loadOpenVolumeLaneIds(store)).toEqual([]);
    saveOpenVolumeLaneIds(store, ["A1", "a_x"]);
    expect(store.map.get(VOLUME_LANE_OPEN_KEY)).toBe(JSON.stringify(["A1", "a_x"]));
    expect(loadOpenVolumeLaneIds(store)).toEqual(["A1", "a_x"]);
    expect(toggleOpenVolumeLaneId(["A1"], "A1")).toEqual([]);
    expect(toggleOpenVolumeLaneId(["A1"], "A2")).toEqual(["A1", "A2"]);
  });

  it("round-trips inspector open/closed as workspace prefs (default open)", () => {
    const store = memoryStorage();
    expect(INSPECTOR_COLLAPSED_PX).toBeGreaterThan(0);
    expect(INSPECTOR_COLLAPSED_PX).toBeLessThan(INSPECTOR_MIN_PX);
    expect(loadInspectorCollapsed(store)).toBe(false);
    expect(loadInspectorOpen(store)).toBe(true);
    saveInspectorCollapsed(store, true);
    expect(store.map.get(INSPECTOR_COLLAPSED_KEY)).toBe("1");
    expect(loadInspectorCollapsed(store)).toBe(true);
    expect(loadInspectorOpen(store)).toBe(false);
    saveInspectorOpen(store, true);
    expect(loadInspectorCollapsed(store)).toBe(false);
    expect(loadInspectorOpen(store)).toBe(true);
  });

  it("Timeline Focus stores the exact prior divider and restores it", () => {
    const available = PREVIEW_MIN_PX + ARRANGE_MIN_PX + 400;
    const enter = applyTimelineFocusToggle({
      currentlyFocused: false,
      currentRatio: 0.61,
      storedNormalRatio: DEFAULT_SPLIT_RATIO,
      availablePx: available,
    });
    expect(enter.focused).toBe(true);
    expect(enter.normalRatio).toBe(0.61);
    expect(enter.liveRatio).toBeCloseTo(timelineFocusSplitRatio(available), 5);
    expect(enter.liveRatio * available).toBeCloseTo(TIMELINE_FOCUS_PREVIEW_PX, 5);
    expect(enter.liveRatio).not.toBeCloseTo(0.61, 5);

    const leave = applyTimelineFocusToggle({
      currentlyFocused: true,
      currentRatio: enter.liveRatio,
      storedNormalRatio: enter.normalRatio,
      availablePx: available,
    });
    expect(leave.focused).toBe(false);
    expect(leave.liveRatio).toBe(0.61);
    expect(leave.normalRatio).toBe(0.61);

    const store = memoryStorage();
    expect(loadTimelineFocus(store)).toBe(false);
    saveTimelineFocus(store, true);
    expect(store.map.get(TIMELINE_FOCUS_KEY)).toBe("1");
    expect(loadTimelineFocus(store)).toBe(true);
    saveNormalSplitRatio(store, 0.61);
    expect(store.map.get(NORMAL_SPLIT_RATIO_KEY)).toBe("0.61");
    expect(loadNormalSplitRatio(store)).toBeCloseTo(0.61, 5);
    expect(loadNormalSplitRatio(memoryStorage())).toBe(DEFAULT_SPLIT_RATIO);
  });

  it("packs V/A/VIS headers inline below the stacked name + chrome threshold", () => {
    expect(LANE_HEADER_STACK_MIN_PX).toBeGreaterThan(LANE_HEIGHT_MIN_PX);
    expect(LANE_HEADER_STACK_MIN_PX).toBeLessThanOrEqual(DEFAULT_LANE_HEIGHT_PX);
    expect(laneHeaderPacksInline(LANE_HEIGHT_MIN_PX)).toBe(true);
    expect(laneHeaderPacksInline(LANE_HEADER_STACK_MIN_PX - 1)).toBe(true);
    expect(laneHeaderPacksInline(LANE_HEADER_STACK_MIN_PX)).toBe(false);
    expect(laneHeaderPacksInline(DEFAULT_LANE_HEIGHT_PX)).toBe(false);
    expect(laneHeaderPacksInline(Number.NaN)).toBe(false);
  });

  it("caps inspector width on ultrawide without changing tight mins", () => {
    const tight = 800;
    expect(clampHSplitRatio(0, tight) * tight).toBeCloseTo(PREVIEW_H_MIN_PX, 5);
    expect((1 - clampHSplitRatio(1, tight)) * tight).toBeCloseTo(INSPECTOR_MIN_PX, 5);
    const ultra = 5120 - 14;
    expect((1 - clampHSplitRatio(0, ultra)) * ultra).toBeCloseTo(INSPECTOR_MAX_PX, 5);
    expect((1 - clampHSplitRatio(1, ultra)) * ultra).toBeCloseTo(INSPECTOR_MIN_PX, 5);
    expect(INSPECTOR_MAX_PX).toBeGreaterThan(INSPECTOR_MIN_PX);
  });

  it("clamps Director/Inspector split and persists workspace prefs only", () => {
    const available = 400;
    expect(clampDirectorSplitRatio(0, available) * available).toBeCloseTo(INSPECTOR_SECTION_MIN_PX, 5);
    expect((1 - clampDirectorSplitRatio(1, available)) * available).toBeCloseTo(DIRECTOR_SECTION_MIN_PX, 5);
    const dragged = applyDirectorSplitPointer({ clientY: 20, bodyTop: 0, bodyHeight: 408 });
    expect(dragged.inspectorPx).toBe(INSPECTOR_SECTION_MIN_PX);
    const store = memoryStorage();
    expect(loadDirectorSplitRatio(store)).toBe(DEFAULT_DIRECTOR_SPLIT_RATIO);
    saveDirectorSplitRatio(store, 0.4);
    expect(store.map.get(DIRECTOR_SPLIT_RATIO_KEY)).toBe("0.4");
    expect(loadDirectorSplitRatio(store)).toBeCloseTo(0.4, 5);
    expect(loadInspectorSectionCollapsed(store)).toBe(false);
    saveInspectorSectionCollapsed(store, true);
    expect(store.map.get(INSPECTOR_SECTION_COLLAPSED_KEY)).toBe("1");
    expect(loadInspectorSectionCollapsed(store)).toBe(true);
    expect(loadDirectorFocus(store)).toBe(false);
    saveDirectorFocus(store, true);
    expect(store.map.get(DIRECTOR_FOCUS_KEY)).toBe("1");
    expect(clampComposerHeightPx(10)).toBe(COMPOSER_MIN_PX);
    expect(clampComposerHeightPx(400)).toBe(COMPOSER_MAX_PX);
    expect(loadDirectorComposerHeight(store)).toBe(DEFAULT_COMPOSER_HEIGHT_PX);
    saveDirectorComposerHeight(store, 120);
    expect(loadDirectorComposerHeight(store)).toBe(120);
  });

  it("Director Focus collapses Inspector and restores the prior split", () => {
    const enter = applyDirectorFocusToggle({
      currentlyFocused: false,
      inspectorSectionCollapsed: false,
      currentSplitRatio: 0.41,
      storedNormalSplit: DEFAULT_DIRECTOR_SPLIT_RATIO,
      storedSectionCollapsed: false,
    });
    expect(enter.focused).toBe(true);
    expect(enter.inspectorSectionCollapsed).toBe(true);
    expect(enter.normalSplit).toBe(0.41);
    expect(enter.restoreSectionCollapsed).toBe(false);

    const leave = applyDirectorFocusToggle({
      currentlyFocused: true,
      inspectorSectionCollapsed: true,
      currentSplitRatio: 0.41,
      storedNormalSplit: 0.41,
      storedSectionCollapsed: false,
    });
    expect(leave.focused).toBe(false);
    expect(leave.inspectorSectionCollapsed).toBe(false);
    expect(leave.splitRatio).toBe(0.41);
  });

  it("Director Focus uses a 35–45% working width and restores docked width", () => {
    const available = 1920;
    expect(DIRECTOR_FOCUS_RATIO_MIN).toBe(0.35);
    expect(DIRECTOR_FOCUS_RATIO_MAX).toBe(0.45);
    expect(DEFAULT_DIRECTOR_FOCUS_RATIO).toBeCloseTo(0.4, 5);
    expect((1 - clampFocusHSplitRatio(1, available)) / 1).toBeCloseTo(DIRECTOR_FOCUS_RATIO_MIN, 5);
    expect((1 - clampFocusHSplitRatio(0, available))).toBeCloseTo(DIRECTOR_FOCUS_RATIO_MAX, 5);
    const mid = applyFocusHSplitPointer({
      clientX: available * 0.6,
      workspaceLeft: 0,
      workspaceWidth: available + 14,
    });
    expect(mid.inspectorPx / available).toBeGreaterThanOrEqual(DIRECTOR_FOCUS_RATIO_MIN - 0.001);
    expect(mid.inspectorPx / available).toBeLessThanOrEqual(DIRECTOR_FOCUS_RATIO_MAX + 0.001);

    const enter = applyDirectorFocusToggle({
      currentlyFocused: false,
      inspectorSectionCollapsed: false,
      currentSplitRatio: 0.28,
      storedNormalSplit: 0.28,
      storedSectionCollapsed: false,
      currentHSplit: 0.74,
      storedDockedHSplit: 0.74,
      storedFocusHSplit: DEFAULT_DIRECTOR_FOCUS_H_SPLIT,
      availablePx: available,
    });
    expect(enter.focused).toBe(true);
    expect(enter.dockedHSplit).toBeCloseTo(0.74, 5);
    expect(1 - enter.hSplitRatio).toBeGreaterThanOrEqual(DIRECTOR_FOCUS_RATIO_MIN - 0.001);
    expect(1 - enter.hSplitRatio).toBeLessThanOrEqual(DIRECTOR_FOCUS_RATIO_MAX + 0.001);

    const leave = applyDirectorFocusToggle({
      currentlyFocused: true,
      inspectorSectionCollapsed: true,
      currentSplitRatio: 0.28,
      storedNormalSplit: 0.28,
      storedSectionCollapsed: false,
      currentHSplit: enter.hSplitRatio,
      storedDockedHSplit: 0.74,
      storedFocusHSplit: enter.hSplitRatio,
      availablePx: available,
    });
    expect(leave.focused).toBe(false);
    expect(leave.hSplitRatio).toBeCloseTo(0.74, 5);
    expect(leave.focusHSplit).toBeCloseTo(enter.hSplitRatio, 5);
  });

  it("persists Director presentation, focus width, work split, and diagnostics locally", () => {
    const store = memoryStorage();
    expect(directorPresentationOf({ inspectorCollapsed: true, directorEnabled: true, directorFocus: false })).toBe(
      "collapsed",
    );
    expect(directorPresentationOf({ inspectorCollapsed: false, directorEnabled: true, directorFocus: false })).toBe(
      "docked",
    );
    expect(directorPresentationOf({ inspectorCollapsed: false, directorEnabled: true, directorFocus: true })).toBe(
      "focus",
    );
    expect(directorPresentationOf({ inspectorCollapsed: false, directorEnabled: false, directorFocus: true })).toBe(
      "collapsed",
    );
    saveDirectorPresentation(store, "focus");
    expect(store.map.get(DIRECTOR_PRESENTATION_KEY)).toBe("focus");
    expect(loadDirectorPresentation(store)).toBe("focus");
    saveDirectorFocusHSplitRatio(store, DEFAULT_DIRECTOR_FOCUS_H_SPLIT);
    expect(store.map.get(DIRECTOR_FOCUS_H_SPLIT_KEY)).toBe(String(DEFAULT_DIRECTOR_FOCUS_H_SPLIT));
    expect(loadDirectorFocusHSplitRatio(store)).toBeCloseTo(DEFAULT_DIRECTOR_FOCUS_H_SPLIT, 5);
    expect(loadDirectorWorkSplitRatio(store)).toBe(DEFAULT_DIRECTOR_WORK_SPLIT);
    saveDirectorWorkSplitRatio(store, 0.72);
    expect(store.map.get(DIRECTOR_WORK_SPLIT_KEY)).toBe("0.72");
    expect(loadDirectorWorkSplitRatio(store)).toBeCloseTo(0.72, 5);
    expect(loadDirectorDiagnosticsCollapsed(store)).toBe(true);
    saveDirectorDiagnosticsCollapsed(store, false);
    expect(store.map.get(DIRECTOR_DIAGNOSTICS_COLLAPSED_KEY)).toBe("0");
    expect(loadDirectorDiagnosticsCollapsed(store)).toBe(false);
    const work = applyDirectorWorkSplitPointer({ clientY: 10, workTop: 0, workHeight: 248 });
    expect(work.conversationPx).toBeGreaterThanOrEqual(DIRECTOR_CONVERSATION_MIN_PX);
    expect(work.resultPx).toBeGreaterThanOrEqual(DIRECTOR_RESULT_MIN_PX);
    const available = 248;
    expect(clampDirectorWorkSplitRatio(0, available) * available).toBeCloseTo(DIRECTOR_CONVERSATION_MIN_PX, 5);
    expect((1 - clampDirectorWorkSplitRatio(1, available)) * available).toBeCloseTo(DIRECTOR_RESULT_MIN_PX, 5);
  });
});
