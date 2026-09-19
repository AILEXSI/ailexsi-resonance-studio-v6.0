/**
 * Deterministic Director intent. Plans only — never mutates Project,
 * never executes tools, never asks the LLM for permissions.
 */

export const DIRECTOR_INTENT_KINDS = [
  "ASK_SELECTION",
  "READ_CLIP",
  "MOVE_CLIP",
  "DRAFT_CUT",
  "ASK_CAPABILITY",
  "UNSUPPORTED",
  "UNCERTAIN",
] as const;

export type DirectorIntentKind = (typeof DIRECTOR_INTENT_KINDS)[number];

export interface DirectorIntent {
  kind: DirectorIntentKind;
  confidence: "known" | "uncertain";
  reason: string;
}

export function normalizeDirectorPrompt(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/ö/g, "o")
    .replace(/ä/g, "a")
    .replace(/ü/g, "u")
    .replace(/ß/g, "ss")
    .replace(/[?!.,:;]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Named selected item: markiert / clip / file (studio slang). */
function namesSelectedItem(n: string): boolean {
  return n.includes("markiert") || n.includes("clip") || n.includes("file");
}

function hasTwoSeconds(n: string): boolean {
  return n.includes("zwei sekunden") || n.includes("2 sekunden") || n.includes("2sec") || n.includes("2 sec");
}

function hasThreeSeconds(n: string): boolean {
  return n.includes("drei sekunden") || n.includes("3 sekunden") || n.includes("3sec") || n.includes("3 sec");
}

function hasLeftDirection(n: string): boolean {
  return n.includes("links") || n.includes(" left");
}

function hasRightDirection(n: string): boolean {
  return n.includes("rechts") || n.includes(" right");
}

/**
 * Known move family. Golden +2s, human +2s / +3s, and exact left −2s.
 * Phrase checks, not a regex maze. Does not invent other tools.
 */
export function parseMoveClipPrompt(text: string): { deltaMs: number } | null {
  const n = normalizeDirectorPrompt(text);
  if (!n.includes("verschiebe") || !namesSelectedItem(n)) return null;
  const left = hasLeftDirection(n);
  const right = hasRightDirection(n);
  if (left === right) return null;
  const magnitude = hasThreeSeconds(n) ? 3000 : hasTwoSeconds(n) ? 2000 : null;
  if (magnitude == null) return null;
  return { deltaMs: left ? -magnitude : magnitude };
}

/** Alias kept for existing golden / mock call sites. */
export function parseMoveRightPrompt(text: string): { deltaMs: number } | null {
  return parseMoveClipPrompt(text);
}

/**
 * Known routes only. Uncertain → less authority (never silent EDIT).
 * Phrase checks, not a regex maze.
 */
export function classifyDirectorIntent(text: string): DirectorIntent {
  const n = normalizeDirectorPrompt(text);
  if (!n) return { kind: "UNCERTAIN", confidence: "uncertain", reason: "empty" };

  if (n === "what is selected" || n === "was ist ausgewahlt" || n === "was ist markiert") {
    return { kind: "ASK_SELECTION", confidence: "known", reason: "selection question" };
  }
  if (n.includes("analysiere den markierten clip") || n.includes("analyze the selected clip")) {
    return { kind: "READ_CLIP", confidence: "known", reason: "analyze selected clip" };
  }
  if (n.includes("losche den markierten clip") || n.includes("delete the selected clip")) {
    return { kind: "UNSUPPORTED", confidence: "known", reason: "delete is not a tool" };
  }
  if (n === "vorschlag schneiden") {
    return { kind: "DRAFT_CUT", confidence: "known", reason: "cut proposal only" };
  }
  if (n === "was kannst du" || n === "what can you do") {
    return { kind: "ASK_CAPABILITY", confidence: "known", reason: "capability question" };
  }
  const move = parseMoveClipPrompt(text);
  if (move) {
    const seconds = Math.abs(move.deltaMs) / 1000;
    const dir = move.deltaMs < 0 ? "left" : "right";
    return {
      kind: "MOVE_CLIP",
      confidence: "known",
      reason: `move selected clip ${move.deltaMs > 0 ? "+" : ""}${seconds}s ${dir}`,
    };
  }
  return { kind: "UNCERTAIN", confidence: "uncertain", reason: "no known route" };
}
