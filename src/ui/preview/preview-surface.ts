/**
 * Preview stage remasure. Canvas backing store + video viewport must follow
 * the current PREVIEW content box (window resize, splitter, Focus), not a
 * stale first-layout size. Frame Engine / exporter are not involved.
 */

export type PreviewBox = {
  cssW: number;
  cssH: number;
  dpr: number;
  backingW: number;
  backingH: number;
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

/** Size CSS box + device-pixel backing store. Returns true when backing store changed. */
export function applyPreviewCanvasBackingStore(
  canvas: HTMLCanvasElement,
  box: PreviewBox,
): boolean {
  canvas.style.width = `${box.cssW}px`;
  canvas.style.height = `${box.cssH}px`;
  const changed = canvas.width !== box.backingW || canvas.height !== box.backingH;
  if (changed) {
    canvas.width = box.backingW;
    canvas.height = box.backingH;
  }
  return changed;
}

/** Video element fills the measured stage; frames stay contain-fit inside that box. */
export function applyPreviewVideoViewport(video: HTMLVideoElement, box: PreviewBox): void {
  video.style.width = `${box.cssW}px`;
  video.style.height = `${box.cssH}px`;
  video.style.maxWidth = "100%";
  video.style.maxHeight = "100%";
  video.style.objectFit = "contain";
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

/**
 * ResizeObserver on the Preview stage (splitter / Focus / grid reflow) plus
 * window + visualViewport resize (Electron window edges often skip the RO).
 * rAF-coalesces bursts.
 */
export function subscribePreviewRemeasure(target: Element, onRemeasure: () => void): () => void {
  let raf = 0;
  const schedule = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      onRemeasure();
    });
  };
  onRemeasure();
  let ro: ResizeObserver | undefined;
  if (typeof ResizeObserver !== "undefined") {
    ro = new ResizeObserver(schedule);
    ro.observe(target);
  }
  window.addEventListener("resize", schedule);
  const viewport = window.visualViewport;
  viewport?.addEventListener("resize", schedule);
  return () => {
    if (raf) cancelAnimationFrame(raf);
    ro?.disconnect();
    window.removeEventListener("resize", schedule);
    viewport?.removeEventListener("resize", schedule);
  };
}
