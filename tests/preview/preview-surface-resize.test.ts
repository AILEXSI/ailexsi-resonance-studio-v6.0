import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyPreviewCanvasBackingStore,
  applyPreviewVideoViewport,
  measurePreviewBox,
  remasurePreviewSurfaces,
  subscribePreviewRemeasure,
} from "../../src/ui/preview/preview-surface";

function boxEl(width: number, height: number): { clientWidth: number; clientHeight: number } {
  return { clientWidth: width, clientHeight: height };
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
});

describe("subscribePreviewRemeasure", () => {
  const observers: Array<{ cb: ResizeObserverCallback; fire: () => void }> = [];
  const OriginalRO = globalThis.ResizeObserver;

  afterEach(() => {
    observers.length = 0;
    vi.unstubAllGlobals();
    if (OriginalRO) globalThis.ResizeObserver = OriginalRO;
    else delete (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
  });

  it("fires on observe, ResizeObserver, and window resize (rAF-coalesced)", async () => {
    class MockRO {
      cb: ResizeObserverCallback;
      constructor(cb: ResizeObserverCallback) {
        this.cb = cb;
        observers.push({
          cb,
          fire: () => cb([] as unknown as ResizeObserverEntry[], this as unknown as ResizeObserver),
        });
      }
      observe() {}
      disconnect() {}
      unobserve() {}
    }
    vi.stubGlobal("ResizeObserver", MockRO);

    const onRemeasure = vi.fn();
    const target = document.createElement("div");
    const stop = subscribePreviewRemeasure(target, onRemeasure);
    expect(onRemeasure).toHaveBeenCalledTimes(1);
    expect(observers).toHaveLength(1);

    observers[0]!.fire();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(onRemeasure).toHaveBeenCalledTimes(2);

    window.dispatchEvent(new Event("resize"));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(onRemeasure).toHaveBeenCalledTimes(3);

    stop();
    observers[0]!.fire();
    window.dispatchEvent(new Event("resize"));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(onRemeasure).toHaveBeenCalledTimes(3);
  });
});
