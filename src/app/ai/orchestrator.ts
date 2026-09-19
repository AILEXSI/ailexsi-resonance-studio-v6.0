import { createId } from "../../core/ids";
import {
  isProviderError,
  normalizeProviderError,
  type AIProvider,
  type ChatMessage,
  type ChatResponse,
  type ProviderError,
} from "./providers/types";

/**
 * Mutable request gate. A newer submit overwrites `latestRequestId`
 * so in-flight replies for older ids are ignored.
 */
export interface Orchestrator {
  latestRequestId: string | null;
  inflight: boolean;
}

export function createOrchestrator(): Orchestrator {
  return { latestRequestId: null, inflight: false };
}

export type ChatOutcome =
  | { kind: "ok"; response: ChatResponse }
  | { kind: "stale"; requestId: string }
  | { kind: "error"; error: ProviderError };

/**
 * Director → provider abstraction. Tracks requestId and drops stale replies.
 * Never writes Session.project.
 */
export async function orchestrateChat(
  provider: AIProvider,
  messages: ChatMessage[],
  orch: Orchestrator,
  signal?: AbortSignal,
): Promise<ChatOutcome> {
  const requestId = createId("req");
  orch.latestRequestId = requestId;
  orch.inflight = true;
  try {
    const response = await provider.chat({ requestId, messages, signal });
    if (orch.latestRequestId !== requestId || response.requestId !== requestId) {
      return { kind: "stale", requestId };
    }
    return { kind: "ok", response };
  } catch (err) {
    const error = isProviderError(err) ? err : normalizeProviderError(err, requestId);
    if (orch.latestRequestId !== requestId) {
      return { kind: "stale", requestId };
    }
    return { kind: "error", error };
  } finally {
    if (orch.latestRequestId === requestId) orch.inflight = false;
  }
}

export function isStaleRequest(orch: Orchestrator, requestId: string): boolean {
  return orch.latestRequestId !== requestId;
}
