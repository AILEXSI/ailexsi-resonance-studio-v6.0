/** Letterbox a source rectangle into a canvas. No decoder, no frame engine. */

export function drawContain(
  _ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  srcW: number,
  srcH: number,
  draw: (dx: number, dy: number, dw: number, dh: number) => void,
): void {
  if (srcW < 2 || srcH < 2) return;
  const scale = Math.min(canvas.width / srcW, canvas.height / srcH);
  const w = srcW * scale;
  const h = srcH * scale;
  draw((canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
}
