import { createId } from "../../../core/ids";
import { FRAME_MS } from "../../../core/models";
import type { AIProvider, ProviderEvent, ProviderMessage, ProviderRequest, ToolCall } from "./types";

export interface MockIntent {
  text: string;
  toolCalls: ToolCall[];
}

function call(name: string, args: unknown): ToolCall {
  return { id: createId("aicall"), name, arguments: args };
}

function userText(messages: readonly ProviderMessage[]): string {
  const users = messages.filter((message) => message.role === "user");
  return users[users.length - 1]?.content ?? "";
}

/**
 * Deterministic offline intent. No network and no project bytes.
 * Beat language is refused here; marker cuts are a later step.
 */
export function mockIntent(messages: readonly ProviderMessage[]): MockIntent {
  const text = userText(messages);
  const beat = /\b(beat|beats|takt|takte)\b/i.test(text);
  const toolReply = [...messages].reverse().find((message) => message.role === "tool");
  if (toolReply && beat) {
    let count = 0;
    try {
      const parsed = JSON.parse(toolReply.content) as { ok?: boolean; data?: unknown };
      if (parsed.ok === true && Array.isArray(parsed.data)) count = parsed.data.length;
    } catch {
      count = 0;
    }
    if (count === 0) {
      return {
        text: "No beat or marker data is in this project. I have not analyzed audio and I will not invent a tempo. Nothing was changed.",
        toolCalls: [],
      };
    }
    const includeTransitions = /\b(transition|transitions|übergang|übergänge|crossfade)\b/i.test(text);
    return {
      text: "Using project marker times only. Audio was not analyzed. Nothing changes until you accept.",
      toolCalls: [call("timeline.split_at_markers", { includeTransitions })],
    };
  }
  if (toolReply) {
    return { text: "Read complete. Nothing was changed.", toolCalls: [] };
  }
  if (beat) {
    return {
      text: "Reading project markers. Audio was not analyzed.",
      toolCalls: [call("get_markers", {})],
    };
  }
  const move = /\b(verschieb\w*|move|schieb\w*)\b/i.test(text);
  const twoSeconds = /(?:\b2\b|\bzwei\b)(?:\s+\S+){0,4}?\s*(?:sekunden|seconds|secs|sec|sek)\b/i.test(text);
  const right = /\b(rechts|right)\b/i.test(text);
  const left = /\b(links|left)\b/i.test(text);
  if (move && twoSeconds && (right || left)) {
    return {
      text: "Proposal ready. Nothing changes until you accept.",
      toolCalls: [call("timeline.move_clip", { deltaSeconds: right ? 2 : -2 })],
    };
  }
  if (/\b(split|schneid\w*|teil\w*)\b/i.test(text) && /\b(playhead|abspielkopf)\b/i.test(text)) {
    return {
      text: "Proposal ready. Nothing changes until you accept.",
      toolCalls: [call("timeline.split_at_playhead", {})],
    };
  }
  if (/\b(lösch\w*|loesch\w*|delete|entferne\w*|lift-delete|lift)\b/i.test(text) && /\bclips?\b/i.test(text)) {
    return {
      text: "Proposal ready. Nothing changes until you accept.",
      toolCalls: [call("timeline.lift_delete", {})],
    };
  }
  if (/\b(nudge|frame|bild)\b/i.test(text)) {
    const sign = left ? -1 : 1;
    return {
      text: "Proposal ready. Nudge can snap. Nothing changes until you accept.",
      toolCalls: [call("timeline.nudge", { deltaMs: sign * FRAME_MS })],
    };
  }
  if (/\b(marker|markers|marken)\b/i.test(text)) {
    return { text: "Reading markers. Audio was not analyzed.", toolCalls: [call("get_markers", {})] };
  }
  if (/\b(playhead|abspielkopf)\b/i.test(text)) {
    return { text: "Reading the playhead.", toolCalls: [call("get_playhead", {})] };
  }
  if (/\b(selection|auswahl|markiert)\b/i.test(text)) {
    return { text: "Reading the selection.", toolCalls: [call("get_selection", {})] };
  }
  if (/\b(summary|überblick|ueberblick|projekt)\b/i.test(text)) {
    return { text: "Reading the project summary.", toolCalls: [call("get_project_summary", {})] };
  }
  if (/\b(audio tracks|tonspuren|tonspur)\b/i.test(text)) {
    return { text: "Reading audio tracks.", toolCalls: [call("list_audio_tracks", {})] };
  }
  return {
    text: "I can propose a move, a split at the playhead, a lift-delete, or a nudge. I have not analyzed audio. Nothing was changed.",
    toolCalls: [],
  };
}

export function createMockProvider(): AIProvider {
  return {
    id: "mock",
    async *complete(request: ProviderRequest): AsyncIterable<ProviderEvent> {
      const intent = mockIntent(request.messages);
      yield { type: "delta", text: intent.text };
      yield { type: "done", text: intent.text, toolCalls: intent.toolCalls };
    },
  };
}
