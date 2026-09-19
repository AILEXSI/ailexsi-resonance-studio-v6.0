export type ToolGrant = "READ" | "DRAFT" | "EDIT";

export interface JsonSchema {
  type: "object";
  properties: Record<string, { type?: string; description?: string; enum?: string[] }>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  grant: "READ";
}

export type ToolErrorCode =
  | "UNKNOWN_TOOL"
  | "INVALID_ARGS"
  | "UNKNOWN_CLIP"
  | "UNKNOWN_TRACK"
  | "GRANT_DENIED"
  | "NOT_AVAILABLE";

export interface ToolError {
  ok: false;
  code: ToolErrorCode;
  message: string;
}

export interface ToolOk<T> {
  ok: true;
  data: T;
}

export type ToolResult<T = unknown> = ToolOk<T> | ToolError;
