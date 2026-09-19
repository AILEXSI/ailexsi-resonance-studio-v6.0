/**
 * Director host. Wires the UI to Resonance-owned AI runtime.
 * Does not import provider SDKs into core. Does not mutate Session.project.
 */
import {
  appendDirectorMessage,
  createDirectorConversation,
  mockDirectorReply,
  type DirectorConversation,
} from "./conversation";
import { createOrchestrator, orchestrateChat, type Orchestrator } from "./orchestrator";
import { createMockProvider } from "./providers/mock";
import type { AIProvider } from "./providers/types";

export type DirectorConnectionStatus =
  | "offline"
  | "not-configured"
  | "connecting"
  | "connected"
  | "unavailable"
  | "error";

export interface DirectorHostState {
  conversation: DirectorConversation;
  panelOpen: boolean;
  status: DirectorConnectionStatus;
  statusLabel: string;
  providerLabel: string;
  modeLabel: string;
  contextLabel: string;
  transactionLabel: string;
}

export function createDirectorHostState(): DirectorHostState {
  return {
    conversation: createDirectorConversation(),
    panelOpen: true,
    status: "offline",
    statusLabel: "Offline — mock conversation",
    providerLabel: "Provider: mock",
    modeLabel: "Mode: —",
    contextLabel: "Context: —",
    transactionLabel: "Transaction: —",
  };
}

export function toggleDirectorPanel(state: DirectorHostState): DirectorHostState {
  return { ...state, panelOpen: !state.panelOpen };
}

export function setDirectorPanelOpen(state: DirectorHostState, open: boolean): DirectorHostState {
  return { ...state, panelOpen: open };
}

/**
 * In-memory mock turn (AI-1). No fetch, no tools, no Session/Project writes.
 */
export function submitDirectorMockTurn(state: DirectorHostState, userText: string): DirectorHostState {
  const text = userText.trim();
  if (!text) return state;
  let next = {
    ...state,
    conversation: appendDirectorMessage(state.conversation, "user", text),
  };
  next = {
    ...next,
    conversation: appendDirectorMessage(next.conversation, "assistant", mockDirectorReply(text)),
  };
  return next;
}

export function createDirectorRuntime(provider: AIProvider = createMockProvider()): {
  provider: AIProvider;
  orchestrator: Orchestrator;
} {
  return { provider, orchestrator: createOrchestrator() };
}

/**
 * Director → abstraction → provider. Appends the user line first; only applies
 * the assistant line when the outcome is current (not stale).
 */
export async function submitDirectorProviderTurn(
  state: DirectorHostState,
  userText: string,
  runtime: { provider: AIProvider; orchestrator: Orchestrator },
  signal?: AbortSignal,
): Promise<DirectorHostState> {
  const text = userText.trim();
  if (!text) return state;
  const withUser: DirectorHostState = {
    ...state,
    conversation: appendDirectorMessage(state.conversation, "user", text),
    status: "connecting",
    statusLabel: "Sending…",
  };
  const messages = withUser.conversation.messages.map((m) => ({
    role: m.role,
    content: m.text,
  }));
  const outcome = await orchestrateChat(runtime.provider, messages, runtime.orchestrator, signal);
  if (outcome.kind === "stale") return withUser;
  if (outcome.kind === "error") {
    return {
      ...withUser,
      status: "error",
      statusLabel: `Error — ${outcome.error.code}`,
      conversation: appendDirectorMessage(
        withUser.conversation,
        "assistant",
        `Provider error: ${outcome.error.code}. No project changes were made.`,
      ),
    };
  }
  return {
    ...withUser,
    status: "offline",
    statusLabel: "Offline — mock conversation",
    conversation: appendDirectorMessage(withUser.conversation, "assistant", outcome.response.text),
  };
}
