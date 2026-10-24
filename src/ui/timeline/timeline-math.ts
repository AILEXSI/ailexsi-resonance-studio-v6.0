import { RULER_PAD_PX } from "../../core/zoom";

export function msToX(ms: number, zoom: number, scrollMs: number): number {
  return RULER_PAD_PX + ((ms - scrollMs) / 1000) * zoom;
}

export function xToMs(x: number, zoom: number, scrollMs: number): number {
  return scrollMs + ((x - RULER_PAD_PX) / zoom) * 1000;
}

export function msToWidth(ms: number, zoom: number): number {
  return (ms / 1000) * zoom;
}

