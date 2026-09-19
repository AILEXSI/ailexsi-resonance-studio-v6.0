/**
 * Preview stage remasure. Canvas backing store + video viewport must follow
 * the current PREVIEW content box (window resize, maximize, splitter, Focus),
 * not a stale first-layout or video-intrinsic size. Frame Engine / exporter
 * are not involved.
 */

import { isTauriRuntime } from "../../core/tauri-runtime";

export type PreviewBox = {
  cssW: number;
  cssH: number;
  dpr: number;
  backingW: number;
  backingH: number;
};

export type ContainFitRect = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export function measurePreviewBox(
  el: { clientWidth: number; clientHeight: number } | null | undefined,
  dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1,
): PreviewBox | null {
  if (!el) return null;
  const cssW = el.clientWidth;
  const cssH = el.clientHeight;
  if (cssW < 1 || cssH < 1) return null;
  const safeDpr = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  return {
    cssW,
    cssH,
    dpr: safeDpr,
    backingW: Math.max(1, Math.floor(cssW * safeDpr)),
    backingH: Math.max(1, Math.floor(cssH * safeDpr)),
  };
}

/**
 * Destination rect for object-fit:contain inside a stage box.
 * The video/canvas CSS box is the stage itself; this rect is the picture
 * painted inside that box (letterbox or pillarbox).
 */
export function containFitRect(
  stageW: number,
  stageH: number,
  contentW: number,
  contentH: number,
): ContainFitRect {
  if (stageW < 1 || stageH < 1) return { x: 0, y: 0, w: 0, h: 0 };
  if (contentW < 1 || contentH < 1) return { x: 0, y: 0, w: stageW, h: stageH };
  const scale = Math.min(stageW / contentW, stageH / contentH);
  const w = contentW * scale;
  const h = contentH * scale;
  return {
    x: (stageW - w) / 2,
    y: (stageH - h) / 2,
    w,
    h,
  };
}

/** Size CSS box + device-pixel backing store. Returns true when backing store changed. */
export function applyPreviewCanvasBackingStore(
  canvas: HTMLCanvasElement,
  box: PreviewBox,
): boolean {
  canvas.style.width = `${box.cssW}px`;
  canvas.style.height = `${box.cssH}px`;
  canvas.style.maxWidth = "none";
  canvas.style.maxHeight = "none";
  canvas.style.minWidth = `${box.cssW}px`;
  canvas.style.minHeight = `${box.cssH}px`;
  canvas.style.aspectRatio = "auto";
  canvas.style.boxSizing = "border-box";
  const changed = canvas.width !== box.backingW || canvas.height !== box.backingH;
  if (changed) {
    canvas.width = box.backingW;
    canvas.height = box.backingH;
  }
  return changed;
}

/**
 * Video element CSS box matches the measured stage (not video intrinsic
 * 16:9). Frames stay object-fit:contain inside that box. max-width/height
 * 100% + intrinsic ratio is what collapsed splitter-shrink into a postage stamp.
 */
export function applyPreviewVideoViewport(video: HTMLVideoElement, box: PreviewBox): void {
  video.removeAttribute("width");
  video.removeAttribute("height");
  video.style.position = "absolute";
  video.style.left = "0px";
  video.style.top = "0px";
  video.style.right = "auto";
  video.style.bottom = "auto";
  video.style.width = `${box.cssW}px`;
  video.style.height = `${box.cssH}px`;
  video.style.maxWidth = "none";
  video.style.maxHeight = "none";
  video.style.minWidth = `${box.cssW}px`;
  video.style.minHeight = `${box.cssH}px`;
  video.style.aspectRatio = "auto";
  video.style.objectFit = "contain";
  video.style.objectPosition = "center center";
  video.style.boxSizing = "border-box";
}

export function remasurePreviewSurfaces(input: {
  stage: { clientWidth: number; clientHeight: number } | null | undefined;
  still?: HTMLCanvasElement | null;
  video?: HTMLVideoElement | null;
  visualizer?: HTMLCanvasElement | null;
  dpr?: number;
}): PreviewBox | null {
  const box = measurePreviewBox(input.stage, input.dpr);
  if (!box) return null;
  if (input.still) applyPreviewCanvasBackingStore(input.still, box);
  if (input.visualizer) applyPreviewCanvasBackingStore(input.visualizer, box);
  if (input.video) applyPreviewVideoViewport(input.video, box);
  return box;
}

export type PreviewTauriWindowBind = (onResize: () => void) => () => void;

let tauriWindowBindForTests: PreviewTauriWindowBind | null = null;

/** Test hook. Production binds @tauri-apps/api/window when the Tauri runtime is present. */
export function setPreviewTauriWindowBindForTests(bind: PreviewTauriWindowBind | null): void {
  tauriWindowBindForTests = bind;
}

function attachTauriWindowRemeasure(schedule: () => void): () => void {
  if (tauriWindowBindForTests) return tauriWindowBindForTests(schedule);
  if (!isTauriRuntime()) return () => {};
  let unlisten = () => {};
  let cancelled = false;
  void import("@tauri-apps/api/window")
    .then(async (mod) => {
      if (cancelled) return;
      const win = mod.getCurrentWindow();
      const stopResized = await win.onResized(() => schedule());
      const stopScale = await win.onScaleChanged(() => schedule());
      if (cancelled) {
        stopResized();
        stopScale();
        return;
      }
      unlisten = () => {
        stopResized();
        stopScale();
      };
    })
    .catch(() => {
      /* web / tests / API unavailable */
    });
  return () => {
    cancelled = true;
    unlisten();
  };
}

/**
 * ResizeObserver on the Preview stage + parents (splitter / Focus / grid)
 * plus window, visualViewport, and Tauri window resized (maximize often
 * skips a plain window.resize, or fires it before flex layout settles).
 * Double-rAF remasures after layout, then once more after settle.
 */
export function subscribePreviewRemeasure(target: Element, onRemeasure: () => void): () => void {
  let stopped = false;
  let outerRaf = 0;
  let innerRaf = 0;

  const measure = () => {
    if (stopped) return;
    onRemeasure();
  };

  const schedule = () => {
    if (stopped) return;
    if (outerRaf) return;
    outerRaf = requestAnimationFrame(() => {
      outerRaf = 0;
      if (stopped) return;
      measure();
      if (innerRaf) cancelAnimationFrame(innerRaf);
      innerRaf = requestAnimationFrame(() => {
        innerRaf = 0;
        measure();
      });
    });
  };

  measure();
  schedule();

  let ro: ResizeObserver | undefined;
  if (typeof ResizeObserver !== "undefined") {
    ro = new ResizeObserver(schedule);
    ro.observe(target);
    let walk: Element | null = target.parentElement;
    for (let i = 0; i < 2 && walk; i += 1) {
      ro.observe(walk);
      walk = walk.parentElement;
    }
  }

  window.addEventListener("resize", schedule);
  const viewport = window.visualViewport;
  viewport?.addEventListener("resize", schedule);
  viewport?.addEventListener("scroll", schedule);
  const stopTauri = attachTauriWindowRemeasure(schedule);

  return () => {
    stopped = true;
    if (outerRaf) cancelAnimationFrame(outerRaf);
    if (innerRaf) cancelAnimationFrame(innerRaf);
    ro?.disconnect();
    window.removeEventListener("resize", schedule);
    viewport?.removeEventListener("resize", schedule);
    viewport?.removeEventListener("scroll", schedule);
    stopTauri();
  };
}
