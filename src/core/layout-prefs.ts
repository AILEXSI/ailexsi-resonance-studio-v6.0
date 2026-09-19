/** Session chrome (mixer/inspector fold + preview/arrange split). localStorage is enough. */

export const MIXER_COLLAPSED_KEY = "resonance-studio-v6-0-mixer-collapsed";
export const INSPECTOR_COLLAPSED_KEY = "resonance-studio-v6-0-inspector-collapsed";
export const SPLIT_RATIO_KEY = "resonance-studio-v6-0-preview-split";
export const H_SPLIT_RATIO_KEY = "resonance-studio-v6-0-preview-h-split";
export const TIMELINE_FOCUS_KEY = "resonance-studio-v6-0-timeline-focus";
export const NORMAL_SPLIT_RATIO_KEY = "resonance-studio-v6-0-normal-preview-split";
export const LANE_LABEL_PX_KEY = "resonance-studio-v6-0-lane-label-px";
export const LANE_HEIGHTS_KEY = "resonance-studio-v6-0-lane-heights";

export const DEFAULT_LANE_LABEL_PX = 96;
/**
 * Semantic header floor: identity + Mute + overflow chevron (pad/gaps/hits).
 * Must stay equal to `headerUsableMinPx()` — not a Solo/W/VOL/Group budget.
 */
export const LANE_LABEL_MIN_PX = 80;
export const LANE_LABEL_MAX_PX = 160;
export const DEFAULT_LANE_HEIGHT_PX = 52;
export const LANE_HEIGHT_MIN_PX = 36;
export const LANE_HEIGHT_MAX_PX = 120;
/** Stacked name + M/S (or VIS M + scene) needs ~44px (14px label, 4px gap, ~20px buttons). */
export const LANE_HEADER_STACK_MIN_PX = 46;

export type LaneHeightGroup = "vis" | "video" | "audio";
export interface LaneHeights {
  vis: number;
  video: number;
  audio: number;
}

export const PREVIEW_MIN_PX = 120;
export const ARRANGE_MIN_PX = 200;
export const SPLITTER_PX = 18;
export const DEFAULT_SPLIT_RATIO = 0.52;
export const PREVIEW_H_MIN_PX = 200;
export const INSPECTOR_MIN_PX = 180;
/** Cap so ultrawide Preview/Timeline stay usable. Does not change tight-viewport mins. */
export const INSPECTOR_MAX_PX = 720;
export const H_SPLITTER_PX = 14;
export const DEFAULT_H_SPLIT_RATIO = 0.74;
export const DIRECTOR_SPLITTER_PX = 8;
export const INSPECTOR_SECTION_MIN_PX = 64;
export const DIRECTOR_SECTION_MIN_PX = 180;
export const DEFAULT_DIRECTOR_SPLIT_RATIO = 0.28;
export const COMPOSER_MIN_PX = 56;
export const COMPOSER_MAX_PX = 200;
export const DEFAULT_COMPOSER_HEIGHT_PX = 72;
export const GROUP_COLLAPSED_KEY = "resonance-studio-v6-0-group-collapsed";
export const VOLUME_LANE_OPEN_KEY = "resonance-studio-v6-0-volume-lane-open";
/** Extra Volume sub-lane height. Clip lanes stay at their existing height. */
export const VOLUME_LANE_HEIGHT_PX = 48;
/** Chapter/group header row. Collapse UI only — not a clip lane. */
export const GROUP_LANE_HEIGHT_PX = 28;

/** Inline box lock so content (filmstrip / W+VOL chrome) cannot stretch a lane. */
export function fixedLaneBoxStyle(px: number): { height: number; minHeight: number; maxHeight: number } {
  const h = Number.isFinite(px) ? Math.max(1, Math.round(px)) : DEFAULT_LANE_HEIGHT_PX;
  return { height: h, minHeight: h, maxHeight: h };
}
export const MIXER_WIDTH_KEY = "resonance-studio-v6-0-mixer-width";
/** Inspector section collapsed inside the right sidebar while Director stays open. */
export const INSPECTOR_SECTION_COLLAPSED_KEY = "resonance-studio-v6-0-inspector-section-collapsed";
/** Inspector/Director vertical split (inspector fraction). */
export const DIRECTOR_SPLIT_RATIO_KEY = "resonance-studio-v6-0-director-split";
/** Split restored when leaving Director Focus. */
export const DIRECTOR_NORMAL_SPLIT_KEY = "resonance-studio-v6-0-director-normal-split";
export const DIRECTOR_FOCUS_KEY = "resonance-studio-v6-0-director-focus";
export const DIRECTOR_COMPOSER_HEIGHT_KEY = "resonance-studio-v6-0-director-composer-height";
/** collapsed | docked | focus — local chrome only, not Project. */
export const DIRECTOR_PRESENTATION_KEY = "resonance-studio-v6-0-director-presentation";
/** Preview fraction while Director Focus owns the right column (~35–45% Director). */
export const DIRECTOR_FOCUS_H_SPLIT_KEY = "resonance-studio-v6-0-director-focus-h-split";
/** Conversation fraction of the Director work split (conversation vs result). */
export const DIRECTOR_WORK_SPLIT_KEY = "resonance-studio-v6-0-director-work-split";
export const DIRECTOR_DIAGNOSTICS_COLLAPSED_KEY = "resonance-studio-v6-0-director-diagnostics-collapsed";

export type DirectorPresentation = "collapsed" | "docked" | "focus";
/** Director column fraction of the preview workspace while Focused. */
export const DIRECTOR_FOCUS_RATIO_MIN = 0.35;
export const DIRECTOR_FOCUS_RATIO_MAX = 0.45;
export const DEFAULT_DIRECTOR_FOCUS_RATIO = 0.4;
export const DEFAULT_DIRECTOR_FOCUS_H_SPLIT = 1 - DEFAULT_DIRECTOR_FOCUS_RATIO;
export const DIRECTOR_CONVERSATION_MIN_PX = 96;
export const DIRECTOR_RESULT_MIN_PX = 72;
export const DEFAULT_DIRECTOR_WORK_SPLIT = 0.68;
export const DIRECTOR_WORK_SPLITTER_PX = 8;
export const MIXER_EXPANDED_PX = 228;
export const MIXER_COLLAPSED_PX = 56;
/** Expanded mixer: MST + ≥1 channel peek + chrome. Never 0. */
export const MIXER_MIN_PX = 120;
/**
 * Persist/load fallback only — never used as the live drag cap.
 * Live max is always arrangeWidth − TIMELINE_MIN_PX (Follow-region reachable).
 */
export const MIXER_MAX_PX = 8192;
/** Thin usable timeline (lane labels + a clip sliver). Divider can reach Follow. */
export const TIMELINE_MIN_PX = 160;
export const MIXER_SPLITTER_PX = 8;
/** Closed inspector: reopen strip only. Same workspace language as MIXER_COLLAPSED_PX. */
export const INSPECTOR_COLLAPSED_PX = 32;
/** Compact Preview height while Timeline Focus is on. Existing splitter still works. */
export const TIMELINE_FOCUS_PREVIEW_PX = 160;
export const TIMELINE_FOCUS_SPLIT_RATIO = 0.22;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function clampSplitRatio(ratio: number, availablePx: number): number {
  if (!Number.isFinite(ratio)) return DEFAULT_SPLIT_RATIO;
  if (!Number.isFinite(availablePx) || availablePx <= 0) {
    return Math.min(0.85, Math.max(0.15, ratio));
  }
  const minR = PREVIEW_MIN_PX / availablePx;
  const maxR = 1 - ARRANGE_MIN_PX / availablePx;
  if (minR >= maxR) {
    return PREVIEW_MIN_PX / (PREVIEW_MIN_PX + ARRANGE_MIN_PX);
  }
  return Math.min(maxR, Math.max(minR, ratio));
}

export function applySplitPointer(opts: {
  clientY: number;
  stageTop: number;
  stageHeight: number;
  splitterPx?: number;
}): { ratio: number; previewPx: number; arrangePx: number } {
  const splitter = opts.splitterPx ?? SPLITTER_PX;
  const available = Math.max(1, opts.stageHeight - splitter);
  const ratio = clampSplitRatio((opts.clientY - opts.stageTop) / available, available);
  const previewPx = Math.round(ratio * available);
  return { ratio, previewPx, arrangePx: available - previewPx };
}

export function loadCollapsedGroupIds(storage?: StorageLike | null): string[] {
  try {
    const raw = storage?.getItem(GROUP_COLLAPSED_KEY);
    if (raw == null || raw === "") return [];
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter((id): id is string => typeof id === "string" && id.length > 0);
    }
    if (parsed && typeof parsed === "object") {
      return Object.entries(parsed as Record<string, unknown>)
        .filter(([, collapsed]) => collapsed === true)
        .map(([id]) => id)
        .filter((id) => id.length > 0);
    }
    return [];
  } catch {
    return [];
  }
}

export function saveCollapsedGroupIds(
  storage: StorageLike | null | undefined,
  ids: Iterable<string>,
): void {
  try {
    const unique = [...new Set([...ids].filter((id) => typeof id === "string" && id.length > 0))];
    storage?.setItem(GROUP_COLLAPSED_KEY, JSON.stringify(unique));
  } catch {
    /* quota / private mode */
  }
}

export function toggleCollapsedGroupId(ids: readonly string[], groupId: string): string[] {
  if (!groupId) return [...ids];
  return ids.includes(groupId) ? ids.filter((id) => id !== groupId) : [...ids, groupId];
}

export function loadOpenVolumeLaneIds(storage?: StorageLike | null): string[] {
  try {
    const raw = storage?.getItem(VOLUME_LANE_OPEN_KEY);
    if (raw == null || raw === "") return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string" && id.length > 0);
  } catch {
    return [];
  }
}

export function saveOpenVolumeLaneIds(
  storage: StorageLike | null | undefined,
  ids: Iterable<string>,
): void {
  try {
    const unique = [...new Set([...ids].filter((id) => typeof id === "string" && id.length > 0))];
    storage?.setItem(VOLUME_LANE_OPEN_KEY, JSON.stringify(unique));
  } catch {
    /* quota / private mode */
  }
}

export function toggleOpenVolumeLaneId(ids: readonly string[], trackId: string): string[] {
  if (!trackId) return [...ids];
  return ids.includes(trackId) ? ids.filter((id) => id !== trackId) : [...ids, trackId];
}

export function loadMixerCollapsed(storage?: StorageLike | null): boolean {
  try {
    return storage?.getItem(MIXER_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveMixerCollapsed(storage: StorageLike | null | undefined, collapsed: boolean): void {
  try {
    storage?.setItem(MIXER_COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    /* quota / private mode */
  }
}

/** Default open (missing key). Workspace pref — not project data. */
export function loadInspectorCollapsed(storage?: StorageLike | null): boolean {
  try {
    return storage?.getItem(INSPECTOR_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveInspectorCollapsed(storage: StorageLike | null | undefined, collapsed: boolean): void {
  try {
    storage?.setItem(INSPECTOR_COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    /* quota / private mode */
  }
}

export function loadInspectorOpen(storage?: StorageLike | null): boolean {
  return !loadInspectorCollapsed(storage);
}

export function saveInspectorOpen(storage: StorageLike | null | undefined, open: boolean): void {
  saveInspectorCollapsed(storage, !open);
}

export function mixerWidthMax(arrangeWidthPx?: number): number {
  if (arrangeWidthPx != null && Number.isFinite(arrangeWidthPx) && arrangeWidthPx > 0) {
    return Math.max(MIXER_MIN_PX, arrangeWidthPx - TIMELINE_MIN_PX);
  }
  return MIXER_MAX_PX;
}

export function clampMixerWidth(px: number, arrangeWidthPx?: number): number {
  if (!Number.isFinite(px)) return MIXER_EXPANDED_PX;
  return Math.round(Math.min(mixerWidthMax(arrangeWidthPx), Math.max(MIXER_MIN_PX, px)));
}

/** Left-edge divider: drag left → wider mixer; drag right → narrower. */
export function applyMixerWidthPointer(opts: {
  clientX: number;
  arrangeLeft: number;
  arrangeWidth: number;
}): { widthPx: number } {
  const mixerPx = opts.arrangeLeft + opts.arrangeWidth - opts.clientX;
  return { widthPx: clampMixerWidth(mixerPx, opts.arrangeWidth) };
}

export function loadMixerWidth(storage?: StorageLike | null): number {
  try {
    const raw = storage?.getItem(MIXER_WIDTH_KEY);
    if (raw == null) return MIXER_EXPANDED_PX;
    return clampMixerWidth(Number(raw));
  } catch {
    return MIXER_EXPANDED_PX;
  }
}

export function saveMixerWidth(storage: StorageLike | null | undefined, px: number): void {
  try {
    storage?.setItem(MIXER_WIDTH_KEY, String(clampMixerWidth(px)));
  } catch {
    /* quota / private mode */
  }
}

export function loadSplitRatio(storage?: StorageLike | null): number {
  try {
    const raw = storage?.getItem(SPLIT_RATIO_KEY);
    if (raw == null) return DEFAULT_SPLIT_RATIO;
    const n = Number(raw);
    if (!Number.isFinite(n)) return DEFAULT_SPLIT_RATIO;
    return clampSplitRatio(n, PREVIEW_MIN_PX + ARRANGE_MIN_PX + 400);
  } catch {
    return DEFAULT_SPLIT_RATIO;
  }
}

export function saveSplitRatio(storage: StorageLike | null | undefined, ratio: number): void {
  try {
    if (!Number.isFinite(ratio)) return;
    storage?.setItem(SPLIT_RATIO_KEY, String(ratio));
  } catch {
    /* quota / private mode */
  }
}

export function clampHSplitRatio(ratio: number, availablePx: number): number {
  if (!Number.isFinite(ratio)) return DEFAULT_H_SPLIT_RATIO;
  if (!Number.isFinite(availablePx) || availablePx <= 0) {
    return Math.min(0.9, Math.max(0.35, ratio));
  }
  const minR = Math.max(PREVIEW_H_MIN_PX / availablePx, 1 - INSPECTOR_MAX_PX / availablePx);
  const maxR = 1 - INSPECTOR_MIN_PX / availablePx;
  if (minR >= maxR) {
    return PREVIEW_H_MIN_PX / (PREVIEW_H_MIN_PX + INSPECTOR_MIN_PX);
  }
  return Math.min(maxR, Math.max(minR, ratio));
}

export function applyHSplitPointer(opts: {
  clientX: number;
  workspaceLeft: number;
  workspaceWidth: number;
  splitterPx?: number;
}): { ratio: number; previewPx: number; inspectorPx: number } {
  const splitter = opts.splitterPx ?? H_SPLITTER_PX;
  const available = Math.max(1, opts.workspaceWidth - splitter);
  const ratio = clampHSplitRatio((opts.clientX - opts.workspaceLeft) / available, available);
  const previewPx = Math.round(ratio * available);
  return { ratio, previewPx, inspectorPx: available - previewPx };
}

export function loadHSplitRatio(storage?: StorageLike | null): number {
  try {
    const raw = storage?.getItem(H_SPLIT_RATIO_KEY);
    if (raw == null) return DEFAULT_H_SPLIT_RATIO;
    const n = Number(raw);
    if (!Number.isFinite(n)) return DEFAULT_H_SPLIT_RATIO;
    return clampHSplitRatio(n, PREVIEW_H_MIN_PX + INSPECTOR_MIN_PX + 600);
  } catch {
    return DEFAULT_H_SPLIT_RATIO;
  }
}

export function saveHSplitRatio(storage: StorageLike | null | undefined, ratio: number): void {
  try {
    if (!Number.isFinite(ratio)) return;
    storage?.setItem(H_SPLIT_RATIO_KEY, String(ratio));
  } catch {
    /* quota / private mode */
  }
}

/** inspectorWidth — existing preview↔inspector split. Reuse; do not invent a second width store. */
export const loadInspectorWidthRatio = loadHSplitRatio;
export const saveInspectorWidthRatio = saveHSplitRatio;

export function loadTimelineFocus(storage?: StorageLike | null): boolean {
  try {
    return storage?.getItem(TIMELINE_FOCUS_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveTimelineFocus(storage: StorageLike | null | undefined, focused: boolean): void {
  try {
    storage?.setItem(TIMELINE_FOCUS_KEY, focused ? "1" : "0");
  } catch {
    /* quota / private mode */
  }
}

export function loadNormalSplitRatio(storage?: StorageLike | null): number {
  try {
    const raw = storage?.getItem(NORMAL_SPLIT_RATIO_KEY);
    if (raw == null) return loadSplitRatio(storage);
    const n = Number(raw);
    if (!Number.isFinite(n)) return loadSplitRatio(storage);
    return clampSplitRatio(n, PREVIEW_MIN_PX + ARRANGE_MIN_PX + 400);
  } catch {
    return loadSplitRatio(storage);
  }
}

export function saveNormalSplitRatio(storage: StorageLike | null | undefined, ratio: number): void {
  try {
    if (!Number.isFinite(ratio)) return;
    storage?.setItem(NORMAL_SPLIT_RATIO_KEY, String(ratio));
  } catch {
    /* quota / private mode */
  }
}

export function timelineFocusSplitRatio(availablePx?: number): number {
  if (availablePx != null && Number.isFinite(availablePx) && availablePx > 0) {
    return clampSplitRatio(TIMELINE_FOCUS_PREVIEW_PX / availablePx, availablePx);
  }
  return clampSplitRatio(TIMELINE_FOCUS_SPLIT_RATIO, PREVIEW_MIN_PX + ARRANGE_MIN_PX + 400);
}

/** NORMAL ↔ Timeline Focus. Leaving restores the exact stored normal divider. */
export function applyTimelineFocusToggle(opts: {
  currentlyFocused: boolean;
  currentRatio: number;
  storedNormalRatio: number;
  availablePx?: number;
}): { focused: boolean; liveRatio: number; normalRatio: number } {
  if (!opts.currentlyFocused) {
    const normalRatio = Number.isFinite(opts.currentRatio) ? opts.currentRatio : DEFAULT_SPLIT_RATIO;
    return {
      focused: true,
      liveRatio: timelineFocusSplitRatio(opts.availablePx),
      normalRatio,
    };
  }
  const restored = Number.isFinite(opts.storedNormalRatio) ? opts.storedNormalRatio : DEFAULT_SPLIT_RATIO;
  return {
    focused: false,
    liveRatio: restored,
    normalRatio: restored,
  };
}

export function clampLaneLabelPx(px: number): number {
  if (!Number.isFinite(px)) return DEFAULT_LANE_LABEL_PX;
  return Math.round(Math.min(LANE_LABEL_MAX_PX, Math.max(LANE_LABEL_MIN_PX, px)));
}

export function loadLaneLabelPx(storage?: StorageLike | null): number {
  try {
    const raw = storage?.getItem(LANE_LABEL_PX_KEY);
    if (raw == null) return DEFAULT_LANE_LABEL_PX;
    return clampLaneLabelPx(Number(raw));
  } catch {
    return DEFAULT_LANE_LABEL_PX;
  }
}

export function saveLaneLabelPx(storage: StorageLike | null | undefined, px: number): void {
  try {
    storage?.setItem(LANE_LABEL_PX_KEY, String(clampLaneLabelPx(px)));
  } catch {
    /* quota / private mode */
  }
}

export function clampLaneHeightPx(px: number): number {
  if (!Number.isFinite(px)) return DEFAULT_LANE_HEIGHT_PX;
  return Math.round(Math.min(LANE_HEIGHT_MAX_PX, Math.max(LANE_HEIGHT_MIN_PX, px)));
}

export function defaultLaneHeights(): LaneHeights {
  return {
    vis: DEFAULT_LANE_HEIGHT_PX,
    video: DEFAULT_LANE_HEIGHT_PX,
    audio: DEFAULT_LANE_HEIGHT_PX,
  };
}

export function clampLaneHeights(raw: Partial<LaneHeights> | null | undefined): LaneHeights {
  const base = defaultLaneHeights();
  return {
    vis: clampLaneHeightPx(raw?.vis ?? base.vis),
    video: clampLaneHeightPx(raw?.video ?? base.video),
    audio: clampLaneHeightPx(raw?.audio ?? base.audio),
  };
}

export function loadLaneHeights(storage?: StorageLike | null): LaneHeights {
  try {
    const raw = storage?.getItem(LANE_HEIGHTS_KEY);
    if (raw == null) return defaultLaneHeights();
    const parsed = JSON.parse(raw) as Partial<LaneHeights>;
    return clampLaneHeights(parsed);
  } catch {
    return defaultLaneHeights();
  }
}

export function saveLaneHeights(storage: StorageLike | null | undefined, heights: LaneHeights): void {
  try {
    storage?.setItem(LANE_HEIGHTS_KEY, JSON.stringify(clampLaneHeights(heights)));
  } catch {
    /* quota / private mode */
  }
}

export function heightGroupOfLane(id: string): LaneHeightGroup {
  if (id === "VIS") return "vis";
  if (id === "V1" || id === "V2") return "video";
  return "audio";
}

/** When a V/A/VIS header is shorter than the stacked name + chrome block, pack them in one row. */
export function laneHeaderPacksInline(heightPx: number): boolean {
  return Number.isFinite(heightPx) && heightPx < LANE_HEADER_STACK_MIN_PX;
}

export function loadInspectorSectionCollapsed(storage?: StorageLike | null): boolean {
  try {
    return storage?.getItem(INSPECTOR_SECTION_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveInspectorSectionCollapsed(
  storage: StorageLike | null | undefined,
  collapsed: boolean,
): void {
  try {
    storage?.setItem(INSPECTOR_SECTION_COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    /* quota / private mode */
  }
}

export function clampDirectorSplitRatio(ratio: number, availablePx: number): number {
  if (!Number.isFinite(ratio)) return DEFAULT_DIRECTOR_SPLIT_RATIO;
  if (!Number.isFinite(availablePx) || availablePx <= 0) {
    return Math.min(0.7, Math.max(0.12, ratio));
  }
  const minR = INSPECTOR_SECTION_MIN_PX / availablePx;
  const maxR = 1 - DIRECTOR_SECTION_MIN_PX / availablePx;
  if (minR >= maxR) {
    return INSPECTOR_SECTION_MIN_PX / (INSPECTOR_SECTION_MIN_PX + DIRECTOR_SECTION_MIN_PX);
  }
  return Math.min(maxR, Math.max(minR, ratio));
}

export function applyDirectorSplitPointer(opts: {
  clientY: number;
  bodyTop: number;
  bodyHeight: number;
  splitterPx?: number;
}): { ratio: number; inspectorPx: number; directorPx: number } {
  const splitter = opts.splitterPx ?? DIRECTOR_SPLITTER_PX;
  const available = Math.max(1, opts.bodyHeight - splitter);
  const ratio = clampDirectorSplitRatio((opts.clientY - opts.bodyTop) / available, available);
  const inspectorPx = Math.round(ratio * available);
  return { ratio, inspectorPx, directorPx: available - inspectorPx };
}

export function loadDirectorSplitRatio(storage?: StorageLike | null): number {
  try {
    const raw = storage?.getItem(DIRECTOR_SPLIT_RATIO_KEY);
    if (raw == null) return DEFAULT_DIRECTOR_SPLIT_RATIO;
    const n = Number(raw);
    if (!Number.isFinite(n)) return DEFAULT_DIRECTOR_SPLIT_RATIO;
    return clampDirectorSplitRatio(n, INSPECTOR_SECTION_MIN_PX + DIRECTOR_SECTION_MIN_PX + 400);
  } catch {
    return DEFAULT_DIRECTOR_SPLIT_RATIO;
  }
}

export function saveDirectorSplitRatio(storage: StorageLike | null | undefined, ratio: number): void {
  try {
    if (!Number.isFinite(ratio)) return;
    storage?.setItem(DIRECTOR_SPLIT_RATIO_KEY, String(ratio));
  } catch {
    /* quota / private mode */
  }
}

export function loadDirectorNormalSplitRatio(storage?: StorageLike | null): number {
  try {
    const raw = storage?.getItem(DIRECTOR_NORMAL_SPLIT_KEY);
    if (raw == null) return loadDirectorSplitRatio(storage);
    const n = Number(raw);
    if (!Number.isFinite(n)) return loadDirectorSplitRatio(storage);
    return clampDirectorSplitRatio(n, INSPECTOR_SECTION_MIN_PX + DIRECTOR_SECTION_MIN_PX + 400);
  } catch {
    return loadDirectorSplitRatio(storage);
  }
}

export function saveDirectorNormalSplitRatio(
  storage: StorageLike | null | undefined,
  ratio: number,
): void {
  try {
    if (!Number.isFinite(ratio)) return;
    storage?.setItem(DIRECTOR_NORMAL_SPLIT_KEY, String(ratio));
  } catch {
    /* quota / private mode */
  }
}

export function loadDirectorFocus(storage?: StorageLike | null): boolean {
  try {
    return storage?.getItem(DIRECTOR_FOCUS_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveDirectorFocus(storage: StorageLike | null | undefined, focused: boolean): void {
  try {
    storage?.setItem(DIRECTOR_FOCUS_KEY, focused ? "1" : "0");
  } catch {
    /* quota / private mode */
  }
}

export function applyDirectorFocusToggle(opts: {
  currentlyFocused: boolean;
  inspectorSectionCollapsed: boolean;
  currentSplitRatio: number;
  storedNormalSplit: number;
  storedSectionCollapsed: boolean;
  currentHSplit?: number;
  storedDockedHSplit?: number;
  storedFocusHSplit?: number;
  availablePx?: number;
}): {
  focused: boolean;
  inspectorSectionCollapsed: boolean;
  splitRatio: number;
  normalSplit: number;
  restoreSectionCollapsed: boolean;
  hSplitRatio: number;
  dockedHSplit: number;
  focusHSplit: number;
} {
  const available =
    opts.availablePx != null && Number.isFinite(opts.availablePx) && opts.availablePx > 0
      ? opts.availablePx
      : PREVIEW_H_MIN_PX + INSPECTOR_MIN_PX + 800;
  const dockedHSplit = clampHSplitRatio(
    opts.storedDockedHSplit ?? opts.currentHSplit ?? DEFAULT_H_SPLIT_RATIO,
    available,
  );
  const storedFocus = clampFocusHSplitRatio(
    opts.storedFocusHSplit ?? DEFAULT_DIRECTOR_FOCUS_H_SPLIT,
    available,
  );
  if (!opts.currentlyFocused) {
    const normalSplit = Number.isFinite(opts.currentSplitRatio)
      ? opts.currentSplitRatio
      : DEFAULT_DIRECTOR_SPLIT_RATIO;
    return {
      focused: true,
      inspectorSectionCollapsed: true,
      splitRatio: normalSplit,
      normalSplit,
      restoreSectionCollapsed: opts.inspectorSectionCollapsed,
      hSplitRatio: storedFocus,
      dockedHSplit: clampHSplitRatio(opts.currentHSplit ?? dockedHSplit, available),
      focusHSplit: storedFocus,
    };
  }
  const restoredSplit = Number.isFinite(opts.storedNormalSplit)
    ? opts.storedNormalSplit
    : DEFAULT_DIRECTOR_SPLIT_RATIO;
  const liveFocus = clampFocusHSplitRatio(opts.currentHSplit ?? storedFocus, available);
  return {
    focused: false,
    inspectorSectionCollapsed: opts.storedSectionCollapsed,
    splitRatio: restoredSplit,
    normalSplit: restoredSplit,
    restoreSectionCollapsed: opts.storedSectionCollapsed,
    hSplitRatio: clampHSplitRatio(opts.storedDockedHSplit ?? dockedHSplit, available),
    dockedHSplit: clampHSplitRatio(opts.storedDockedHSplit ?? dockedHSplit, available),
    focusHSplit: liveFocus,
  };
}

export function clampComposerHeightPx(px: number): number {
  if (!Number.isFinite(px)) return DEFAULT_COMPOSER_HEIGHT_PX;
  return Math.round(Math.min(COMPOSER_MAX_PX, Math.max(COMPOSER_MIN_PX, px)));
}

export function loadDirectorComposerHeight(storage?: StorageLike | null): number {
  try {
    const raw = storage?.getItem(DIRECTOR_COMPOSER_HEIGHT_KEY);
    if (raw == null) return DEFAULT_COMPOSER_HEIGHT_PX;
    return clampComposerHeightPx(Number(raw));
  } catch {
    return DEFAULT_COMPOSER_HEIGHT_PX;
  }
}

export function saveDirectorComposerHeight(storage: StorageLike | null | undefined, px: number): void {
  try {
    storage?.setItem(DIRECTOR_COMPOSER_HEIGHT_KEY, String(clampComposerHeightPx(px)));
  } catch {
    /* quota / private mode */
  }
}

export function directorPresentationOf(opts: {
  inspectorCollapsed: boolean;
  directorEnabled: boolean;
  directorFocus: boolean;
}): DirectorPresentation {
  if (!opts.directorEnabled || opts.inspectorCollapsed) return "collapsed";
  if (opts.directorFocus) return "focus";
  return "docked";
}

export function loadDirectorPresentation(storage?: StorageLike | null): DirectorPresentation {
  try {
    const raw = storage?.getItem(DIRECTOR_PRESENTATION_KEY);
    if (raw === "collapsed" || raw === "docked" || raw === "focus") return raw;
    return "collapsed";
  } catch {
    return "collapsed";
  }
}

export function saveDirectorPresentation(
  storage: StorageLike | null | undefined,
  presentation: DirectorPresentation,
): void {
  try {
    storage?.setItem(DIRECTOR_PRESENTATION_KEY, presentation);
  } catch {
    /* quota / private mode */
  }
}

/** Preview fraction so the Director column stays ~35–45% of the workspace. */
export function clampFocusHSplitRatio(ratio: number, availablePx: number): number {
  const fallback = DEFAULT_DIRECTOR_FOCUS_H_SPLIT;
  if (!Number.isFinite(ratio)) return fallback;
  if (!Number.isFinite(availablePx) || availablePx <= 0) {
    return Math.min(1 - DIRECTOR_FOCUS_RATIO_MIN, Math.max(1 - DIRECTOR_FOCUS_RATIO_MAX, ratio));
  }
  const minPreview = Math.max(PREVIEW_H_MIN_PX / availablePx, 1 - DIRECTOR_FOCUS_RATIO_MAX);
  const maxPreview = Math.min(1 - INSPECTOR_MIN_PX / availablePx, 1 - DIRECTOR_FOCUS_RATIO_MIN);
  if (minPreview >= maxPreview) {
    return clampHSplitRatio(ratio, availablePx);
  }
  return Math.min(maxPreview, Math.max(minPreview, ratio));
}

export function applyFocusHSplitPointer(opts: {
  clientX: number;
  workspaceLeft: number;
  workspaceWidth: number;
  splitterPx?: number;
}): { ratio: number; previewPx: number; inspectorPx: number } {
  const splitter = opts.splitterPx ?? H_SPLITTER_PX;
  const available = Math.max(1, opts.workspaceWidth - splitter);
  const ratio = clampFocusHSplitRatio((opts.clientX - opts.workspaceLeft) / available, available);
  const previewPx = Math.round(ratio * available);
  return { ratio, previewPx, inspectorPx: available - previewPx };
}

export function loadDirectorFocusHSplitRatio(storage?: StorageLike | null): number {
  try {
    const raw = storage?.getItem(DIRECTOR_FOCUS_H_SPLIT_KEY);
    if (raw == null) return DEFAULT_DIRECTOR_FOCUS_H_SPLIT;
    const n = Number(raw);
    if (!Number.isFinite(n)) return DEFAULT_DIRECTOR_FOCUS_H_SPLIT;
    return clampFocusHSplitRatio(n, PREVIEW_H_MIN_PX + INSPECTOR_MIN_PX + 800);
  } catch {
    return DEFAULT_DIRECTOR_FOCUS_H_SPLIT;
  }
}

export function saveDirectorFocusHSplitRatio(storage: StorageLike | null | undefined, ratio: number): void {
  try {
    if (!Number.isFinite(ratio)) return;
    storage?.setItem(DIRECTOR_FOCUS_H_SPLIT_KEY, String(ratio));
  } catch {
    /* quota / private mode */
  }
}

export function clampDirectorWorkSplitRatio(ratio: number, availablePx: number): number {
  if (!Number.isFinite(ratio)) return DEFAULT_DIRECTOR_WORK_SPLIT;
  if (!Number.isFinite(availablePx) || availablePx <= 0) {
    return Math.min(0.85, Math.max(0.4, ratio));
  }
  const minR = DIRECTOR_CONVERSATION_MIN_PX / availablePx;
  const maxR = 1 - DIRECTOR_RESULT_MIN_PX / availablePx;
  if (minR >= maxR) {
    return DIRECTOR_CONVERSATION_MIN_PX / (DIRECTOR_CONVERSATION_MIN_PX + DIRECTOR_RESULT_MIN_PX);
  }
  return Math.min(maxR, Math.max(minR, ratio));
}

export function applyDirectorWorkSplitPointer(opts: {
  clientY: number;
  workTop: number;
  workHeight: number;
  splitterPx?: number;
}): { ratio: number; conversationPx: number; resultPx: number } {
  const splitter = opts.splitterPx ?? DIRECTOR_WORK_SPLITTER_PX;
  const available = Math.max(1, opts.workHeight - splitter);
  const ratio = clampDirectorWorkSplitRatio((opts.clientY - opts.workTop) / available, available);
  const conversationPx = Math.round(ratio * available);
  return { ratio, conversationPx, resultPx: available - conversationPx };
}

export function loadDirectorWorkSplitRatio(storage?: StorageLike | null): number {
  try {
    const raw = storage?.getItem(DIRECTOR_WORK_SPLIT_KEY);
    if (raw == null) return DEFAULT_DIRECTOR_WORK_SPLIT;
    const n = Number(raw);
    if (!Number.isFinite(n)) return DEFAULT_DIRECTOR_WORK_SPLIT;
    return clampDirectorWorkSplitRatio(n, DIRECTOR_CONVERSATION_MIN_PX + DIRECTOR_RESULT_MIN_PX + 240);
  } catch {
    return DEFAULT_DIRECTOR_WORK_SPLIT;
  }
}

export function saveDirectorWorkSplitRatio(storage: StorageLike | null | undefined, ratio: number): void {
  try {
    if (!Number.isFinite(ratio)) return;
    storage?.setItem(DIRECTOR_WORK_SPLIT_KEY, String(ratio));
  } catch {
    /* quota / private mode */
  }
}

export function loadDirectorDiagnosticsCollapsed(storage?: StorageLike | null): boolean {
  try {
    const raw = storage?.getItem(DIRECTOR_DIAGNOSTICS_COLLAPSED_KEY);
    if (raw == null) return true;
    return raw === "1";
  } catch {
    return true;
  }
}

export function saveDirectorDiagnosticsCollapsed(
  storage: StorageLike | null | undefined,
  collapsed: boolean,
): void {
  try {
    storage?.setItem(DIRECTOR_DIAGNOSTICS_COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    /* quota / private mode */
  }
}

export function browserLayoutStorage(): StorageLike | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}
