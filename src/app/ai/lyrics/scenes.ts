import type { EditorCommand } from "../../commands";
import { isVisualizerSceneId, type VisualizerSceneId } from "../../../core/models";
import { createId } from "../../../core/ids";
import { projectStandIn } from "../stand-in";
import type { Session } from "../../session";
import type { AITransaction } from "../transactions";
import type { LyricLine, LyricSidecar } from "./sidecar";
import { splitLyricText } from "./sidecar";

const RULES: readonly { sceneId: VisualizerSceneId; words: readonly string[] }[] = [
  { sceneId: "ember-rain", words: ["fire", "feuer", "flame", "flamme", "burn", "asche", "ash"] },
  { sceneId: "liquid-gold", words: ["water", "wasser", "ocean", "meer", "rain", "regen", "river", "fluss"] },
  { sceneId: "aurora-veil", words: ["night", "nacht", "moon", "mond", "star", "stern", "dark", "dunkel"] },
  { sceneId: "particle-field", words: ["crowd", "menge", "city", "stadt", "people", "leute", "street", "strasse", "straße"] },
  { sceneId: "pulse-orb", words: ["heart", "herz", "love", "liebe"] },
];

export function sceneForLine(text: string): { sceneId: VisualizerSceneId; reason: string } {
  const tokens: string[] = text.toLowerCase().match(/[a-zäöüß]+/g) ?? [];
  let best: { index: number; sceneId: VisualizerSceneId; word: string } | null = null;
  for (const rule of RULES) {
    for (const word of rule.words) {
      const index = tokens.indexOf(word);
      if (index < 0) continue;
      if (!best || index < best.index) best = { index, sceneId: rule.sceneId, word };
    }
  }
  if (best) {
    return {
      sceneId: best.sceneId,
      reason: `The line contains "${best.word}". This is a catalog scene, not a generated shot.`,
    };
  }
  return {
    sceneId: "spectrum-bars",
    reason: "No listed word matched. Spectrum Bars is the default catalog scene, not a generated shot.",
  };
}

export function lyricLinesForProposal(hostText: string | undefined, args: unknown): string[] {
  const host = splitLyricText(hostText ?? "");
  if (host.length > 0) return host;
  if (!args || typeof args !== "object" || Array.isArray(args)) return [];
  const text = (args as { text?: unknown }).text;
  return typeof text === "string" ? splitLyricText(text) : [];
}

export function suggestScenes(projectId: string, texts: readonly string[], previous?: LyricSidecar | null): LyricSidecar {
  const lines: LyricLine[] = texts.map((text, index) => {
    const idea = sceneForLine(text);
    if (!isVisualizerSceneId(idea.sceneId)) {
      throw new Error(`Unknown scene ${idea.sceneId}`);
    }
    const prior = previous?.lines[index];
    return {
      text,
      startMs: prior && prior.text === text ? prior.startMs : null,
      endMs: prior && prior.text === text ? prior.endMs : null,
      sceneId: idea.sceneId,
      imagePrompt: `Image idea from this line: ${text}`,
      reason: idea.reason,
    };
  });
  return {
    kind: "ailexsi-lyric-sidecar",
    sidecarVersion: 1,
    projectSchemaVersion: 5,
    projectId,
    lines,
    alignment: previous?.alignment ?? {
      engine: "none",
      status: "unaligned",
      message: "Scene ideas do not include times.",
    },
  };
}

export function summarizeScenes(sidecar: LyricSidecar): string {
  const rows = sidecar.lines.map(
    (line, index) => `${index + 1}. ${line.sceneId}: ${line.text}`,
  );
  return [
    `Scene ideas for ${sidecar.lines.length} line${sidecar.lines.length === 1 ? "" : "s"}.`,
    "Accept stores them beside the project. It does not place a scene on the timeline and it does not generate an image.",
    rows.join(" | "),
  ].join(" ");
}

const UNAPPLIED: EditorCommand = { type: "addMarker", label: "lyric scene proposal is not applied" };

/** Proposal only. Accept must not replay `command`. */
export function proposeLyricScenes(session: Session, hostText: string | undefined, args: unknown, previous?: LyricSidecar | null): {
  text: string;
  transaction: AITransaction | null;
} {
  const texts = lyricLinesForProposal(hostText, args);
  if (texts.length === 0) {
    return { text: "Paste lyrics first. Nothing was changed.", transaction: null };
  }
  const sidecar = suggestScenes(session.project.id, texts, previous);
  const summary = summarizeScenes(sidecar);
  const transaction: AITransaction = {
    id: createId("aitx"),
    status: "proposed",
    statuses: ["proposed"],
    tool: "lyrics.suggest_scenes",
    summary,
    steps: [],
    command: UNAPPLIED,
    baseStandIn: projectStandIn(session.project),
    basePastLength: session.history.past.length,
    prompt: hostText ?? "",
    lyricSidecar: sidecar,
  };
  return { text: summary, transaction };
}
