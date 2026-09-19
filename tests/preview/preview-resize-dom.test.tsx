import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Preview } from "../../src/ui/preview/Preview";
import { asset, clip, projectWith } from "../helpers";

const observers: Array<{ fire: () => void }> = [];

class MockRO {
  cb: ResizeObserverCallback;
  constructor(cb: ResizeObserverCallback) {
    this.cb = cb;
    observers.push({
      fire: () => cb([] as unknown as ResizeObserverEntry[], this as unknown as ResizeObserver),
    });
  }
  observe() {}
  disconnect() {}
  unobserve() {}
}

function sizeEl(el: Element, width: number, height: number) {
  Object.defineProperty(el, "clientWidth", { configurable: true, value: width });
  Object.defineProperty(el, "clientHeight", { configurable: true, value: height });
}

async function flushRaf() {
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
}

describe("preview DOM remasure", () => {
  let host: HTMLDivElement | undefined;
  let root: Root | undefined;
  const OriginalRO = globalThis.ResizeObserver;

  beforeEach(() => {
    observers.length = 0;
    vi.stubGlobal("ResizeObserver", MockRO);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    host?.remove();
    host = undefined;
    root = undefined;
    observers.length = 0;
    vi.unstubAllGlobals();
    if (OriginalRO) globalThis.ResizeObserver = OriginalRO;
    else delete (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
  });

  async function mountVideo() {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const project = projectWith(
      [clip({ id: "c1", assetId: "a1", trackId: "V1", durationMs: 8000 })],
      [asset({ id: "a1", kind: "video", durationMs: 8000, objectUrl: "blob:preview-resize" })],
    );
    await act(async () => {
      root!.render(<Preview project={project} playing={false} />);
    });
  }

  it("window resize remasures video viewport to the current preview-stage box", async () => {
    await mountVideo();
    const stage = host!.querySelector('[data-testid="preview-stage"]') as HTMLElement;
    const video = host!.querySelector('[data-testid="preview-video"]') as HTMLVideoElement;
    expect(stage).toBeTruthy();
    expect(video).toBeTruthy();
    expect(observers.length).toBeGreaterThan(0);

    sizeEl(stage, 320, 180);
    observers[0]!.fire();
    await flushRaf();
    expect(video.style.width).toBe("320px");
    expect(video.style.height).toBe("180px");
    expect(video.style.objectFit).toBe("contain");

    sizeEl(stage, 1600, 900);
    window.dispatchEvent(new Event("resize"));
    await flushRaf();
    expect(video.style.width).toBe("1600px");
    expect(video.style.height).toBe("900px");
  });

  it("splitter-style ResizeObserver remasures video; no postage-stamp after grow", async () => {
    await mountVideo();
    const stage = host!.querySelector('[data-testid="preview-stage"]') as HTMLElement;
    const video = host!.querySelector('[data-testid="preview-video"]') as HTMLVideoElement;

    sizeEl(stage, 480, 200);
    observers[0]!.fire();
    await flushRaf();
    expect(video.style.width).toBe("480px");

    sizeEl(stage, 1400, 720);
    observers[0]!.fire();
    await flushRaf();
    expect(video.style.width).toBe("1400px");
    expect(video.style.height).toBe("720px");
  });
});
