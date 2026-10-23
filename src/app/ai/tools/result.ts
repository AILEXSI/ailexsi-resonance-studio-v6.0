export type ToolOk<T> = { ok: true; data: T };
export type ToolErr = { ok: false; code: string; error: string };
export type ToolResult<T> = ToolOk<T> | ToolErr;

export function toolOk<T>(data: T): ToolOk<T> {
  return { ok: true, data };
}

export function toolErr(code: string, error: string): ToolErr {
  return { ok: false, code, error };
}
