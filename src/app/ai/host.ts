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
import {
  connectionStatusOf,
  createOpenAICompatibleProvider,
  isConfigured,
  statusLabel,
  type OpenAICompatibleConfig,
} from "./providers/openai-compatible";
import type { AIProvider, ProviderId } from "./providers/types";

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
  providerId: ProviderId;
  localConfig: OpenAICompatibleConfig;
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
    providerId: "mock",
    localConfig: { baseUrl: "", model: "" },
  };
}

export function providerForHost(state: DirectorHostState): AIProvider {
  if (state.providerId === "openai-compatible") {
    return createOpenAICompatibleProvider(state.localConfig);
  }
  return createMockProvider();
}

export function applyLocalConfig(
  state: DirectorHostState,
  patch: Partial<OpenAICompatibleConfig>,
): DirectorHostState {
  const localConfig = { ...state.localConfig, ...patch };
  const configured = isConfigured(localConfig);
  return {
    ...state,
    localConfig,
    providerId: state.providerId,
    status: configured ? state.status : "not-configured",
    statusLabel:
      state.providerId === "openai-compatible"
        ? statusLabel(connectionStatusOf(localConfig, null))
        : state.statusLabel,
    providerLabel:
      state.providerId === "openai-compatible" ? "Provider: openai-compatible" : "Provider: mock",
  };
}

export function applyProviderId(state: DirectorHostState, providerId: ProviderId): DirectorHostState {
  if (providerId === "openai-compatible") {
    return {
      ...state,
      providerId,
      status: "not-configured",
      statusLabel: statusLabel(connectionStatusOf(state.localConfig, null)),
      providerLabel: "Provider: openai-compatible",
    };
  }
  return {
    ...state,
    providerId: "mock",
    status: "offline",
    statusLabel: "Offline — mock conversation",
    providerLabel: "Provider: mock",
  };
}

export async function testDirectorConnection(state: DirectorHostState): Promise<DirectorHostState> {
  if (state.providerId !== "openai-compatible") return state;
  const connecting: DirectorHostState = {
    ...state,
    status: "connecting",
    statusLabel: statusLabel("connecting"),
    providerLabel: "Provider: openai-compatible",
  };
  const provider = createOpenAICompatibleProvider(state.localConfig);
  const result = await provider.testConnection();
  if (result.ok) {
    return {
      ...connecting,
      status: "connected",
      statusLabel: statusLabel("connected"),
    };
  }
  const code = result.error?.code;
  const local = connectionStatusOf(state.localConfig, { ok: false, code });
  return {
    ...connecting,
    status: local === "unavailable" ? "unavailable" : "error",
    statusLabel: statusLabel(local === "not-configured" ? "error" : local),
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

export function createDirectorRuntime(provider?: AIProvider, state?: DirectorHostState): {
  provider: AIProvider;
  orchestrator: Orchestrator;
} {
  return {
    provider: provider ?? (state ? providerForHost(state) : createMockProvider()),
    orchestrator: createOrchestrator(),
  };
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
    status: state.providerId === "openai-compatible" ? "connected" : "offline",
    statusLabel:
      state.providerId === "openai-compatible"
        ? statusLabel("connected")
        : "Offline — mock conversation",
    conversation: appendDirectorMessage(withUser.conversation, "assistant", outcome.response.text),
  };
}
