import { toolErr, toolOk, type ToolResult } from "./tools/result";
import { MUTATION_TOOL_NAMES } from "./tools/mutate";
import { READ_TOOL_NAMES } from "./tools/registry";

/** Tools the Director may call. Human editor commands are not in this list. */
export const DEFAULT_TOOL_ALLOW: readonly string[] = [...READ_TOOL_NAMES, ...MUTATION_TOOL_NAMES];

const REFUSED = new Set([
  "history.undo",
  "history.redo",
  "render.preview",
  "audio.get_analysis",
  "shell",
  "filesystem.write",
]);

export function assertToolAllowed(name: string, allow: readonly string[] = DEFAULT_TOOL_ALLOW): ToolResult<true> {
  if (REFUSED.has(name) || !allow.includes(name)) {
    return toolErr("TOOL_DENIED", "Tool is not granted");
  }
  return toolOk(true);
}
