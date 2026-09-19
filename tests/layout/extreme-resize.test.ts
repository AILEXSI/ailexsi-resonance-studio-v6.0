/**
 * Extreme Preview / Arrange / Director resize — constrain, do not replace splitters.
 */
import { describe, expect, it } from "vitest";
import {
  ARRANGE_MIN_PX,
  DEFAULT_DIRECTOR_FOCUS_H_SPLIT,
  LOWER_STAGE_MIN_PX,
  PREVIEW_MIN_PX,
  SPLITTER_PX,
  TRANSPORT_MIN_PX,
  applyDirectorFocusToggle,
  applySplitPointer,
  clampDirectorSplitRatio,
  clampDirectorWorkSplitRatio,
  clampSplitRatio,
  DIRECTOR_CONVERSATION_MIN_PX,
  DIRECTOR_RESULT_MIN_PX,
  DIRECTOR_SECTION_MIN_PX,
  INSPECTOR_SECTION_MIN_PX,
  isMeasuredStageHeight,
  legalSplitMins,
  loadSplitRatio,
  normalizePersistedSplitRatio,
  stageAvailableFromWindow,
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

describe("extreme resize constraints", () => {
  it("MAX Preview drag stops with lower-stage (transport + arrange) at min", () => {
    const stage = PREVIEW_MIN_PX + LOWER_STAGE_MIN_PX + 500 + SPLITTER_PX;
    const available = stage - SPLITTER_PX;
    const maxed = applySplitPointer({ clientY: stage + 400, stageTop: 0, stageHeight: stage });
    expect(maxed.arrangePx).toBe(LOWER_STAGE_MIN_PX);
    expect(maxed.previewPx).toBe(available - LOWER_STAGE_MIN_PX);
    expect(maxed.arrangePx).toBeGreaterThanOrEqual(ARRANGE_MIN_PX + TRANSPORT_MIN_PX);
    const further = applySplitPointer({ clientY: stage + 4000, stageTop: 0, stageHeight: stage });
    expect(further.ratio).toBe(maxed.ratio);
    expect(further.arrangePx).toBe(LOWER_STAGE_MIN_PX);
  });

  it("dragging back from MAX Preview restores arrange smoothly", () => {
    const stage = PREVIEW_MIN_PX + LOWER_STAGE_MIN_PX + 500 + SPLITTER_PX;
    const maxed = applySplitPointer({ clientY: stage + 400, stageTop: 0, stageHeight: stage });
    const mid = applySplitPointer({ clientY: stage * 0.5, stageTop: 0, stageHeight: stage });
    expect(mid.arrangePx).toBeGreaterThan(maxed.arrangePx);
    expect(mid.previewPx).toBeGreaterThanOrEqual(PREVIEW_MIN_PX);
    expect(mid.arrangePx).toBeGreaterThanOrEqual(LOWER_STAGE_MIN_PX);
  });

  it("window-height legal bounds exclude toolbar + status; persisted extremes normalize", () => {
    const available = stageAvailableFromWindow(1080);
    expect(available).toBeLessThan(1080);
    const stored = loadSplitRatio(memoryStorage({ "resonance-studio-v6-0-preview-split": "0.99" }));
    const live = normalizePersistedSplitRatio(0.99, available);
    expect(live).toBeLessThan(0.99);
    expect((1 - live) * available).toBeGreaterThanOrEqual(LOWER_STAGE_MIN_PX - 0.5);
    expect(stored).toBeLessThan(0.99);
    expect(clampSplitRatio(2, available)).toBe(live);
  });

  it("short windows keep both preview and lower stage recoverable (never 0)", () => {
    const mins = legalSplitMins(280);
    expect(mins.previewMin).toBeGreaterThan(0);
    expect(mins.lowerMin).toBeGreaterThan(0);
    const ratio = clampSplitRatio(0.9, 280);
    expect(ratio).toBeGreaterThan(0);
    expect(ratio).toBeLessThan(1);
    expect(ratio * 280).toBeCloseTo(mins.previewMin, 0);
  });

  it("measured short stages still normalize Preview-max; unmeasured 0 does not", () => {
    expect(isMeasuredStageHeight(0)).toBe(false);
    expect(isMeasuredStageHeight(Number.NaN)).toBe(false);
    expect(isMeasuredStageHeight(280)).toBe(true);
    const short = 280;
    const live = normalizePersistedSplitRatio(0.99, short);
    expect(live).toBeLessThan(0.99);
    expect(live * short).toBeGreaterThan(0);
    expect((1 - live) * short).toBeGreaterThan(0);
    expect(live * short + (1 - live) * short).toBeCloseTo(short, 5);
  });

  it("Director interior mins stay legal; Focus restore returns prior geometry", () => {
    const work = clampDirectorWorkSplitRatio(0.99, 400);
    expect(work * 400).toBeLessThanOrEqual(400 - DIRECTOR_RESULT_MIN_PX + 0.5);
    expect((1 - work) * 400).toBeGreaterThanOrEqual(DIRECTOR_RESULT_MIN_PX - 0.5);
    expect(work * 400).toBeGreaterThanOrEqual(DIRECTOR_CONVERSATION_MIN_PX - 0.5);

    const inspector = clampDirectorSplitRatio(0.99, 400);
    expect((1 - inspector) * 400).toBeGreaterThanOrEqual(DIRECTOR_SECTION_MIN_PX - 0.5);
    expect(inspector * 400).toBeGreaterThanOrEqual(INSPECTOR_SECTION_MIN_PX - 0.5);

    const entered = applyDirectorFocusToggle({
      currentlyFocused: false,
      inspectorSectionCollapsed: false,
      currentSplitRatio: 0.28,
      storedNormalSplit: 0.28,
      storedSectionCollapsed: false,
      currentHSplit: 0.74,
      storedDockedHSplit: 0.74,
      storedFocusHSplit: DEFAULT_DIRECTOR_FOCUS_H_SPLIT,
      availablePx: 1200,
    });
    expect(entered.focused).toBe(true);
    const left = applyDirectorFocusToggle({
      currentlyFocused: true,
      inspectorSectionCollapsed: true,
      currentSplitRatio: entered.splitRatio,
      storedNormalSplit: entered.normalSplit,
      storedSectionCollapsed: entered.restoreSectionCollapsed,
      currentHSplit: entered.hSplitRatio,
      storedDockedHSplit: entered.dockedHSplit,
      storedFocusHSplit: entered.focusHSplit,
      availablePx: 1200,
    });
    expect(left.focused).toBe(false);
    expect(left.splitRatio).toBe(0.28);
    expect(left.inspectorSectionCollapsed).toBe(false);
    expect(left.hSplitRatio).toBeCloseTo(0.74, 5);
  });
});
