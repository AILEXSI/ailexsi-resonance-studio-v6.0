/**
 * Structured Director response contract.
 * Free-form prose is conversation only and never mutates Project.
 * Only a validated toolRequest may enter the Resonance tool / transaction path.
 */

export const DIRECTOR_MUTATING_TOOL = "timeline.move_clip";

export interface DirectorToolRequest {
  name: string;
  arguments: Record<string, unknown>;
}

export interface DirectorStructuredOk {
  ok: true;
  message: string;
  toolRequest?: DirectorToolRequest;
}

export interface DirectorStructuredFail {
  ok: false;
  code: "MALFORMED_RESPONSE";
  message: string;
}

export type DirectorStructuredParse = DirectorStructuredOk | DirectorStructuredFail;

export const DIRECTOR_RESPONSE_CONTRACT_PROMPT = [
  "You are the Resonance Studio Director adapter.",
  "Reply with JSON only in this exact shape:",
  '{"message":"string","toolRequest":{"name":"timeline.move_clip","arguments":{"deltaMs":2000}}}',
  "toolRequest is optional. Free-form prose never mutates the project.",
  "The only mutating tool is timeline.move_clip.",
  "Use the selected clip id when present. Exact signed millisecond integers only.",
  "Before Apply, Resonance has not committed. Describe a preview only:",
  'use "Prepared move…" / "Preview…". Never say moved, done, completed, or changed.',
].join(" ");

export function parseDirectorResponse(text: string): DirectorStructuredParse {
  const trimmed = text.trim();
  if (!trimmed) return { ok: true, message: "" };
  if (!trimmed.startsWith("{")) {
    return { ok: true, message: text };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { ok: false, code: "MALFORMED_RESPONSE", message: "Malformed structured response" };
  }
  return validateDirectorResponseShape(parsed);
}

export function validateDirectorResponseShape(value: unknown): DirectorStructuredParse {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, code: "MALFORMED_RESPONSE", message: "Structured response must be an object" };
  }
  const rec = value as Record<string, unknown>;
  const looksStructured = "message" in rec || "toolRequest" in rec;
  if (!looksStructured) {
    return { ok: true, message: JSON.stringify(value) };
  }
  if (typeof rec.message !== "string") {
    return { ok: false, code: "MALFORMED_RESPONSE", message: "message must be a string" };
  }
  if (rec.toolRequest === undefined) {
    return { ok: true, message: rec.message };
  }
  if (rec.toolRequest == null || typeof rec.toolRequest !== "object" || Array.isArray(rec.toolRequest)) {
    return { ok: false, code: "MALFORMED_RESPONSE", message: "toolRequest must be an object" };
  }
  const tool = rec.toolRequest as Record<string, unknown>;
  if (typeof tool.name !== "string" || !tool.name.trim()) {
    return { ok: false, code: "MALFORMED_RESPONSE", message: "toolRequest.name must be a string" };
  }
  if (tool.arguments == null || typeof tool.arguments !== "object" || Array.isArray(tool.arguments)) {
    return { ok: false, code: "MALFORMED_RESPONSE", message: "toolRequest.arguments must be an object" };
  }
  return {
    ok: true,
    message: rec.message,
    toolRequest: {
      name: tool.name,
      arguments: { ...(tool.arguments as Record<string, unknown>) },
    },
  };
}

export function isKnownMutatingTool(name: string): boolean {
  return name === DIRECTOR_MUTATING_TOOL;
}

/**
 * Contract success language. A "Prepared move" / "Preview…" claim is not
 * successful preparation unless a sealed Transaction PREVIEW exists.
 */
export const UNSEALED_PREPARED_MOVE_MESSAGE =
  "No sealed Transaction PREVIEW. Provider prose is not a draft. No Apply/Reject. No project changes were made.";

export function looksLikePreparedMoveClaim(text: string): boolean {
  const n = text.trim().toLowerCase();
  if (!n) return false;
  return n.startsWith("prepared move") || n.startsWith("preview");
}
