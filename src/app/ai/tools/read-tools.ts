import {
  analysisAudioClipAt,
  clipById,
  clipIsLocked,
  kindOfTrack,
  orderedTracks,
  projectDurationMs,
  trackById,
  type Project,
} from "../../../core/models";
import { automationValueAt, volumeAutomationOf } from "../../../core/volume-automation";
import { createOfflineFeatureExtractor, type MixPcm } from "../../../core/visualz/feature-extractor";
import { selectionOf, type Session } from "../../session";
import type { JsonSchema, ToolDefinition, ToolError, ToolResult } from "./types";
import { isLikelyDisplayName, validateArgs } from "./validate";
import { INSPECT_RANGE_TOOL, inspectTimelineRange } from "./inspect-range";

export interface ToolRuntime {
  session: Session;
  grant: "READ" | "DRAFT" | "EDIT";
  /** Optional in-memory PCM. Never read from Project. */
  pcmByClipId?: Record<string, MixPcm>;
}

const object = (properties: JsonSchema["properties"], required?: string[]): JsonSchema => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

export const READ_TOOLS: ToolDefinition[] = [
  {
    name: "project.describe",
    description: "Compact project identity and counts. No media.",
    grant: "READ",
    inputSchema: object({}),
  },
  {
    name: "timeline.describe",
    description: "Compact track/clip structure. Optional time range in ms.",
    grant: "READ",
    inputSchema: object({
      fromMs: { type: "number", description: "Inclusive start (ms)" },
      toMs: { type: "number", description: "Exclusive end (ms)" },
    }),
  },
  {
    name: "timeline.get_selection",
    description: "Current session selection (clips, tracks, VIS, marker, vol point).",
    grant: "READ",
    inputSchema: object({}),
  },
  {
    name: "timeline.get_clip",
    description: "One clip by stable clipId.",
    grant: "READ",
    inputSchema: object({ clipId: { type: "string" } }, ["clipId"]),
  },
  {
    name: "audio.get_analysis",
    description:
      "Offline analysis summary. Requires runtime PCM (not stored on Project). Omits spectrum/PCM.",
    grant: "READ",
    inputSchema: object({
      clipId: { type: "string" },
      timeMs: { type: "number" },
    }),
  },
  {
    name: "automation.read",
    description: "Volume automation on an audio track. No automationLaneId (does not exist).",
    grant: "READ",
    inputSchema: object({
      trackId: { type: "string" },
      timeMs: { type: "number" },
    }, ["trackId"]),
  },
  {
    name: INSPECT_RANGE_TOOL,
    description:
      "Compact deterministic timeline facts for a range. Existing Project/Session fields only. No media.",
    grant: "READ",
    inputSchema: object({
      fromMs: { type: "number", description: "Inclusive start (ms)" },
      toMs: { type: "number", description: "Exclusive end (ms)" },
      trackIds: { type: "array", description: "Optional track id filter", items: { type: "string" } },
      maxClips: { type: "number", description: "Fail closed when the range has more clips" },
    }),
  },
];

function deny(code: ToolError["code"], message: string): ToolError {
  return { ok: false, code, message };
}

function requireRead(runtime: ToolRuntime): ToolError | null {
  if (runtime.grant !== "READ" && runtime.grant !== "DRAFT" && runtime.grant !== "EDIT") {
    return deny("GRANT_DENIED", "READ grant required");
  }
  return null;
}

export function projectDescribe(project: Project) {
  return {
    projectId: project.id,
    name: project.name,
    schemaVersion: project.schemaVersion,
    durationMs: projectDurationMs(project),
    trackIds: orderedTracks(project).map((t) => t.id),
    clipCount: project.clips.length,
  };
}

export function invokeReadTool(name: string, args: unknown, runtime: ToolRuntime): ToolResult {
  const def = READ_TOOLS.find((t) => t.name === name);
  if (!def) return deny("UNKNOWN_TOOL", `Unknown tool: ${name}`);
  const grantErr = requireRead(runtime);
  if (grantErr) return grantErr;
  const argErr = validateArgs(def.inputSchema, args ?? {});
  if (argErr) return argErr;
  const rec = (args ?? {}) as Record<string, unknown>;
  const session = runtime.session;
  const project = session.project;

  switch (name) {
    case "project.describe":
      return { ok: true, data: projectDescribe(project) };
    case "timeline.describe": {
      const fromMs = typeof rec.fromMs === "number" ? rec.fromMs : 0;
      const toMs = typeof rec.toMs === "number" ? rec.toMs : Number.POSITIVE_INFINITY;
      const tracks = orderedTracks(project).map((t) => ({
        trackId: t.id,
        kind: t.kind,
        name: t.name,
      }));
      const clips = project.clips
        .filter((c) => c.startMs < toMs && c.startMs + c.durationMs > fromMs)
        .map((c) => ({
          clipId: c.id,
          trackId: c.trackId,
          startMs: c.startMs,
          durationMs: c.durationMs,
          locked: clipIsLocked(c),
        }));
      return { ok: true, data: { tracks, clips } };
    }
    case "timeline.get_selection":
      return {
        ok: true,
        data: {
          clipIds: selectionOf(session),
          primaryClipId: session.selectedClipId,
          trackIds: session.selectedTrackIds,
          targetTrackId: session.targetTrackId,
          visEventId: session.selectedVisEventId,
          markerId: session.selectedMarkerId,
          volumePoint: session.selectedVolumeAutomation ?? null,
        },
      };
    case "timeline.get_clip": {
      const clipId = String(rec.clipId);
      const clip = clipById(project, clipId);
      if (!clip) {
        if (isLikelyDisplayName(clipId)) return deny("INVALID_ARGS", "Display names are not ids");
        return deny("UNKNOWN_CLIP", "Clip not found");
      }
      return {
        ok: true,
        data: {
          clipId: clip.id,
          trackId: clip.trackId,
          startMs: clip.startMs,
          durationMs: clip.durationMs,
          locked: clipIsLocked(clip),
          enabled: clip.enabled !== false,
        },
      };
    }
    case "audio.get_analysis": {
      const timeMs = typeof rec.timeMs === "number" ? rec.timeMs : project.playheadMs;
      const clipId = typeof rec.clipId === "string" ? rec.clipId : analysisAudioClipAt(project, timeMs)?.id;
      if (!clipId) return deny("NOT_AVAILABLE", "No analysis clip at time");
      const clip = clipById(project, clipId);
      if (!clip) {
        if (isLikelyDisplayName(clipId)) return deny("INVALID_ARGS", "Display names are not ids");
        return deny("UNKNOWN_CLIP", "Clip not found");
      }
      const pcm = runtime.pcmByClipId?.[clipId];
      if (!pcm) {
        return {
          ok: true,
          data: {
            clipId,
            timeMs,
            available: false,
            reason: "NO_PCM",
            note: "Offline extractor requires MixPcm bound at runtime; Project does not store PCM.",
          },
        };
      }
      const features = createOfflineFeatureExtractor(pcm).sample(timeMs);
      return {
        ok: true,
        data: {
          clipId,
          timeMs: features.timeMs,
          available: true,
          rms: features.rms,
          bass: features.bass,
          mid: features.mid,
          treble: features.treble,
          onset: features.onset,
          beatPulse: features.beatPulse,
        },
      };
    }
    case INSPECT_RANGE_TOOL:
      return inspectTimelineRange(session, {
        fromMs: typeof rec.fromMs === "number" ? rec.fromMs : undefined,
        toMs: typeof rec.toMs === "number" ? rec.toMs : undefined,
        trackIds: Array.isArray(rec.trackIds) ? (rec.trackIds as string[]) : undefined,
        maxClips: typeof rec.maxClips === "number" ? rec.maxClips : undefined,
      });
    case "automation.read": {
      const trackId = String(rec.trackId);
      if (trackId === "VIS" || trackId === "master") {
        return deny("INVALID_ARGS", "Display names are not ids");
      }
      const track = trackById(project, trackId);
      if (!track) return deny("UNKNOWN_TRACK", "Track not found");
      if (kindOfTrack(trackId) !== "audio") {
        return deny("INVALID_ARGS", "Volume automation is audio-track only");
      }
      const env = volumeAutomationOf(track);
      const timeMs = typeof rec.timeMs === "number" ? rec.timeMs : undefined;
      return {
        ok: true,
        data: {
          trackId,
          enabled: env.enabled,
          points: env.points.map((p) => ({ timeMs: p.timeMs, value: p.value })),
          valueAt: timeMs == null ? undefined : automationValueAt(env, timeMs),
        },
      };
    }
    default:
      return deny("UNKNOWN_TOOL", `Unknown tool: ${name}`);
  }
}
