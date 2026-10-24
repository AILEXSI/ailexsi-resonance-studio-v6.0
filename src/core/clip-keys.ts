import type { Clip, Project, VisualizerEvent, VolumeAutomation } from "./models";
import { clipById } from "./models";
import {
  automationValueAt,
  sanitizeVolumeAutomation,
  sortVolumeAutomationPoints,
  type VolumeAutomationPoint,
} from "./volume-automation";

export type ClipKeyKind = "gain" | "opacity";

/** Disabled or empty lanes are identity and are omitted from saved clips. */
export function presentClipKeys(raw: unknown): VolumeAutomation | undefined {
  const lane = sanitizeVolumeAutomation(raw);
  if (!lane || !lane.enabled || lane.points.length === 0) return undefined;
  return lane;
}

export function keyFactorAt(lane: VolumeAutomation | undefined, localMs: number): number {
  if (!lane || !lane.enabled || lane.points.length === 0) return 1;
  return automationValueAt(lane, localMs);
}

export function remapClipKeys(
  lane: VolumeAutomation | undefined,
  headTrimMs: number,
  visibleMs: number,
): VolumeAutomation | undefined {
  if (!lane || !lane.enabled || lane.points.length === 0) return undefined;
  const head = Math.max(0, headTrimMs);
  const vis = Math.max(0, visibleMs);
  const points = lane.points
    .map((point) => ({ timeMs: Math.round(point.timeMs - head), value: point.value }))
    .filter((point) => point.timeMs >= 0 && point.timeMs <= vis + 1);
  if (points.length === 0) {
    return { enabled: true, points: [{ timeMs: 0, value: automationValueAt(lane, head) }] };
  }
  return { enabled: true, points: sortVolumeAutomationPoints(points) };
}

export function laneWithPoint(
  lane: VolumeAutomation | undefined,
  timeMs: number,
  value: number,
): VolumeAutomation {
  const points = sortVolumeAutomationPoints([...(lane?.points ?? []), { timeMs, value }]);
  return { enabled: true, points };
}

export function laneWithoutPoint(
  lane: VolumeAutomation | undefined,
  timeMs: number,
): VolumeAutomation | undefined {
  if (!lane) return undefined;
  const points = lane.points.filter((point) => Math.abs(point.timeMs - timeMs) > 1);
  if (points.length === 0) return undefined;
  return { enabled: lane.enabled, points };
}

export function moveLanePoint(
  lane: VolumeAutomation | undefined,
  fromMs: number,
  timeMs: number,
  value: number,
): VolumeAutomation | undefined {
  if (!lane) return undefined;
  const rest = lane.points.filter((point) => Math.abs(point.timeMs - fromMs) > 1);
  return laneWithPoint({ ...lane, points: rest }, timeMs, value);
}

function writeClipLane(clip: Clip, kind: ClipKeyKind, lane: VolumeAutomation | undefined): Clip {
  if (kind === "gain") {
    return lane ? { ...clip, gainKeys: lane } : { ...clip, gainKeys: undefined };
  }
  return lane ? { ...clip, opacityKeys: lane } : { ...clip, opacityKeys: undefined };
}

export function setClipKeyLane(
  project: Project,
  clipId: string,
  kind: ClipKeyKind,
  lane: VolumeAutomation | undefined,
): { project: Project; error?: string } {
  const clip = clipById(project, clipId);
  if (!clip) return { project, error: "Clip not found" };
  const stored = lane ? presentClipKeys(lane) : undefined;
  return {
    project: {
      ...project,
      clips: project.clips.map((c) => (c.id === clipId ? writeClipLane(c, kind, stored) : c)),
      updatedAt: new Date().toISOString(),
    },
  };
}

export function addClipKeyPoint(
  project: Project,
  clipId: string,
  kind: ClipKeyKind,
  localMs: number,
  value = 1,
): { project: Project; error?: string } {
  const clip = clipById(project, clipId);
  if (!clip) return { project, error: "Clip not found" };
  if (localMs < 0 || localMs > clip.durationMs) return { project, error: "Playhead is outside the clip" };
  const current = kind === "gain" ? clip.gainKeys : clip.opacityKeys;
  return setClipKeyLane(project, clipId, kind, laneWithPoint(current, Math.round(localMs), value));
}

export function setVisOpacityKeys(
  project: Project,
  eventId: string,
  lane: VolumeAutomation | undefined,
): { project: Project; error?: string } {
  const events = project.visualizer.events ?? [];
  if (!events.some((event) => event.id === eventId)) return { project, error: "VIS event not found" };
  const next = presentClipKeys(lane);
  return {
    project: {
      ...project,
      visualizer: {
        ...project.visualizer,
        events: events.map((event) =>
          event.id === eventId
            ? next
              ? { ...event, opacityKeys: next }
              : { ...event, opacityKeys: undefined }
            : event,
        ),
      },
      updatedAt: new Date().toISOString(),
    },
  };
}

export function visOpacityAt(event: VisualizerEvent, timelineMs: number): number {
  const local = timelineMs - event.startMs;
  return keyFactorAt(event.opacityKeys, local);
}

export type { VolumeAutomationPoint };
