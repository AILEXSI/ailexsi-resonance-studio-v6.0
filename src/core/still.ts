import { drawContain } from "./exporter/draw-contain";
import { isPlayableSource } from "./exporter/media";

/** Default still-image clip length. User can trim/stretch like video. */
export const DEFAULT_IMAGE_DURATION_MS = 5000;

const stillCache = new Map<string, HTMLImageElement>();

export function loadStill(url: string): Promise<HTMLImageElement> {
  if (!isPlayableSource(url)) throw new Error("Blocked non-local media source");
  const hit = stillCache.get(url);
  if (hit && hit.complete && hit.naturalWidth > 0) return Promise.resolve(hit);
  return new Promise((resolve, reject) => {
    const img = hit ?? new Image();
    img.crossOrigin = "anonymous";
    const onOk = () => {
      cleanup();
      if (img.naturalWidth < 1) {
        reject(new Error("Failed to load still"));
        return;
      }
      stillCache.set(url, img);
      resolve(img);
    };
    const onErr = () => {
      cleanup();
      reject(new Error("Failed to load still"));
    };
    const cleanup = () => {
      img.removeEventListener("load", onOk);
      img.removeEventListener("error", onErr);
    };
    img.addEventListener("load", onOk);
    img.addEventListener("error", onErr);
    if (img.src !== url) img.src = url;
    else if (img.complete && img.naturalWidth > 0) onOk();
  });
}

export function stillSize(image: CanvasImageSource): { width: number; height: number } {
  if (image instanceof HTMLImageElement) {
    return { width: image.naturalWidth || image.width, height: image.naturalHeight || image.height };
  }
  if (image instanceof HTMLVideoElement) {
    return { width: image.videoWidth, height: image.videoHeight };
  }
  if (image instanceof HTMLCanvasElement) {
    return { width: image.width, height: image.height };
  }
  const anyImg = image as { naturalWidth?: number; naturalHeight?: number; width?: number; height?: number };
  return {
    width: anyImg.naturalWidth ?? anyImg.width ?? 0,
    height: anyImg.naturalHeight ?? anyImg.height ?? 0,
  };
}

/** Preview + export: draw a still contained in the canvas. */
export function paintStill(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  image: CanvasImageSource,
  alpha = 1,
): boolean {
  const { width, height } = stillSize(image);
  if (width < 2 || height < 2) return false;
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = prev * Math.max(0, Math.min(1, alpha));
  try {
    drawContain(ctx, canvas, width, height, (dx, dy, dw, dh) => {
      ctx.drawImage(image, dx, dy, dw, dh);
    });
  } finally {
    ctx.globalAlpha = prev;
  }
  return true;
}

export async function paintStillUrl(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  url: string,
  alpha = 1,
): Promise<boolean> {
  try {
    const img = await loadStill(url);
    return paintStill(ctx, canvas, img, alpha);
  } catch {
    return false;
  }
}

export function clearStillCache(): void {
  stillCache.clear();
}
