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

/** Named selected item: marked / markiert / clip / file / selected. */
function namesSelectedItem(n: string): boolean {
  return (
    n.includes("markiert") ||
    n.includes("marked") ||
    n.includes("clip") ||
    n.includes("file") ||
    n.includes("selected")
  );
}

function hasMoveVerb(n: string): boolean {
  return n.includes("verschiebe") || n.startsWith("move ") || n.includes(" move ");
}

function hasLeftDirection(n: string): boolean {
  return n.includes("links") || n.includes(" left");
}

function hasRightDirection(n: string): boolean {
  return n.includes("rechts") || n.includes(" right");
}

const MOVE_SECOND_WORDS: Readonly<Record<string, number>> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  eine: 1,
  ein: 1,
  zwei: 2,
  drei: 3,
  vier: 4,
  funf: 5,
};

/** Integer seconds 1–3600. Word forms for golden + human 2/3/5 s. */
function parseMoveSeconds(n: string): number | null {
  for (const [word, sec] of Object.entries(MOVE_SECOND_WORDS)) {
    if (n.includes(`${word} sekunden`) || n.includes(`${word} seconds`) || n.includes(`${word} sec`)) {
      return sec;
    }
  }
  const digit = n.match(/\b(\d{1,4})\s*(sekunden|seconds|secs|sec)\b/);
  if (!digit) return null;
  const sec = Number(digit[1]);
  if (!Number.isSafeInteger(sec) || sec <= 0 || sec > 3600) return null;
  return sec;
}

/**
 * Known move family. English + German: move marked/clip N sec left/right, verschiebe…
 * Phrase checks plus one bounded second extract. Does not invent other tools.
 */
export function parseMoveClipPrompt(text: string): { deltaMs: number } | null {
  const n = normalizeDirectorPrompt(text);
  if (!hasMoveVerb(n) || !namesSelectedItem(n)) return null;
  const left = hasLeftDirection(n);
  const right = hasRightDirection(n);
  if (left === right) return null;
  const seconds = parseMoveSeconds(n);
  if (seconds == null) return null;
  return { deltaMs: left ? -seconds * 1000 : seconds * 1000 };
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
