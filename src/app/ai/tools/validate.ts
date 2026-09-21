import type { JsonSchema, ToolError } from "./types";

const DISPLAY_NAME = /^(Vocals|A[1-9]\d*|V[12]|master|VIS)$/i;

export function isLikelyDisplayName(id: string): boolean {
  if (!id) return true;
  if (id.startsWith("clip_") || id.startsWith("asset_") || id.startsWith("a_") || id.startsWith("proj_")) {
    return false;
  }
  return DISPLAY_NAME.test(id) || !id.includes("_");
}

export function validateArgs(schema: JsonSchema, args: unknown): ToolError | null {
  if (args == null || typeof args !== "object" || Array.isArray(args)) {
    return { ok: false, code: "INVALID_ARGS", message: "Arguments must be an object" };
  }
  const rec = args as Record<string, unknown>;
  if (schema.additionalProperties === false) {
    for (const key of Object.keys(rec)) {
      if (!(key in schema.properties)) {
        return { ok: false, code: "INVALID_ARGS", message: `Unknown argument: ${key}` };
      }
    }
  }
  for (const req of schema.required ?? []) {
    if (rec[req] === undefined || rec[req] === null || rec[req] === "") {
      return { ok: false, code: "INVALID_ARGS", message: `Missing argument: ${req}` };
    }
  }
  for (const [key, spec] of Object.entries(schema.properties)) {
    if (rec[key] === undefined) continue;
    if (spec.type === "string" && typeof rec[key] !== "string") {
      return { ok: false, code: "INVALID_ARGS", message: `${key} must be a string` };
    }
    if (spec.type === "number") {
      if (typeof rec[key] !== "number" || !Number.isFinite(rec[key])) {
        return { ok: false, code: "INVALID_ARGS", message: `${key} must be a finite number` };
      }
    }
    if (spec.type === "array") {
      if (!Array.isArray(rec[key])) {
        return { ok: false, code: "INVALID_ARGS", message: `${key} must be an array` };
      }
      const itemType = spec.items?.type;
      if (itemType === "string" && rec[key].some((v) => typeof v !== "string")) {
        return { ok: false, code: "INVALID_ARGS", message: `${key} must be a string array` };
      }
      if (
        itemType === "number" &&
        rec[key].some((v) => typeof v !== "number" || !Number.isFinite(v))
      ) {
        return { ok: false, code: "INVALID_ARGS", message: `${key} must be a number array` };
      }
    }
    if (spec.enum && !spec.enum.includes(String(rec[key]))) {
      return { ok: false, code: "INVALID_ARGS", message: `${key} is not an allowed value` };
    }
  }
  return null;
}
