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
import { probeLoopbackOpenAiCompatible } from "./providers/local-discovery";
import {
  clampChatTimeoutMs,
  connectionStatusOf,
  createOpenAICompatibleProvider,
  DEFAULT_CHAT_TIMEOUT_MS,
  isConfigured,
  statusLabel,
  type OpenAICompatibleConfig,
} from "./providers/openai-compatible";
import type {
  AIProvider,
  ChatMessage,
  ConnectionFailureCategory,
  LocalHttpTransport,
  ProviderId,
  ProviderModel,
} from "./providers/types";
import { loadAiPrefs, saveAiPrefs, type DirectorAiPrefs } from "./providers/prefs";
import { captureContextSnapshot } from "./context/snapshot";
import type { AIContextSnapshot, ContextLevel, OutboundClass } from "./context/types";
import { selectionOf, type Session } from "../session";
import { DIRECTOR_MODES, GRANTS, grantExceeds, type DirectorMode, type Grant } from "./permissions/policy";
import {
  applyCommandTransaction,
  rejectTransaction,
  type AITransaction,
} from "./transactions/transaction";
import { draftMoveClip, type MoveClipArgs } from "./tools/move-clip";
import { invokeTool, listTools } from "./tools/registry";
import {
  DIRECTOR_MUTATING_TOOL,
  DIRECTOR_RESPONSE_CONTRACT_PROMPT,
  isKnownMutatingTool,
  parseDirectorResponse,
  type DirectorToolRequest,
} from "./contract";
import {
  clearDiscoveryCache,
  pickAutoModel,
  planDirectorTurn,
  resolveAutoRuntime,
  writeDiscoveryCache,
  type DirectorPlan,
} from "./orchestration";

export type DirectorConnectionStatus =
  | "offline"
  | "not-configured"
  | "connecting"
  | "connected"
  | "unavailable"
  | "error";

export interface DirectorConnectionProbe {
  phase: "idle" | "testing" | "connected" | "failed";
  label: string;
  endpoint?: string;
  model?: string;
  latencyMs?: number;
  category?: ConnectionFailureCategory;
  reason?: string;
  transport?: LocalHttpTransport;
}

export function idleConnectionProbe(): DirectorConnectionProbe {
  return { phase: "idle", label: "" };
}

export interface DirectorAuthRequest {
  requiredGrant: Grant;
  currentGrant: Grant;
  reason: string;
  userText: string;
}

export interface DirectorNoToolResult {
  code: "NO_TOOL";
  message: string;
  requested?: string;
}

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
  /** Setup probe. Runtime only — not Project. */
  connectionProbe: DirectorConnectionProbe;
  discoveredModels: ProviderModel[];
  /** Normal compact chrome vs Advanced manual controls. Runtime only. */
  surface: "normal" | "advanced";
  lastPlan: DirectorPlan | null;
  pendingAuth: DirectorAuthRequest | null;
  /** One-request grant. Not Project. Cleared after Apply/Reject. */
  onceGrant: Grant | null;
  heldUserText: string | null;
  localUnavailable: boolean;
  lastNoTool: DirectorNoToolResult | null;
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
    connectionProbe: idleConnectionProbe(),
    discoveredModels: [],
    surface: "normal",
    lastPlan: null,
    pendingAuth: null,
    onceGrant: null,
    heldUserText: null,
    localUnavailable: false,
    lastNoTool: null,
  };
}

/** Session grant, or Allow-once elevation for this request only. */
export function effectiveGrant(state: DirectorHostState): Grant {
  return state.onceGrant ?? state.grant;
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
    grant: effectiveGrant(state),
    mode: state.mode,
    approval: true,
  });
  if (!result.ok) {
    return {
      state: {
        ...state,
        onceGrant: null,
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
      onceGrant: null,
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
    onceGrant: null,
    lastGateCode: null,
    lastGateMessage: null,
    conversation: appendDirectorMessage(
      rejected.conversation,
      "assistant",
      "REJECTED. Preview discarded. Clip was not moved. No history entry. No project changes were made.",
    ),
  };
}

export { DIRECTOR_MODES, GRANTS, grantExceeds };

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
  if (patch.timeoutMs !== undefined) {
    localConfig.timeoutMs = clampChatTimeoutMs(patch.timeoutMs);
  }
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
    timeoutMs: state.localConfig.timeoutMs,
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
    timeoutMs: prefs.timeoutMs ?? DEFAULT_CHAT_TIMEOUT_MS,
  });
}

export function beginDirectorConnectionTest(state: DirectorHostState): DirectorHostState {
  if (state.providerId !== "openai-compatible") return state;
  return {
    ...state,
    status: "connecting",
    statusLabel: "Testing...",
    providerLabel: providerLabelOf("openai-compatible"),
    connectionProbe: { phase: "testing", label: "Testing..." },
  };
}

export function formatConnectionSuccess(result: {
  endpoint?: string;
  model?: string;
  latencyMs?: number;
}): string {
  const endpoint = result.endpoint ?? "loopback";
  const model = result.model ?? "model";
  const latency = typeof result.latencyMs === "number" ? `${result.latencyMs} ms` : "n/a";
  return `Connected (${endpoint}, ${model}, ${latency})`;
}

export function formatConnectionFailure(result: {
  endpoint?: string;
  category?: ConnectionFailureCategory;
  reason?: string;
}): string {
  const endpoint = result.endpoint ?? "loopback";
  const category = result.category ?? "UNKNOWN";
  const reason = result.reason ?? "Connection failed";
  return `CONNECTION FAILED (${endpoint}, ${reason}, category: ${category})`;
}

export async function finishDirectorConnectionTest(state: DirectorHostState): Promise<DirectorHostState> {
  if (state.providerId !== "openai-compatible") return state;
  const provider = createOpenAICompatibleProvider({
    ...state.localConfig,
    timeoutMs: clampChatTimeoutMs(state.localConfig.timeoutMs),
  });
  const result = await provider.testConnection();
  const models = result.models ?? state.discoveredModels;
  if (state.localConfig.baseUrl.trim()) {
    writeDiscoveryCache({
      baseUrl: state.localConfig.baseUrl,
      available: result.ok,
      models,
      model: result.model ?? state.localConfig.model,
    });
  }
  if (result.ok) {
    const label = formatConnectionSuccess(result);
    return {
      ...state,
      status: "connected",
      statusLabel: label,
      providerLabel: providerLabelOf("openai-compatible"),
      discoveredModels: models,
      localUnavailable: false,
      connectionProbe: {
        phase: "connected",
        label,
        endpoint: result.endpoint,
        model: result.model,
        latencyMs: result.latencyMs,
        transport: result.transport,
      },
    };
  }
  const code = result.error?.code;
  const local = connectionStatusOf(state.localConfig, { ok: false, code });
  const label = formatConnectionFailure(result);
  return {
    ...state,
    status: local === "unavailable" ? "unavailable" : "error",
    statusLabel: label,
    discoveredModels: models,
    localUnavailable: true,
    connectionProbe: {
      phase: "failed",
      label,
      endpoint: result.endpoint,
      model: result.model,
      latencyMs: result.latencyMs,
      category: result.category,
      reason: result.reason,
      transport: result.transport,
    },
  };
}

export async function testDirectorConnection(state: DirectorHostState): Promise<DirectorHostState> {
  return finishDirectorConnectionTest(beginDirectorConnectionTest(state));
}

export async function discoverDirectorModels(state: DirectorHostState): Promise<DirectorHostState> {
  if (state.providerId !== "openai-compatible") return state;
  const probing = beginDirectorConnectionTest(state);
  const next = await finishDirectorConnectionTest(probing);
  if (next.discoveredModels.length === 0 && next.connectionProbe.phase === "connected") {
    return {
      ...next,
      connectionProbe: {
        ...next.connectionProbe,
        label: `${next.connectionProbe.label} — no models listed`,
      },
    };
  }
  return next;
}

export async function findLocalAiEndpoints(state: DirectorHostState): Promise<DirectorHostState> {
  if (state.providerId !== "openai-compatible") return state;
  const testing: DirectorHostState = {
    ...state,
    status: "connecting",
    statusLabel: "Testing...",
    connectionProbe: { phase: "testing", label: "Testing..." },
  };
  const hits = await probeLoopbackOpenAiCompatible({
    fetchImpl: state.localConfig.fetchImpl,
  });
  if (hits.length === 0) {
    const label = formatConnectionFailure({
      endpoint: "127.0.0.1",
      category: "REFUSED",
      reason: "No OpenAI-compatible /v1/models on the loopback port allowlist",
    });
    return {
      ...testing,
      status: "unavailable",
      statusLabel: label,
      connectionProbe: {
        phase: "failed",
        label,
        endpoint: "http://127.0.0.1",
        category: "REFUSED",
        reason: "No OpenAI-compatible /v1/models on the loopback port allowlist",
      },
    };
  }
  const first = hits[0]!;
  const model = first.models[0]?.id ?? state.localConfig.model;
  const configured = applyLocalConfig(testing, { baseUrl: first.baseUrl, model });
  const label = formatConnectionSuccess({
    endpoint: first.endpoint,
    model,
    latencyMs: first.latencyMs,
  });
  return {
    ...configured,
    status: "connected",
    statusLabel: label,
    discoveredModels: first.models,
    connectionProbe: {
      phase: "connected",
      label,
      endpoint: first.endpoint,
      model,
      latencyMs: first.latencyMs,
    },
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
    grant: effectiveGrant(state),
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
    const category = (outcome.error as { category?: string }).category;
    const detail = category ? ` category: ${category}.` : "";
    return {
      ...withUser,
      status: "error",
      statusLabel: `Error — ${outcome.error.code}`,
      conversation: appendDirectorMessage(
        withUser.conversation,
        "assistant",
        `Provider error: ${outcome.error.code}.${detail} No project changes were made.`,
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

export function applyDirectorSurface(
  state: DirectorHostState,
  surface: "normal" | "advanced",
): DirectorHostState {
  return { ...state, surface };
}

export function applyOrchestrationPlan(state: DirectorHostState, plan: DirectorPlan): DirectorHostState {
  if (state.surface === "advanced") {
    return { ...state, lastPlan: plan, lastNoTool: null, localUnavailable: false };
  }
  return {
    ...applyContextLevel(applyMode(state, plan.mode), plan.contextLevel),
    lastPlan: plan,
    lastNoTool: null,
    localUnavailable: false,
  };
}

export function allowDirectorGrantOnce(state: DirectorHostState): DirectorHostState {
  if (!state.pendingAuth) return state;
  return {
    ...state,
    onceGrant: state.pendingAuth.requiredGrant,
    pendingAuth: null,
  };
}

export function allowDirectorGrantSession(state: DirectorHostState): DirectorHostState {
  if (!state.pendingAuth) return state;
  return {
    ...state,
    grant: state.pendingAuth.requiredGrant,
    onceGrant: null,
    pendingAuth: null,
  };
}

export function cancelDirectorAuth(state: DirectorHostState): DirectorHostState {
  if (!state.pendingAuth) return state;
  return {
    ...state,
    pendingAuth: null,
    heldUserText: null,
  };
}

export function normalStatusLabel(state: DirectorHostState): string {
  if (state.localUnavailable || state.statusLabel === "LOCAL AI UNAVAILABLE") {
    return "LOCAL AI UNAVAILABLE";
  }
  if (
    state.providerId === "openai-compatible" &&
    (state.status === "connected" || state.connectionProbe.phase === "connected")
  ) {
    return `Local AI ready · ${state.localConfig.model || "local"}`;
  }
  return state.statusLabel;
}

function formatToolPayload(result: unknown): string {
  return JSON.stringify(result);
}

function capabilityReply(): string {
  const reads = listTools().map((t) => t.name).join(", ");
  return [
    `Director can: ${reads}.`,
    `The only mutating tool is ${DIRECTOR_MUTATING_TOOL} (preview, then Apply).`,
    "No delete, cut, export, cloud, Voice, or STT.",
    "No project changes were made.",
  ].join(" ");
}

function appendTurn(
  state: DirectorHostState,
  userText: string,
  assistantText: string,
  extra: Partial<DirectorHostState> = {},
): DirectorHostState {
  const withUser = {
    ...state,
    conversation: appendDirectorMessage(state.conversation, "user", userText),
  };
  return {
    ...withUser,
    ...extra,
    conversation: appendDirectorMessage(withUser.conversation, "assistant", assistantText),
  };
}

function runReadPlan(
  state: DirectorHostState,
  plan: DirectorPlan,
  userText: string,
  session: Session | undefined,
): DirectorHostState {
  const prepared = attachSubmitSnapshot(applyOrchestrationPlan(state, plan), session);
  const grant = effectiveGrant(prepared);
  if (!session) {
    return appendTurn(prepared, userText, "Denied: no project session is available. No project changes were made.");
  }
  if (plan.toolName === "timeline.get_selection") {
    const result = invokeTool("timeline.get_selection", {}, { session, grant });
    return appendTurn(prepared, userText, formatToolPayload(result));
  }
  const selected = selectionOf(session);
  const clipId = selected.length === 1 ? selected[0] : undefined;
  if (!clipId) {
    return appendTurn(prepared, userText, "No clip selected. No project changes were made.");
  }
  const clipResult = invokeTool("timeline.get_clip", { clipId }, { session, grant });
  const analysis = invokeTool("audio.get_analysis", { clipId }, { session, grant });
  return appendTurn(prepared, userText, formatToolPayload({ clip: clipResult, analysis }));
}

/**
 * AUTO-ORCHESTRATION ≠ AUTO-AUTHORIZATION.
 * Plans intent/context/mode/capability/provider/model, then invokes the existing pipeline.
 * Never silently escalates grants. Never self-grants. Allow EDIT ≠ Apply EDIT.
 */
export async function submitDirectorAutoTurn(
  state: DirectorHostState,
  userText: string,
  runtime: { provider: AIProvider; orchestrator: Orchestrator },
  signal?: AbortSignal,
  session?: Session,
  opts?: { providerInjected?: boolean },
): Promise<DirectorHostState> {
  const text = userText.trim();
  if (!text) return state;
  const plan = planDirectorTurn(text);
  const current = effectiveGrant(state);
  if (grantExceeds(plan.requiredGrant, current)) {
    return {
      ...state,
      lastPlan: plan,
      heldUserText: text,
      pendingAuth: {
        requiredGrant: plan.requiredGrant,
        currentGrant: state.grant,
        reason: plan.intent.reason,
        userText: text,
      },
    };
  }

  const resolved = resolveAutoRuntime({
    surface: state.surface,
    providerId: state.providerId,
    localConfig: state.localConfig,
    discoveredModels: state.discoveredModels,
    probePhase: state.connectionProbe.phase,
  });
  if (resolved.unavailable && !opts?.providerInjected) {
    return {
      ...state,
      lastPlan: plan,
      localUnavailable: true,
      status: "unavailable",
      statusLabel: "LOCAL AI UNAVAILABLE",
    };
  }

  let next = applyOrchestrationPlan(state, plan);
  if (!opts?.providerInjected && resolved.providerId === "openai-compatible") {
    const model = pickAutoModel(resolved.model, next.discoveredModels) ?? resolved.model;
    if (model && model !== next.localConfig.model) {
      next = applyLocalConfig(next, { model });
    }
    if (next.providerId !== "openai-compatible") {
      next = applyProviderId(next, "openai-compatible");
    }
  }

  if (plan.intent.kind === "UNSUPPORTED") {
    const lastNoTool: DirectorNoToolResult = {
      code: "NO_TOOL",
      message: "No tool is available for this request. Director will not invent timeline.move_clip.",
      requested: text,
    };
    return appendTurn(next, text, `${lastNoTool.code}: ${lastNoTool.message}`, { lastNoTool });
  }
  if (plan.intent.kind === "ASK_CAPABILITY") {
    return appendTurn(next, text, capabilityReply());
  }
  if (plan.intent.kind === "DRAFT_CUT") {
    return appendTurn(
      next,
      text,
      "Draft only: cutting is not available as a tool. No project changes were made.",
    );
  }
  if (plan.providerAction === "read-tool") {
    return runReadPlan(state, plan, text, session);
  }

  const provider = opts?.providerInjected ? runtime.provider : providerForHost(next);
  return submitDirectorProviderTurn(
    next,
    text,
    { provider, orchestrator: runtime.orchestrator },
    signal,
    session,
  );
}

export async function retryDirectorLocalHealth(state: DirectorHostState): Promise<DirectorHostState> {
  clearDiscoveryCache();
  if (state.providerId !== "openai-compatible") {
    return { ...state, localUnavailable: false };
  }
  const testing = beginDirectorConnectionTest({ ...state, localUnavailable: false });
  return finishDirectorConnectionTest(testing);
}

export { clearDiscoveryCache, planDirectorTurn, pickAutoModel, resolveAutoRuntime };

