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
import { captureContextSnapshot } from "./context/snapshot";
import type { AIContextSnapshot, ContextLevel, OutboundClass } from "./context/types";
import type { Session } from "../session";
import { DIRECTOR_MODES, GRANTS, type DirectorMode, type Grant } from "./permissions/policy";
import {
  applyCommandTransaction,
  rejectTransaction,
  type AITransaction,
} from "./transactions/transaction";
import { draftMoveClip, parseGoldenMovePrompt } from "./tools/move-clip";

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
  contextLevel: ContextLevel;
  outboundClass: OutboundClass;
  lastSnapshot: AIContextSnapshot | null;
  grant: Grant;
  mode: DirectorMode;
  transaction: AITransaction | null;
}

export function createDirectorHostState(): DirectorHostState {
  return {
    conversation: createDirectorConversation(),
    panelOpen: true,
    status: "offline",
    statusLabel: "Offline — mock conversation",
    providerLabel: "Provider: mock",
    contextLabel: "Context: NONE",
    transactionLabel: "Transaction: —",
    providerId: "mock",
    localConfig: { baseUrl: "", model: "" },
    contextLevel: "NONE",
    outboundClass: "SEND_STRUCTURE",
    lastSnapshot: null,
    grant: "READ",
    mode: "ASK",
    modeLabel: "Mode: ASK",
    transaction: null,
  };
}

export function applyGrant(state: DirectorHostState, grant: Grant): DirectorHostState {
  return { ...state, grant };
}

export function applyMode(state: DirectorHostState, mode: DirectorMode): DirectorHostState {
  return { ...state, mode, modeLabel: `Mode: ${mode}` };
}

export function applyHostTransaction(state: DirectorHostState, transaction: AITransaction | null): DirectorHostState {
  return {
    ...state,
    transaction,
    transactionLabel: transaction
      ? `Transaction: ${transaction.status} ${transaction.toolName}`
      : "Transaction: —",
  };
}

export function applyHostApproved(
  state: DirectorHostState,
  session: Session,
): { state: DirectorHostState; session: Session } {
  if (!state.transaction) return { state, session };
  const result = applyCommandTransaction({
    session,
    transaction: state.transaction,
    grant: state.grant,
    mode: state.mode,
    approval: true,
  });
  if (!result.ok) {
    return {
      state: {
        ...state,
        status: "error",
        statusLabel: `Error — ${result.code}`,
        transactionLabel: `Transaction: ${result.code}`,
      },
      session,
    };
  }
  return {
    state: applyHostTransaction(state, result.transaction),
    session: result.session,
  };
}

export function rejectHostTransaction(state: DirectorHostState): DirectorHostState {
  if (!state.transaction) return state;
  return applyHostTransaction(state, rejectTransaction(state.transaction));
}

export { DIRECTOR_MODES, GRANTS };

export function applyContextLevel(state: DirectorHostState, level: ContextLevel): DirectorHostState {
  return { ...state, contextLevel: level, contextLabel: `Context: ${level}` };
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
export function attachSubmitSnapshot(state: DirectorHostState, session?: Session): DirectorHostState {
  if (!session) return state;
  const lastSnapshot = captureContextSnapshot(session, {
    level: state.contextLevel,
    outboundClass: state.outboundClass,
  });
  return { ...state, lastSnapshot, contextLabel: `Context: ${lastSnapshot.level}` };
}

export function submitDirectorMockTurn(
  state: DirectorHostState,
  userText: string,
  session?: Session,
): DirectorHostState {
  const text = userText.trim();
  if (!text) return state;
  const base = attachSubmitSnapshot(state, session);
  let next = {
    ...base,
    conversation: appendDirectorMessage(base.conversation, "user", text),
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
  session?: Session,
): Promise<DirectorHostState> {
  const text = userText.trim();
  if (!text) return state;
  const base = attachSubmitSnapshot(state, session);
  let withUser: DirectorHostState = {
    ...base,
    conversation: appendDirectorMessage(base.conversation, "user", text),
    status: "connecting",
    statusLabel: "Sending…",
  };
  if (session && parseGoldenMovePrompt(text)) {
    const drafted = draftMoveClip({
      session,
      args: { deltaMs: 2000 },
      grant: state.grant,
      mode: state.mode,
    });
    if (drafted.ok) {
      withUser = applyHostTransaction(withUser, drafted.transaction);
    } else {
      withUser = {
        ...withUser,
        transactionLabel: `Transaction: ${drafted.code}`,
        conversation: appendDirectorMessage(
          withUser.conversation,
          "assistant",
          `Move draft denied: ${drafted.message}. No project changes were made.`,
        ),
      };
    }
  }
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
