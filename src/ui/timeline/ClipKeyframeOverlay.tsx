import type { PointerEvent as ReactPointerEvent } from "react";
import type { VolumeAutomation } from "../../core/models";
import { automationValueAt } from "../../core/volume-automation";
import { moveLanePoint } from "../../core/clip-keys";

function yOf(value: number, height: number): number {
  const h = Math.max(1, height);
  return (1 - Math.max(0, Math.min(1, value))) * h;
}

function valueOf(y: number, height: number): number {
  const h = Math.max(1, height);
  return Math.max(0, Math.min(1, 1 - y / h));
}

/** Linear key line drawn inside a clip or VIS event. */
export function ClipKeyframeOverlay({
  durationMs,
  lane,
  testId,
  onChange,
  onCommit,
  onRemove,
}: {
  durationMs: number;
  lane?: VolumeAutomation;
  testId: string;
  onChange: (lane: VolumeAutomation) => void;
  onCommit: () => void;
  onRemove: (timeMs: number) => void;
}) {
  if (!lane || !lane.enabled || lane.points.length === 0) return null;
  const points = [...lane.points].sort((a, b) => a.timeMs - b.timeMs);
  const xOf = (timeMs: number) => (durationMs <= 0 ? 0 : (timeMs / durationMs) * 100);
  const samples = [0, ...points.map((point) => point.timeMs), durationMs];
  const d = samples
    .map((timeMs, index) => {
      const x = xOf(timeMs);
      const y = yOf(automationValueAt({ ...lane, enabled: true }, timeMs), 100);
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
  const onPointDown = (event: ReactPointerEvent, timeMs: number) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.altKey) {
      onRemove(timeMs);
      return;
    }
    const svg = (event.currentTarget as SVGCircleElement).ownerSVGElement;
    const box = svg?.getBoundingClientRect();
    if (!svg || !box) return;
    const from = timeMs;
    const move = (ev: PointerEvent) => {
      const x = Math.max(0, Math.min(box.width, ev.clientX - box.left));
      const y = Math.max(0, Math.min(box.height, ev.clientY - box.top));
      const nextTime = durationMs <= 0 ? 0 : Math.round((x / box.width) * durationMs);
      const next = moveLanePoint(lane, from, nextTime, valueOf(y, box.height));
      if (next) onChange(next);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      onCommit();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return (
    <svg className="clip-keys" data-testid={testId} viewBox="0 0 100 100" preserveAspectRatio="none">
      <path d={d} />
      {points.map((point) => (
        <circle
          key={point.timeMs}
          data-testid={`${testId}-${point.timeMs}`}
          cx={xOf(point.timeMs)}
          cy={yOf(point.value, 100)}
          r={1.6}
          onPointerDown={(event) => onPointDown(event, point.timeMs)}
        />
      ))}
    </svg>
  );
}
