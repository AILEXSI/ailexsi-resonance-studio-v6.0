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
    providerLabel: "Provider: not configured",
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
 * In-memory mock turn. No fetch, no tools, no Session/Project writes.
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
