import type { AIProvider, ProviderEvent, ProviderRequest, ToolCall } from "./types";

export interface OpenAiCompatibleConfig {
  baseUrl: string;
  model: string;
  /** Runtime only. Never read from the repo, the bundle, or localStorage. */
  apiKey?: string;
  fetchImpl?: typeof fetch;
}

export type ProviderGate = { ok: true; local: boolean } | { ok: false; error: string };

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export function validateProviderTarget(config: OpenAiCompatibleConfig): ProviderGate {
  const model = config.model.trim();
  if (!model) return { ok: false, error: "Model name required. Nothing was sent." };
  let url: URL;
  try {
    url = new URL(config.baseUrl.trim());
  } catch {
    return { ok: false, error: "Invalid base URL. Nothing was sent." };
  }
  const local = LOCAL_HOSTS.has(url.hostname);
  if (local && url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: "Local providers need http or https. Nothing was sent." };
  }
  if (!local && url.protocol !== "https:") {
    return { ok: false, error: "Cloud providers need https. Nothing was sent." };
  }
  if (!local && !config.apiKey?.trim()) {
    return { ok: false, error: "Cloud providers need a key supplied at runtime. Nothing was sent." };
  }
  return { ok: true, local };
}

function chatUrl(baseUrl: string): string {
  const url = new URL(baseUrl.trim());
  const path = url.pathname.replace(/\/$/, "");
  url.pathname = `${path}/chat/completions`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

interface ToolAcc {
  id?: string;
  name?: string;
  arguments: string;
}

function consumeDelta(acc: Map<number, ToolAcc>, delta: unknown): string {
  if (!delta || typeof delta !== "object") return "";
  const record = delta as {
    content?: unknown;
    tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[];
  };
  const text = typeof record.content === "string" ? record.content : "";
  for (const call of record.tool_calls ?? []) {
    const index = typeof call.index === "number" ? call.index : acc.size;
    const row = acc.get(index) ?? { arguments: "" };
    if (typeof call.id === "string" && call.id) row.id = call.id;
    if (typeof call.function?.name === "string") row.name = `${row.name ?? ""}${call.function.name}`;
    if (typeof call.function?.arguments === "string") row.arguments += call.function.arguments;
    acc.set(index, row);
  }
  return text;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function argumentsOf(value: unknown): unknown | undefined {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
}

function callFromRecord(value: unknown, allowed: ReadonlySet<string>): ToolCall | null {
  const record = asRecord(value);
  if (!record) return null;
  const nested = asRecord(record.function);
  const nameValue = nested?.name ?? record.name;
  if (typeof nameValue !== "string" || !allowed.has(nameValue)) return null;
  const argsValue = nested && "arguments" in nested ? nested.arguments : record.arguments;
  const args = argsValue === undefined ? {} : argumentsOf(argsValue);
  if (args === undefined) return null;
  const id = typeof record.id === "string" && record.id ? record.id : nameValue;
  return { id, name: nameValue, arguments: args };
}

function callsFromJson(value: unknown, allowed: ReadonlySet<string>): ToolCall[] {
  const items = Array.isArray(value) ? value : [value];
  const calls: ToolCall[] = [];
  for (const item of items) {
    const call = callFromRecord(item, allowed);
    if (call) calls.push(call);
  }
  return calls;
}

function candidateChunks(text: string): string[] {
  const chunks: string[] = [];
  const fence = /```(?:json)?\s*([\s\S]*?)```/gi;
  const tag = /<tool_call>\s*([\s\S]*?)<\/tool_call>/gi;
  for (const match of text.matchAll(fence)) {
    if (match[1]?.trim()) chunks.push(match[1].trim());
  }
  for (const match of text.matchAll(tag)) {
    if (match[1]?.trim()) chunks.push(match[1].trim());
  }
  if (chunks.length === 0 && text.trim()) chunks.push(text.trim());
  return chunks;
}

/**
 * Some local models print tool calls as JSON text instead of `tool_calls`.
 * Only names in `allowed` are kept. Malformed arguments are dropped.
 */
export function parseTextToolCalls(text: string, allowed: readonly string[]): ToolCall[] {
  const names = new Set(allowed);
  const calls: ToolCall[] = [];
  const seen = new Set<string>();
  for (const chunk of candidateChunks(text)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(chunk) as unknown;
    } catch {
      continue;
    }
    for (const call of callsFromJson(parsed, names)) {
      const key = `${call.name}:${JSON.stringify(call.arguments)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      calls.push(call);
    }
  }
  return calls;
}

export function toolCallsFromAccumulators(acc: Map<number, ToolAcc>): ToolCall[] {
  const calls: ToolCall[] = [];
  for (const row of acc.values()) {
    if (!row.name) continue;
    let args: unknown = {};
    if (row.arguments.trim()) {
      try {
        args = JSON.parse(row.arguments) as unknown;
      } catch {
        continue;
      }
    }
    calls.push({ id: row.id ?? row.name, name: row.name, arguments: args });
  }
  return calls;
}

/** Parse one SSE body. Malformed JSON lines are ignored. */
export async function* readSseJson(body: ReadableStream<Uint8Array>): AsyncGenerator<unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") return;
      try {
        yield JSON.parse(data) as unknown;
      } catch {
        /* ignore a partial or non-JSON keep-alive */
      }
    }
  }
}

const SYSTEM = [
  "You are an untrusted assistant for Resonance Studio.",
  "You cannot hear audio. Beat markers come only from the audio.detect_beats tool, which measures the selected clip.",
  "Do not invent a tempo or beat times.",
  "Lyric scene ideas come only from lyrics.suggest_scenes. That tool stays on this machine and does not place scenes.",
  "The structure context includes project, track, and marker names, plus ids and times.",
  "It does not include file paths, media bytes, or waveforms.",
  "Propose at most one edit. The human accepts or rejects it.",
  "timeline.trim, timeline.ripple_delete, and timeline.add_fade only propose an edit. Accept applies one undo step.",
  "Use the tool interface for tool calls. Do not print a tool call as JSON text.",
].join(" ");

export function createOpenAiCompatibleProvider(config: OpenAiCompatibleConfig): AIProvider {
  return {
    id: "openai-compatible",
    async *complete(request: ProviderRequest): AsyncIterable<ProviderEvent> {
      const gate = validateProviderTarget(config);
      if (!gate.ok) {
        yield { type: "error", message: gate.error };
        return;
      }
      const fetchImpl = config.fetchImpl ?? fetch;
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      const key = config.apiKey?.trim();
      if (key) headers.Authorization = `Bearer ${key}`;
      const messages = [
        { role: "system", content: SYSTEM },
        ...(request.context ? [{ role: "system", content: JSON.stringify(request.context) }] : []),
        ...request.messages.map((message) => ({
          role: message.role,
          content: message.content,
          tool_call_id: message.toolCallId,
        })),
      ];
      let response: Response;
      try {
        response = await fetchImpl(chatUrl(config.baseUrl), {
          method: "POST",
          headers,
          body: JSON.stringify({
            model: config.model.trim(),
            stream: true,
            messages,
            tools: request.tools.map((tool) => ({
              type: "function",
              function: { name: tool.name, description: tool.description, parameters: { type: "object" } },
            })),
          }),
          redirect: "error",
          signal: request.signal,
        });
      } catch {
        yield { type: "error", message: "Provider request failed. Nothing was changed." };
        return;
      }
      if (!response.ok || !response.body) {
        yield { type: "error", message: `Provider status ${response.status}. Nothing was changed.` };
        return;
      }
      const acc = new Map<number, ToolAcc>();
      let text = "";
      try {
        for await (const chunk of readSseJson(response.body)) {
          const choice = (chunk as { choices?: { delta?: unknown }[] }).choices?.[0];
          const delta = consumeDelta(acc, choice?.delta);
          if (delta) {
            text += delta;
            yield { type: "delta", text: delta };
          }
        }
      } catch {
        yield { type: "error", message: "Provider stream failed. Nothing was changed." };
        return;
      }
      const structured = toolCallsFromAccumulators(acc);
      const toolCalls =
        structured.length > 0 ? structured : parseTextToolCalls(text, request.tools.map((tool) => tool.name));
      yield { type: "done", text, toolCalls };
    },
  };
}
