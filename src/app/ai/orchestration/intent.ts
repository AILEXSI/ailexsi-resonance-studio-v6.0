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
  if (
    n.includes("verschiebe den markierten clip") &&
    n.includes("zwei sekunden") &&
    n.includes("rechts")
  ) {
    return { kind: "MOVE_CLIP", confidence: "known", reason: "move selected clip +2s" };
  }
  return { kind: "UNCERTAIN", confidence: "uncertain", reason: "no known route" };
}
