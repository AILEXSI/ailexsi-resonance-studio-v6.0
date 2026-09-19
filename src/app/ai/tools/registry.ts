import { invokeReadTool, READ_TOOLS, type ToolRuntime } from "./read-tools";
import type { ToolDefinition, ToolResult } from "./types";

const extras = new Map<string, ToolDefinition>();

export function listTools(): ToolDefinition[] {
  return [...READ_TOOLS, ...extras.values()];
}

export function getTool(name: string): ToolDefinition | undefined {
  return listTools().find((t) => t.name === name);
}

export function invokeTool(name: string, args: unknown, runtime: ToolRuntime): ToolResult {
  if (READ_TOOLS.some((t) => t.name === name) || !extras.has(name)) {
    return invokeReadTool(name, args, runtime);
  }
  return { ok: false, code: "UNKNOWN_TOOL", message: `Unknown tool: ${name}` };
}

export function registerExtraTool(def: ToolDefinition): void {
  extras.set(def.name, def);
}

export function clearExtraTools(): void {
  extras.clear();
}
