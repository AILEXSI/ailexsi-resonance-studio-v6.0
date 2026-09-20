import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyPreviewCanvasBackingStore,
  applyPreviewVideoViewport,
  containFitRect,
  measurePreviewBox,
  remasurePreviewSurfaces,
  setPreviewTauriWindowBindForTests,
  subscribePreviewRemeasure,
} from "../../src/ui/preview/preview-surface";

function boxEl(width: number, height: number): { clientWidth: number; clientHeight: number } {
  return { clientWidth: width, clientHeight: height };
}

async function flushLayout() {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

describe("preview surface remasure", () => {
  it("measures CSS box + DPR backing store and skips an unlaid-out stage", () => {
    expect(measurePreviewBox(null)).toBeNull();
    expect(measurePreviewBox(boxEl(0, 400))).toBeNull();
    expect(measurePreviewBox(boxEl(800, 0))).toBeNull();
    expect(measurePreviewBox(boxEl(800, 450), 2)).toEqual({
      cssW: 800,
      cssH: 450,
      dpr: 2,
      backingW: 1600,
      backingH: 900,
    });
    expect(measurePreviewBox(boxEl(1366, 400), 1)?.backingW).toBe(1366);
    expect(measurePreviewBox(boxEl(1920, 600), 1)?.backingW).toBe(1920);
    expect(measurePreviewBox(boxEl(2560, 500), 1)?.backingW).toBe(2560);
  });

  it("window-style grow remasures canvas out of postage-stamp backing store", () => {
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 180;
    const small = measurePreviewBox(boxEl(320, 180), 1)!;
    applyPreviewCanvasBackingStore(canvas, small);
    expect(canvas.width).toBe(320);
    expect(canvas.height).toBe(180);
    expect(canvas.style.width).toBe("320px");
    expect(canvas.style.height).toBe("180px");

    const grown = remasurePreviewSurfaces({
      stage: boxEl(1280, 720),
      still: canvas,
      dpr: 1,
    });
    expect(grown).toEqual({
      cssW: 1280,
      cssH: 720,
      dpr: 1,
      backingW: 1280,
      backingH: 720,
    });
    expect(canvas.width).toBe(1280);
    expect(canvas.height).toBe(720);
    expect(canvas.style.width).toBe("1280px");
    expect(canvas.style.height).toBe("720px");
  });

  it("maximize-sized stage jump remasures video and canvas off the pre-maximize box", () => {
    const video = document.createElement("video");
    const canvas = document.createElement("canvas");
    remasurePreviewSurfaces({ stage: boxEl(960, 420), video, still: canvas, dpr: 1 });
    expect(video.style.width).toBe("960px");
    expect(video.style.height).toBe("420px");
    expect(canvas.width).toBe(960);

    const maximized = remasurePreviewSurfaces({
      stage: boxEl(1920, 980),
      video,
      still: canvas,
      dpr: 1,
    });
    expect(maximized).toEqual({
      cssW: 1920,
      cssH: 980,
      dpr: 1,
      backingW: 1920,
      backingH: 980,
    });
    expect(video.style.width).toBe("1920px");
    expect(video.style.height).toBe("980px");
    expect(video.style.minWidth).toBe("1920px");
    expect(video.style.maxWidth).toBe("none");
    expect(canvas.width).toBe(1920);
    expect(canvas.height).toBe(980);
    expect(canvas.style.width).toBe("1920px");
  });

  it("short-wide stage contain geometry fills stage width — not a postage stamp", () => {
    const video = document.createElement("video");
    video.setAttribute("width", "1920");
    video.setAttribute("height", "1080");
    remasurePreviewSurfaces({ stage: boxEl(1600, 900), video, dpr: 1 });
    expect(video.style.width).toBe("1600px");

    remasurePreviewSurfaces({ stage: boxEl(1600, 140), video, dpr: 1 });
    expect(video.style.width).toBe("1600px");
    expect(video.style.height).toBe("140px");
    expect(video.style.minWidth).toBe("1600px");
    expect(video.style.minHeight).toBe("140px");
    expect(video.style.maxWidth).toBe("none");
    expect(video.style.maxHeight).toBe("none");
    expect(video.style.aspectRatio).toBe("auto");
    expect(video.style.objectFit).toBe("contain");
    expect(video.getAttribute("width")).toBeNull();

    const picture = containFitRect(1600, 140, 1920, 1080);
    expect(picture.h).toBeCloseTo(140);
    expect(picture.w).toBeCloseTo((140 * 1920) / 1080);
    expect(picture.w).toBeLessThan(1600);
    expect(picture.x).toBeGreaterThan(0);
    expect(picture.y).toBeCloseTo(0);
    expect(Number.parseFloat(video.style.width)).toBe(1600);
    expect(Number.parseFloat(video.style.width)).not.toBeCloseTo(picture.w);
  });

  it("contain-fit on a taller stage letterboxes top/bottom at full width", () => {
    const dest = containFitRect(1600, 1200, 1920, 1080);
    expect(dest.w).toBeCloseTo(1600);
    expect(dest.h).toBeCloseTo((1600 * 1080) / 1920);
    expect(dest.x).toBeCloseTo(0);
    expect(dest.y).toBeGreaterThan(0);
  });

  it("splitter / Focus shrink and grow keep video viewport on the current box", () => {
    const video = document.createElement("video");
    remasurePreviewSurfaces({ stage: boxEl(640, 360), video, dpr: 1 });
    expect(video.style.width).toBe("640px");
    expect(video.style.height).toBe("360px");
    expect(video.style.objectFit).toBe("contain");

    remasurePreviewSurfaces({ stage: boxEl(1600, 900), video, dpr: 1 });
    expect(video.style.width).toBe("1600px");
    expect(video.style.height).toBe("900px");

    remasurePreviewSurfaces({ stage: boxEl(400, 220), video, dpr: 1 });
    expect(video.style.width).toBe("400px");
    expect(video.style.height).toBe("220px");
  });

  it("Focus enter/exit remasures still + visualizer + video together", () => {
    const still = document.createElement("canvas");
    const visualizer = document.createElement("canvas");
    const video = document.createElement("video");
    remasurePreviewSurfaces({
      stage: boxEl(900, 280),
      still,
      visualizer,
      video,
      dpr: 2,
    });
    expect(still.width).toBe(1800);
    expect(visualizer.width).toBe(1800);
    expect(video.style.width).toBe("900px");

    remasurePreviewSurfaces({
      stage: boxEl(900, 640),
      still,
      visualizer,
      video,
      dpr: 2,
    });
    expect(still.width).toBe(1800);
    expect(still.height).toBe(1280);
    expect(visualizer.height).toBe(1280);
    expect(video.style.height).toBe("640px");
  });

  it("applyPreviewVideoViewport does not keep intrinsic CSS size after a grow", () => {
    const video = document.createElement("video");
    applyPreviewVideoViewport(video, measurePreviewBox(boxEl(480, 200), 1)!);
    applyPreviewVideoViewport(video, measurePreviewBox(boxEl(1800, 720), 1)!);
    expect(video.style.width).toBe("1800px");
    expect(video.style.height).toBe("720px");
    expect(video.style.minWidth).toBe("1800px");
  });
});

describe("subscribePreviewRemeasure", () => {
  const observers: Array<{ fire: () => void }> = [];
  const OriginalRO = globalThis.ResizeObserver;

  afterEach(() => {
    observers.length = 0;
    setPreviewTauriWindowBindForTests(null);
    vi.unstubAllGlobals();
    if (OriginalRO) globalThis.ResizeObserver = OriginalRO;
    else delete (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
  });

  function stubRO() {
    class MockRO {
      live = true;
      constructor(cb: ResizeObserverCallback) {
        observers.push({
          fire: () => {
            if (!this.live) return;
            cb([] as unknown as ResizeObserverEntry[], this as unknown as ResizeObserver);
          },
        });
      }
      observe() {}
      disconnect() {
        this.live = false;
      }
      unobserve() {}
    }
    vi.stubGlobal("ResizeObserver", MockRO);
  }

  it("fires on observe, ResizeObserver, and window resize (double-rAF after layout)", async () => {
    stubRO();
    const onRemeasure = vi.fn();
    const target = document.createElement("div");
    const stop = subscribePreviewRemeasure(target, onRemeasure);
    expect(onRemeasure).toHaveBeenCalledTimes(1);
    expect(observers).toHaveLength(1);

    observers[0]!.fire();
    await flushLayout();
    expect(onRemeasure.mock.calls.length).toBeGreaterThan(1);

    const afterRo = onRemeasure.mock.calls.length;
    window.dispatchEvent(new Event("resize"));
    await flushLayout();
    expect(onRemeasure.mock.calls.length).toBeGreaterThan(afterRo);

    const afterWin = onRemeasure.mock.calls.length;
    stop();
    observers[0]!.fire();
    window.dispatchEvent(new Event("resize"));
    await flushLayout();
    expect(onRemeasure).toHaveBeenCalledTimes(afterWin);
  });

  it("visualViewport resize and Tauri window resized schedule a settle remasure", async () => {
    stubRO();
    const vvListeners: Array<{ type: string; fn: () => void }> = [];
    const visualViewport = {
      addEventListener: (type: string, fn: () => void) => {
        vvListeners.push({ type, fn });
      },
      removeEventListener: (type: string, fn: () => void) => {
        const i = vvListeners.findIndex((l) => l.type === type && l.fn === fn);
        if (i >= 0) vvListeners.splice(i, 1);
      },
    };
    vi.stubGlobal("visualViewport", visualViewport);

    let tauriFire: (() => void) | undefined;
    setPreviewTauriWindowBindForTests((onResize) => {
      tauriFire = onResize;
      return () => {
        tauriFire = undefined;
      };
    });

    const onRemeasure = vi.fn();
    const stop = subscribePreviewRemeasure(document.createElement("div"), onRemeasure);
    await flushLayout();
    const afterInit = onRemeasure.mock.calls.length;

    vvListeners.find((l) => l.type === "resize")?.fn();
    await flushLayout();
    expect(onRemeasure.mock.calls.length).toBeGreaterThan(afterInit);

    const afterVv = onRemeasure.mock.calls.length;
    expect(tauriFire).toBeTypeOf("function");
    tauriFire!();
    await flushLayout();
    expect(onRemeasure.mock.calls.length).toBeGreaterThan(afterVv);

    const afterTauri = onRemeasure.mock.calls.length;
    stop();
    vvListeners.find((l) => l.type === "resize")?.fn();
    tauriFire?.();
    await flushLayout();
    expect(onRemeasure).toHaveBeenCalledTimes(afterTauri);
  });
});
