import type { SendContext } from "../context";

export interface ToolCall {
  id: string;
  name: string;
  arguments: unknown;
}

export interface ProviderMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
}

export interface ProviderToolSpec {
  name: string;
  description: string;
}

export interface ProviderRequest {
  messages: ProviderMessage[];
  tools: readonly ProviderToolSpec[];
  /** Null means SEND_NONE. The mock always receives null. */
  context: SendContext | null;
  signal?: AbortSignal;
}

export type ProviderEvent =
  | { type: "delta"; text: string }
  | { type: "done"; text: string; toolCalls: ToolCall[] }
  | { type: "error"; message: string };

export interface AIProvider {
  id: string;
  complete(request: ProviderRequest): AsyncIterable<ProviderEvent>;
}
