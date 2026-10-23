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
  "You cannot hear or analyze audio.",
  "Use only the ids and times in the structure context.",
  "Do not ask for file bytes, paths, or waveforms.",
  "Propose at most one edit. The human accepts or rejects it.",
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
      yield { type: "done", text, toolCalls: toolCallsFromAccumulators(acc) };
    },
  };
}
