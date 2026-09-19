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
import {
  canonicalClipSelection,
  projectRevisionOf,
  selectionOf,
  type CanonicalClipSelection,
  type Session,
} from "../session";
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
  directorPlanStatus,
  pickAutoModel,
  planDirectorTurn,
  resolveAutoRuntime,
  sealDirectorPlan,
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

/**
 * Request-scoped plan + immutable context snapshot.
 * Conceptually DirectorRequest { plan, contextSnapshot, authorization }.
 * Immutable. Not React state-as-IPC. Not Advanced dropdowns.
 */
export interface SealedDirectorRequest {
  readonly plan: DirectorPlan;
  readonly clipId: string | null;
  /** Canonical Session selection at submit. Not the Advanced dropdown. */
  readonly canonicalClipIds: readonly string[];
  readonly userText: string;
  readonly contextSnapshot: AIContextSnapshot | null;
  readonly projectId: string | null;
  readonly projectRevision: number | null;
}

/** Compact boundary trace. No Project dump. No secrets. */
export interface DirectorRequestContextTrace {
  contextLevel: ContextLevel;
  selectedClipIds: readonly string[];
  clipId: string | null;
  projectId: string | null;
  projectRevision: number | null;
}

/** Advanced / stored defaults. Never authoritative for an in-flight AUTO request. */
export interface DirectorManualSettings {
  mode: DirectorMode;
  grant: Grant;
  contextLevel: ContextLevel;
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
  /** Sealed in-flight AUTO request. Execution reads this, not mode/grant/contextLevel. */
  sealedRequest: SealedDirectorRequest | null;
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
    sealedRequest: null,
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

/** Mode for the in-flight request. Plan first — never re-read ASK from Advanced. */
export function planModeOf(state: DirectorHostState): DirectorMode {
  return state.sealedRequest?.plan.mode ?? state.lastPlan?.mode ?? state.mode;
}

/** Context for the in-flight request. Plan first — never re-read NONE from Advanced. */
export function planContextOf(state: DirectorHostState): ContextLevel {
  return state.sealedRequest?.plan.contextLevel ?? state.lastPlan?.contextLevel ?? state.contextLevel;
}

export function sealDirectorRequest(
  plan: DirectorPlan,
  session: Session | undefined,
  userText: string,
): SealedDirectorRequest {
  const sealed = sealDirectorPlan(plan);
  const canonical = session ? canonicalClipSelection(session) : emptyCanonical();
  const wantsSelection =
    sealed.contextLevel === "SELECTION" || sealed.intent.kind === "MOVE_CLIP";
  const clipId = wantsSelection || canonical.usableMoveTarget ? canonical.usableMoveTarget : null;
  const snapshotLevel =
    wantsSelection && canonical.clipIds.length === 1 ? "SELECTION" : sealed.contextLevel;
  const contextSnapshot = session
    ? captureContextSnapshot(session, {
        level: snapshotLevel,
        outboundClass: "SEND_STRUCTURE",
        clipIds: snapshotLevel === "SELECTION" ? [...canonical.clipIds] : undefined,
      })
    : null;
  return Object.freeze({
    plan: sealed,
    clipId,
    canonicalClipIds: Object.freeze([...canonical.clipIds]),
    userText,
    contextSnapshot,
    projectId: session?.project.id ?? null,
    projectRevision: session ? projectRevisionOf(session) : null,
  });
}

function emptyCanonical(): CanonicalClipSelection {
  return { clipIds: [], primaryId: null, usableMoveTarget: null };
}

export function requestContextTrace(state: DirectorHostState): DirectorRequestContextTrace {
  const snap = state.sealedRequest?.contextSnapshot ?? state.lastSnapshot;
  const selected = requestSelectedClipIds(state);
  return {
    contextLevel: selected.length === 1 ? "SELECTION" : planContextOf(state),
    selectedClipIds: selected,
    clipId: state.sealedRequest?.clipId ?? (selected.length === 1 ? selected[0]! : snap?.selection.primaryClipId ?? null),
    projectId: state.sealedRequest?.projectId ?? snap?.projectId ?? null,
    projectRevision: state.sealedRequest?.projectRevision ?? null,
  };
}

function requestSelectedClipIds(state: DirectorHostState): readonly string[] {
  const sealed = state.sealedRequest?.canonicalClipIds;
  if (sealed && sealed.length > 0) return sealed;
  if (state.sealedRequest?.clipId) return [state.sealedRequest.clipId];
  const snap = state.sealedRequest?.contextSnapshot ?? state.lastSnapshot;
  return snap?.selection.clipIds ?? [];
}

/** Live Normal chrome. Dropdown SELECTION is never a substitute. */
export function canonicalContextLabel(session?: Session): string {
  if (!session) return "Context NONE · no clip";
  const canonical = canonicalClipSelection(session);
  const n = canonical.clipIds.length;
  if (n === 1) return "Context SELECTION · 1 clip";
  if (n > 1) return `Context SELECTION · ${n} clips`;
  return "Context NONE · no clip";
}

export function intentStatusLabel(state: DirectorHostState): string {
  const kind = state.sealedRequest?.plan.intent.kind ?? state.lastPlan?.intent.kind;
  return kind ? `Intent ${kind}` : "Intent —";
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
  const sealedTarget = state.sealedRequest?.clipId ?? state.transaction.preview.clipId;
  const liveCanonical = canonicalClipSelection(session);
  if (
    sealedTarget &&
    liveCanonical.clipIds.length === 1 &&
    liveCanonical.clipIds[0] !== sealedTarget
  ) {
    return {
      state: {
        ...state,
        onceGrant: null,
        status: "error",
        statusLabel: "Error — TRANSACTION_CONFLICT",
        transactionLabel: "Transaction: TRANSACTION_CONFLICT",
        lastGateCode: "TRANSACTION_CONFLICT",
        lastGateMessage: "Selection changed after this preview",
        conversation: appendDirectorMessage(
          state.conversation,
          "assistant",
          "STALE TRANSACTION — CONFLICT. Selection changed after this preview. Apply is blocked. Manual edit is intact. Reject this stale draft. Undo / Redo still walk project history and do not revive this preview. No project changes were made.",
        ),
      },
      session,
    };
  }
  const result = applyCommandTransaction({
    session,
    transaction: state.transaction,
    grant: effectiveGrant(state),
    mode:
      state.transaction.toolName === DIRECTOR_MUTATING_TOOL
        ? executionModeForMove(state)
        : planModeOf(state),
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
  if (state.sealedRequest?.contextSnapshot) {
    return { ...state, lastSnapshot: state.sealedRequest.contextSnapshot };
  }
  if (!session) return state;
  const clipId = state.sealedRequest?.clipId;
  const canonicalIds = state.sealedRequest?.canonicalClipIds;
  const lastSnapshot = captureContextSnapshot(session, {
    level: clipId || (canonicalIds && canonicalIds.length === 1) ? "SELECTION" : planContextOf(state),
    outboundClass: state.outboundClass,
    clipIds: clipId ? [clipId] : canonicalIds && canonicalIds.length > 0 ? [...canonicalIds] : undefined,
  });
  return { ...state, lastSnapshot };
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
  if (state.lastSnapshot && state.lastSnapshot.level !== "NONE") {
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
  if (
    opts.detail === "No clip selected" ||
    opts.detail === "AMBIGUOUS_SELECTION" ||
    opts.detail === "SELECTION_REQUIRED"
  ) {
    return `SELECTION REQUIRED. ${opts.detail === "AMBIGUOUS_SELECTION" ? "AMBIGUOUS_SELECTION. A single selected clip is required." : "No clip selected. A single selected clip is required."} No project changes were made.`;
  }
  if (opts.detail === "TARGET_NOT_IN_SELECTION") {
    return "Denied: target clip is not in the request selection. No project changes were made.";
  }
  return `Move draft denied: ${opts.detail}. No project changes were made.`;
}

/** AUTO move uses AGENT. Manual Advanced override keeps the dropdown mode. */
function executionModeForMove(state: DirectorHostState): DirectorMode {
  const plan = state.sealedRequest?.plan ?? state.lastPlan;
  if (plan?.intent.reason === "manual-settings") return planModeOf(state);
  return "AGENT";
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
  const sealed = state.sealedRequest;
  const liveCanonical = canonicalClipSelection(session);
  const selectedIds = [...requestSelectedClipIds(state)];
  const usableId =
    sealed?.clipId ??
    (selectedIds.length === 1 ? selectedIds[0]! : null) ??
    liveCanonical.usableMoveTarget;
  if (!usableId) {
    const ambiguous = selectedIds.length > 1 || liveCanonical.clipIds.length > 1;
    return {
      ...state,
      conversation: appendDirectorMessage(
        state.conversation,
        "assistant",
        ambiguous
          ? "AMBIGUOUS_SELECTION. A single selected clip is required. No project changes were made."
          : "SELECTION REQUIRED. No clip selected. A single selected clip is required. No project changes were made.",
      ),
    };
  }
  const snap = sealed?.contextSnapshot ?? state.lastSnapshot;
  const boundProjectId = sealed?.projectId ?? snap?.projectId;
  if (boundProjectId && session.project.id !== boundProjectId) {
    return {
      ...state,
      conversation: appendDirectorMessage(
        state.conversation,
        "assistant",
        "Denied: request context project does not match. No project changes were made.",
      ),
    };
  }
  const args = asMoveClipArgs(toolRequest.arguments);
  if (!args.clipId) {
    args.clipId = usableId;
  }
  const requestIds = selectedIds.length > 0 ? selectedIds : [usableId];
  const drafted = draftMoveClip({
    session,
    args,
    grant: effectiveGrant(state),
    mode: executionModeForMove(state),
    selectedClipIds: requestIds,
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
          grant: effectiveGrant(state),
          mode: executionModeForMove(state),
          contextLevel: planContextOf(state),
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
  const scoped =
    state.sealedRequest || !session
      ? state
      : applyOrchestrationPlan(
          state,
          {
            intent: { kind: "UNCERTAIN", confidence: "uncertain", reason: "manual-settings" },
            mode: state.mode,
            requiredGrant: state.grant,
            contextLevel: state.contextLevel,
            capability: "chat",
            toolName: null,
            providerAction: "chat",
          },
          session,
          text,
        );
  const base = attachSubmitSnapshot(scoped, session);
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

/**
 * Store the sealed plan. Do NOT write Mode / Grant / Context dropdowns.
 * Manual settings stay ASK/DRAFT/NONE unless the user changes Advanced.
 */
export function applyOrchestrationPlan(
  state: DirectorHostState,
  plan: DirectorPlan,
  session?: Session,
  userText = "",
): DirectorHostState {
  const sealedRequest = sealDirectorRequest(plan, session, userText);
  return {
    ...state,
    lastPlan: sealedRequest.plan,
    sealedRequest,
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
    onceGrant: null,
  };
}

export function autoPlanStatusLabel(state: DirectorHostState): string {
  const plan = state.sealedRequest?.plan ?? state.lastPlan;
  return plan ? directorPlanStatus(plan) : "—";
}

/** Compact Normal chrome. Session EDIT is runtime only — never Project. */
export function permissionStatusLabel(state: DirectorHostState): string {
  if (state.pendingAuth) return `Permission: ${state.pendingAuth.requiredGrant} required`;
  if (state.onceGrant) return `Permission: ${state.onceGrant} (once)`;
  if (state.grant === "EDIT") return "Permission: EDIT (session)";
  return `Permission: ${state.grant}`;
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
  const prepared = attachSubmitSnapshot(applyOrchestrationPlan(state, plan, session, userText), session);
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
  const sealedRequest = sealDirectorRequest(plan, session, text);
  if (plan.intent.kind === "MOVE_CLIP") {
    const canonical = session ? canonicalClipSelection(session) : emptyCanonical();
    if (canonical.clipIds.length !== 1) {
      const prepared = applyOrchestrationPlan(state, plan, session, text);
      const detail =
        canonical.clipIds.length === 0
          ? "SELECTION REQUIRED. No clip selected. A single selected clip is required."
          : "AMBIGUOUS_SELECTION. A single selected clip is required.";
      return appendTurn(prepared, text, `${detail} No project changes were made.`);
    }
  }
  const current = effectiveGrant(state);
  if (grantExceeds(plan.requiredGrant, current)) {
    return {
      ...state,
      lastPlan: sealedRequest.plan,
      sealedRequest,
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
      lastPlan: sealedRequest.plan,
      sealedRequest,
      localUnavailable: true,
      status: "unavailable",
      statusLabel: "LOCAL AI UNAVAILABLE",
    };
  }

  let next = applyOrchestrationPlan(state, plan, session, text);
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

export {
  clearDiscoveryCache,
  directorPlanStatus,
  planDirectorTurn,
  pickAutoModel,
  resolveAutoRuntime,
  sealDirectorPlan,
};

