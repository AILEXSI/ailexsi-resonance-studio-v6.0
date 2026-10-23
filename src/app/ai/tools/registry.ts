import type { Session } from "../../session";
import {
  getClipsOnTrack,
  getMarkers,
  getPlayhead,
  getProjectSummary,
  getSelection,
  listAudioTracks,
} from "./read";
import { toolErr, type ToolResult } from "./result";

/** In-process read tools. Names match the brief. They do not mutate. */
export const READ_TOOL_NAMES = [
  "get_project_summary",
  "get_selection",
  "get_playhead",
  "get_clips_on_track",
  "get_markers",
  "list_audio_tracks",
] as const;

export type ReadToolName = (typeof READ_TOOL_NAMES)[number];

export function isReadToolName(name: string): name is ReadToolName {
  return (READ_TOOL_NAMES as readonly string[]).includes(name);
}

function trackIdArg(args: unknown): unknown {
  if (!args || typeof args !== "object") return undefined;
  return (args as { trackId?: unknown }).trackId;
}

/** Dispatch a read tool. Unknown names and mutation names fail closed. */
export function callReadTool(session: Session, name: string, args?: unknown): ToolResult<unknown> {
  switch (name) {
    case "get_project_summary":
      return getProjectSummary(session);
    case "get_selection":
      return getSelection(session);
    case "get_playhead":
      return getPlayhead(session);
    case "get_clips_on_track":
      return getClipsOnTrack(session, trackIdArg(args));
    case "get_markers":
      return getMarkers(session);
    case "list_audio_tracks":
      return listAudioTracks(session);
    default:
      return toolErr("UNKNOWN_TOOL", "Unknown tool");
  }
}
