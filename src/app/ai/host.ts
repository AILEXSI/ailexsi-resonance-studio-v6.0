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
import type { AIProvider, ChatMessage, ProviderId } from "./providers/types";
import { loadAiPrefs, saveAiPrefs, type DirectorAiPrefs } from "./providers/prefs";
import { captureContextSnapshot } from "./context/snapshot";
import type { AIContextSnapshot, ContextLevel, OutboundClass } from "./context/types";
import type { Session } from "../session";
import { DIRECTOR_MODES, GRANTS, type DirectorMode, type Grant } from "./permissions/policy";
import {
  applyCommandTransaction,
  rejectTransaction,
  type AITransaction,
} from "./transactions/transaction";
import { draftMoveClip, type MoveClipArgs } from "./tools/move-clip";
import {
  DIRECTOR_MUTATING_TOOL,
  DIRECTOR_RESPONSE_CONTRACT_PROMPT,
  isKnownMutatingTool,
  parseDirectorResponse,
  type DirectorToolRequest,
} from "./contract";

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
  /** Last Apply/Reject gate code for Director UI. Runtime only — not Project. */
  lastGateCode: string | null;
  lastGateMessage: string | null;
}

export function createDirectorHostState(): DirectorHostState {
  return {
    conversation: createDirectorConversation(),
    panelOpen: true,
    status: "offline",
    statusLabel: "Offline — mock conversation",
    providerLabel: providerLabelOf("mock"),
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
    lastGateCode: null,
    lastGateMessage: null,
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
        lastGateCode: result.code,
        lastGateMessage: result.message,
        conversation: appendDirectorMessage(
          state.conversation,
          "assistant",
          result.code === "TRANSACTION_CONFLICT"
            ? `STALE TRANSACTION — CONFLICT. ${result.message}. The project changed after this preview. Apply is blocked. Manual edit is intact. Reject this stale draft. Undo / Redo still walk project history and do not revive this preview. No project changes were made.`
            : `${result.code}: ${result.message}. Manual edit is intact. No project changes were made.`,
        ),
      },
      session,
    };
  }
  return {
    state: {
      ...applyHostTransaction(state, result.transaction),
      lastGateCode: null,
      lastGateMessage: null,
      conversation: appendDirectorMessage(
        state.conversation,
        "assistant",
        `Applied ${result.transaction.toolName}. Use Undo / Redo in Director or Transport to reverse or restore this move.`,
      ),
    },
    session: result.session,
  };
}

export function rejectHostTransaction(state: DirectorHostState): DirectorHostState {
  if (!state.transaction) return state;
  const rejected = applyHostTransaction(state, rejectTransaction(state.transaction));
  return {
    ...rejected,
    lastGateCode: null,
    lastGateMessage: null,
    conversation: appendDirectorMessage(
      rejected.conversation,
      "assistant",
      "REJECTED. Preview discarded. Clip was not moved. No history entry. No project changes were made.",
    ),
  };
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

export function providerLabelOf(providerId: ProviderId): string {
  return providerId === "openai-compatible"
    ? "Provider: local-openai-compatible"
    : "Provider: mock (offline, not an LLM)";
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
    providerLabel: providerLabelOf(state.providerId),
  };
}

export function applyProviderId(state: DirectorHostState, providerId: ProviderId): DirectorHostState {
  if (providerId === "openai-compatible") {
    return {
      ...state,
      providerId,
      status: isConfigured(state.localConfig) ? state.status : "not-configured",
      statusLabel: statusLabel(connectionStatusOf(state.localConfig, null)),
      providerLabel: providerLabelOf("openai-compatible"),
    };
  }
  return {
    ...state,
    providerId: "mock",
    status: "offline",
    statusLabel: "Offline — mock conversation",
    providerLabel: providerLabelOf("mock"),
  };
}

function browserPrefsStorage(): {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
} | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

/** Application prefs only. Never Project / schema / apiKey. */
export function persistDirectorHostPrefs(
  state: DirectorHostState,
  storage: { setItem(key: string, value: string): void } | null = browserPrefsStorage(),
): void {
  const prefs: DirectorAiPrefs = {
    providerId: state.providerId === "openai-compatible" ? "openai-compatible" : "mock",
    baseUrl: state.localConfig.baseUrl,
    model: state.localConfig.model,
  };
  saveAiPrefs(storage, prefs);
}

/** Hydrate provider URL/model. Does not test connection or fetch. */
export function hydrateDirectorHostFromPrefs(
  storage: { getItem(key: string): string | null } | null = browserPrefsStorage(),
  base: DirectorHostState = createDirectorHostState(),
): DirectorHostState {
  const prefs = loadAiPrefs(storage);
  return applyLocalConfig(applyProviderId(base, prefs.providerId), {
    baseUrl: prefs.baseUrl,
    model: prefs.model,
  });
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
      providerLabel: providerLabelOf("openai-compatible"),
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

export function buildProviderMessages(state: DirectorHostState): ChatMessage[] {
  const messages: ChatMessage[] = [{ role: "system", content: DIRECTOR_RESPONSE_CONTRACT_PROMPT }];
  if (state.lastSnapshot && state.contextLevel !== "NONE") {
    messages.push({
      role: "system",
      content: JSON.stringify({
        projectId: state.lastSnapshot.projectId,
        selection: state.lastSnapshot.selection,
        structure: state.lastSnapshot.structure,
        playheadMs: state.lastSnapshot.playheadMs,
        level: state.lastSnapshot.level,
      }),
    });
  }
  for (const message of state.conversation.messages) {
    messages.push({ role: message.role, content: message.text });
  }
  return messages;
}

function asMoveClipArgs(args: Record<string, unknown>): MoveClipArgs {
  return {
    clipId: typeof args.clipId === "string" ? args.clipId : undefined,
    deltaMs: typeof args.deltaMs === "number" ? args.deltaMs : undefined,
    targetStartSeconds: typeof args.targetStartSeconds === "number" ? args.targetStartSeconds : undefined,
  };
}

function explainToolDenial(opts: {
  code: string;
  detail: string;
  grant: Grant;
  mode: DirectorMode;
  contextLevel: ContextLevel;
}): string {
  if (opts.code === "GRANT_DENIED" || opts.code === "INVALID_GRANT") {
    return `Denied: Mode ${opts.mode} + Grant ${opts.grant} cannot draft ${DIRECTOR_MUTATING_TOOL}. Set Mode AGENT and Grant EDIT. No project changes were made.`;
  }
  if (opts.detail === "No clip selected" || opts.detail === "AMBIGUOUS_SELECTION") {
    return `Denied: a single selected clip is required. ${opts.detail}. No project changes were made.`;
  }
  return `Move draft denied: ${opts.detail}. No project changes were made.`;
}

function applyAssistantStatus(state: DirectorHostState, previous: DirectorHostState): DirectorHostState {
  if (previous.providerId === "openai-compatible") {
    return {
      ...state,
      status: "connected",
      statusLabel: statusLabel("connected"),
      providerLabel: providerLabelOf("openai-compatible"),
    };
  }
  return {
    ...state,
    status: "offline",
    statusLabel: "Offline — mock conversation",
    providerLabel: providerLabelOf("mock"),
  };
}

function draftFromToolRequest(
  state: DirectorHostState,
  session: Session,
  toolRequest: DirectorToolRequest,
): DirectorHostState {
  if (!isKnownMutatingTool(toolRequest.name)) {
    return {
      ...state,
      conversation: appendDirectorMessage(
        state.conversation,
        "assistant",
        `Unknown tool '${toolRequest.name}'. No project changes were made.`,
      ),
    };
  }
  if (state.contextLevel === "NONE") {
    return {
      ...state,
      conversation: appendDirectorMessage(
        state.conversation,
        "assistant",
        "Denied: Context SELECTION is required to move a clip. No project changes were made.",
      ),
    };
  }
  const drafted = draftMoveClip({
    session,
    args: asMoveClipArgs(toolRequest.arguments),
    grant: state.grant,
    mode: state.mode,
  });
  if (!drafted.ok) {
    return {
      ...state,
      transactionLabel: `Transaction: ${drafted.code}`,
      conversation: appendDirectorMessage(
        state.conversation,
        "assistant",
        explainToolDenial({
          code: drafted.code,
          detail: drafted.message,
          grant: state.grant,
          mode: state.mode,
          contextLevel: state.contextLevel,
        }),
      ),
    };
  }
  return applyHostTransaction(state, drafted.transaction);
}

/**
 * Director → provider → structured parse → optional draft.
 * Free-form text never mutates. Tool request alone never applies.
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
  const boundProjectId = session?.project.id ?? null;
  const base = attachSubmitSnapshot(state, session);
  const withUser: DirectorHostState = applyHostTransaction(
    {
      ...base,
      conversation: appendDirectorMessage(base.conversation, "user", text),
      status: "connecting",
      statusLabel: "Sending…",
      lastGateCode: null,
      lastGateMessage: null,
    },
    null,
  );
  const outcome = await orchestrateChat(
    runtime.provider,
    buildProviderMessages(withUser),
    runtime.orchestrator,
    signal,
  );
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
  if (signal?.aborted) return withUser;
  if (boundProjectId && session && session.project.id !== boundProjectId) {
    return {
      ...withUser,
      conversation: appendDirectorMessage(
        withUser.conversation,
        "assistant",
        "Ignored late reply after project switch. No project changes were made.",
      ),
    };
  }
  const parsed = parseDirectorResponse(outcome.response.text);
  if (!parsed.ok) {
    return applyAssistantStatus(
      {
        ...withUser,
        conversation: appendDirectorMessage(
          withUser.conversation,
          "assistant",
          `Invalid provider response: ${parsed.message}. No project changes were made.`,
        ),
      },
      state,
    );
  }
  let next = applyAssistantStatus(
    {
      ...withUser,
      conversation: appendDirectorMessage(withUser.conversation, "assistant", parsed.message),
    },
    state,
  );
  if (!parsed.toolRequest) return next;
  if (!session) {
    return {
      ...next,
      conversation: appendDirectorMessage(
        next.conversation,
        "assistant",
        "Denied: no project session is available. No project changes were made.",
      ),
    };
  }
  next = draftFromToolRequest(next, session, parsed.toolRequest);
  return next;
}
