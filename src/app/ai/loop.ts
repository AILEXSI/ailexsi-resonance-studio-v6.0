import type { Session } from "../session";
import { buildSendContext, redactSensitiveText } from "./context";
import { dispatchTool } from "./orchestrator";
import { createMockProvider } from "./providers/mock";
import type { AIProvider, ProviderMessage, ProviderToolSpec, ToolCall } from "./providers/types";
import { isMutationToolName } from "./tools/mutate";
import type { AITransaction } from "./transactions";

export const DIRECTOR_TOOL_SPECS: readonly ProviderToolSpec[] = [
  { name: "get_project_summary", description: "Counts, duration, snap, and playhead. No names or paths." },
  { name: "get_selection", description: "Selected clip ids and track ids." },
  { name: "get_playhead", description: "Playhead time in milliseconds." },
  { name: "get_clips_on_track", description: "Clips on one track id. Display names are rejected." },
  { name: "get_markers", description: "Marker ids and times. Not an audio analysis." },
  { name: "list_audio_tracks", description: "Audio track ids. Labels are not ids." },
  { name: "timeline.move_clip", description: "Propose an exact move in milliseconds. Does not snap." },
  { name: "timeline.split_at_playhead", description: "Propose a split at the current playhead." },
  { name: "timeline.lift_delete", description: "Propose a lift-delete of the current selection." },
  { name: "timeline.nudge", description: "Propose a nudge. Snap may change the delta." },
  {
    name: "timeline.split_at_markers",
    description: "Propose splits at existing marker times inside the one selected clip. Does not analyze audio.",
  },
];

export interface DirectorTurn {
  text: string;
  transaction: AITransaction | null;
}

const MAX_ROUNDS = 4;

/**
 * Tool loop. Reads may run. A mutation becomes one proposal and stops.
 * The live session is not mutated here.
 */
export async function runDirectorTurn(opts: {
  session: Session;
  prompt: string;
  provider?: AIProvider;
  signal?: AbortSignal;
  onDelta?: (text: string) => void;
}): Promise<DirectorTurn> {
  const provider = opts.provider ?? createMockProvider();
  const messages: ProviderMessage[] = [{ role: "user", content: opts.prompt }];
  let text = "";
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    if (opts.signal?.aborted) return { text: "Cancelled. Nothing was changed.", transaction: null };
    const outcome = await collect(provider, messages, opts);
    if (outcome.error) return { text: outcome.error, transaction: null };
    text = outcome.text || text;
    const mutations = outcome.toolCalls.filter((call) => isMutationToolName(call.name));
    const reads = outcome.toolCalls.filter((call) => !isMutationToolName(call.name));
    if (mutations.length > 1 || (mutations.length === 1 && reads.length > 0)) {
      return { text: "One edit per proposal. Nothing was changed.", transaction: null };
    }
    if (mutations.length === 1) {
      const call = mutations[0]!;
      const dispatched = dispatchTool(opts.session, call.name, call.arguments, opts.prompt);
      if (dispatched.kind === "proposal") {
        return { text: dispatched.transaction.summary, transaction: dispatched.transaction };
      }
      const error = dispatched.kind === "error" ? dispatched.error : "Nothing was changed.";
      return { text: `${error} Nothing was changed.`, transaction: null };
    }
    if (reads.length === 0) return { text: text || "Nothing was changed.", transaction: null };
    messages.push({ role: "assistant", content: text, toolCalls: outcome.toolCalls });
    for (const call of reads) {
      messages.push({ role: "tool", content: toolContent(opts.session, call, opts.prompt), toolCallId: call.id });
    }
  }
  return { text: "Stopped. Nothing was changed.", transaction: null };
}

function toolContent(session: Session, call: ToolCall, prompt: string): string {
  const dispatched = dispatchTool(session, call.name, call.arguments, prompt);
  const raw =
    dispatched.kind === "read"
      ? JSON.stringify(dispatched.result)
      : JSON.stringify({
          ok: false,
          error: dispatched.kind === "error" ? dispatched.error : "Unsupported tool",
        });
  return redactSensitiveText(raw);
}

async function collect(
  provider: AIProvider,
  messages: ProviderMessage[],
  opts: { session: Session; signal?: AbortSignal; onDelta?: (text: string) => void },
): Promise<{ text: string; toolCalls: ToolCall[]; error?: string }> {
  let text = "";
  let toolCalls: ToolCall[] = [];
  const context = provider.id === "mock" ? null : buildSendContext(opts.session);
  for await (const event of provider.complete({
    messages,
    tools: DIRECTOR_TOOL_SPECS,
    context,
    signal: opts.signal,
  })) {
    if (event.type === "delta") {
      text += event.text;
      opts.onDelta?.(event.text);
    } else if (event.type === "done") {
      if (event.text) text = event.text;
      toolCalls = event.toolCalls;
    } else {
      return { text, toolCalls, error: event.message };
    }
  }
  return { text, toolCalls };
}
