import { act, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import {
  LOWER_STAGE_MIN_PX,
  PREVIEW_MIN_PX,
  SPLITTER_PX,
  applySplitPointer,
  loadSplitRatio,
  saveSplitRatio,
  type StorageLike,
} from "../../src/core/layout-prefs";
import "../../src/styles.css";

function SplitHarness({ storage }: { storage: StorageLike }) {
  const [ratio, setRatio] = useState(() => loadSplitRatio(storage));
  const stageRef = useRef<HTMLDivElement>(null);
  const drag = (clientY: number) => {
    const next = applySplitPointer({
      clientY,
      stageTop: 0,
      stageHeight: PREVIEW_MIN_PX + LOWER_STAGE_MIN_PX + 400 + SPLITTER_PX,
    });
    setRatio(next.ratio);
    saveSplitRatio(storage, next.ratio);
  };
  return (
    <div className="stage" ref={stageRef} data-testid="stage" style={{ height: PREVIEW_MIN_PX + LOWER_STAGE_MIN_PX + 400 + SPLITTER_PX, width: 800 }}>
      <div
        className="workspace"
        data-testid="preview-pane"
        data-preview-ratio={ratio}
        style={{ flex: `${ratio} 1 ${PREVIEW_MIN_PX}px` }}
      />
      <div
        className="layout-split"
        data-testid="layout-split"
        style={{ cursor: "ns-resize" }}
        onMouseDown={(e) => drag(e.clientY)}
        onMouseMove={(e) => {
          if (e.buttons === 1) drag(e.clientY);
        }}
      >
        <span className="layout-split-grip" data-testid="layout-split-grip" aria-hidden="true" />
      </div>
      <div
        className="lower-stage"
        data-testid="arrange-pane"
        style={{ flex: `${1 - ratio} 1 ${LOWER_STAGE_MIN_PX}px` }}
      />
    </div>
  );
}

describe("preview / arrange splitter", () => {
  let host: HTMLDivElement | undefined;
  let root: Root | undefined;

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    host?.remove();
    host = undefined;
    root = undefined;
  });

  it("drag changes flex ratio and clamps to min heights; persist round-trips", () => {
    const map = new Map<string, string>();
    const storage: StorageLike = {
      getItem: (k) => (map.has(k) ? map.get(k)! : null),
      setItem: (k, v) => {
        map.set(k, v);
      },
    };
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root!.render(<SplitHarness storage={storage} />);
    });

    const split = host.querySelector('[data-testid="layout-split"]') as HTMLElement;
    expect(getComputedStyle(split).cursor).toBe("ns-resize");
    expect(host.querySelector('[data-testid="layout-split-grip"]')).toBeTruthy();
    expect(getComputedStyle(split).flexBasis === "18px" || split.className.includes("layout-split")).toBe(true);
    const preview = () => host!.querySelector('[data-testid="preview-pane"]') as HTMLElement;
    const arrange = () => host!.querySelector('[data-testid="arrange-pane"]') as HTMLElement;

    expect(preview().style.flex).toContain(`${PREVIEW_MIN_PX}px`);
    expect(arrange().style.flex).toContain(`${LOWER_STAGE_MIN_PX}px`);

    act(() => {
      split.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientY: 420, buttons: 1 }));
    });
    const mid = Number(preview().getAttribute("data-preview-ratio"));
    expect(mid).toBeGreaterThan(0.4);
    expect(mid).toBeLessThan(0.8);
    expect(preview().style.flex.startsWith(`${mid}`)).toBe(true);
    expect(loadSplitRatio(storage)).toBeCloseTo(mid, 5);

    act(() => {
      split.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientY: 10, buttons: 1 }));
    });
    const available = PREVIEW_MIN_PX + LOWER_STAGE_MIN_PX + 400;
    const low = Number(preview().getAttribute("data-preview-ratio"));
    expect(low * available).toBeCloseTo(PREVIEW_MIN_PX, 0);

    act(() => {
      split.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          clientY: PREVIEW_MIN_PX + LOWER_STAGE_MIN_PX + 400 + SPLITTER_PX - 10,
          buttons: 1,
        }),
      );
    });
    const high = Number(preview().getAttribute("data-preview-ratio"));
    expect((1 - high) * available).toBeCloseTo(LOWER_STAGE_MIN_PX, 0);
    expect(loadSplitRatio(storage)).toBeCloseTo(high, 5);
  });
});
