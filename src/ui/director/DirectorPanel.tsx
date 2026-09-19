import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import {
  applyContextLevel,
  applyGrant,
  applyHostApproved,
  applyLocalConfig,
  applyMode,
  applyProviderId,
  createDirectorRuntime,
  DIRECTOR_MODES,
  GRANTS,
  hydrateDirectorHostFromPrefs,
  persistDirectorHostPrefs,
  providerForHost,
  rejectHostTransaction,
  setDirectorPanelOpen,
  submitDirectorProviderTurn,
  beginDirectorConnectionTest,
  finishDirectorConnectionTest,
  discoverDirectorModels,
  findLocalAiEndpoints,
  type DirectorHostState,
} from "../../app/ai/host";
import {
  DEFAULT_CHAT_TIMEOUT_MS,
  MAX_CHAT_TIMEOUT_MS,
  MIN_CHAT_TIMEOUT_MS,
} from "../../app/ai/providers/openai-compatible";
import type { DirectorMode, Grant } from "../../app/ai/permissions/policy";
import { cachePlayheadMs } from "../../app/ai/context/snapshot";
import { CONTEXT_LEVELS, type ContextLevel } from "../../app/ai/context/types";
import { registerBuiltInProviders } from "../../app/ai/providers";
import type { AIProvider, ProviderId } from "../../app/ai/providers/types";
import { appendDirectorMessage } from "../../app/ai/conversation";
import type { Session } from "../../app/session";
import {
  browserLayoutStorage,
  clampComposerHeightPx,
  COMPOSER_MAX_PX,
  COMPOSER_MIN_PX,
  loadDirectorComposerHeight,
  saveDirectorComposerHeight,
} from "../../core/layout-prefs";

registerBuiltInProviders();

export interface DirectorPanelProps {
  /** Optional initial host state (tests). */
  initialState?: DirectorHostState;
  /** Inject a provider (tests). Default: host-selected provider. */
  provider?: AIProvider;
  /** Read-only session. Used to capture context on submit. Never mutated here. */
  session?: Session;
  onStateChange?: (state: DirectorHostState) => void;
  /** Apply path: parent owns Session and must use applyCommand/withHistory. */
  onCanonicalCommit?: (session: Session) => void;
  /** App chrome: Close hides Director and syncs the toolbar AI toggle. */
  onRequestClose?: () => void;
  /** Director Focus — collapses Inspector section only. Not app fullscreen. */
  focusMode?: boolean;
  onToggleFocus?: () => void;
  /** Existing Session history. Director never owns a second undo stack. */
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
}

export function DirectorPanel({
  initialState,
  provider,
  session,
  onStateChange,
  onCanonicalCommit,
  onRequestClose,
  focusMode = false,
  onToggleFocus,
  canUndo = false,
  canRedo = false,
  onUndo,
  onRedo,
}: DirectorPanelProps) {
  const [state, setState] = useState<DirectorHostState>(
    () => initialState ?? hydrateDirectorHostFromPrefs(),
  );
  const [draft, setDraft] = useState("");
  const layoutStore = browserLayoutStorage();
  const [composerHeight, setComposerHeight] = useState(() => loadDirectorComposerHeight(layoutStore));
  const runtimeRef = useRef(createDirectorRuntime(provider, initialState));
  const abortRef = useRef<AbortController | null>(null);
  const probeGenRef = useRef(0);
  const stateRef = useRef(state);
  const sessionRef = useRef(session);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  stateRef.current = state;
  sessionRef.current = session;

  useEffect(() => {
    if (session) cachePlayheadMs(session.project.playheadMs);
  }, [session, session?.project.playheadMs]);

  const commit = (next: DirectorHostState) => {
    setState(next);
    onStateChange?.(next);
  };

  const commitProviderConfig = (next: DirectorHostState) => {
    persistDirectorHostPrefs(next);
    commit(next);
  };

  const persistComposerHeight = (px: number) => {
    const next = clampComposerHeightPx(px);
    setComposerHeight(next);
    saveDirectorComposerHeight(layoutStore, next);
  };

  const growComposer = (el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    persistComposerHeight(Math.min(COMPOSER_MAX_PX, Math.max(COMPOSER_MIN_PX, el.scrollHeight)));
  };

  const sendDraft = () => {
    const text = draft.trim();
    if (!text) return;
    abortRef.current?.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;
    setDraft("");
    const current = stateRef.current;
    const runtime = {
      provider: provider ?? providerForHost(current),
      orchestrator: runtimeRef.current.orchestrator,
    };
    void (async () => {
      const next = await submitDirectorProviderTurn(current, text, runtime, ctl.signal, session);
      if (ctl.signal.aborted || abortRef.current !== ctl) return;
      const live = sessionRef.current;
      if (next.transaction && live && next.transaction.projectId !== live.project.id) {
        commit({
          ...next,
          transaction: null,
          transactionLabel: "Transaction: —",
          conversation: appendDirectorMessage(
            next.conversation,
            "assistant",
            "Ignored late reply after project switch. No project changes were made.",
          ),
        });
        return;
      }
      commit(next);
    })();
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    sendDraft();
  };

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      sendDraft();
    }
  };

  const txn = state.transaction;
  const conflict =
    state.lastGateCode === "TRANSACTION_CONFLICT" ||
    state.statusLabel.includes("TRANSACTION_CONFLICT") ||
    state.transactionLabel.includes("TRANSACTION_CONFLICT");
  const pendingDraft = txn?.status === "draft";

  return (
    <section className="director" data-testid="director" data-focus={focusMode ? "true" : "false"}>
      <header className="director-head">
        <h2>Director</h2>
        <div className="director-head-actions">
          {onToggleFocus ? (
            <button
              type="button"
              className={`director-focus${focusMode ? " active" : ""}`}
              data-testid="director-focus"
              aria-pressed={focusMode}
              title={focusMode ? "Exit Director Focus — restore Inspector and split" : "Director Focus — collapse Inspector, Director uses the right space"}
              onClick={onToggleFocus}
            >
              {focusMode ? "Exit Focus" : "Focus"}
            </button>
          ) : null}
          <button
            type="button"
            className="director-toggle"
            data-testid="director-toggle"
            aria-expanded={state.panelOpen}
            aria-controls="director-body"
            onClick={() => {
              if (state.panelOpen && onRequestClose) {
                onRequestClose();
                return;
              }
              commit(setDirectorPanelOpen(state, !state.panelOpen));
            }}
          >
            {state.panelOpen ? "Close" : "Open"}
          </button>
        </div>
      </header>
      {state.panelOpen ? (
        <div id="director-body" className="director-body" data-testid="director-body">
          <div className="director-chrome" data-testid="director-chrome">
            <dl className="director-meta">
              <div>
                <dt>Status</dt>
                <dd data-testid="director-status">{state.statusLabel}</dd>
              </div>
              <div>
                <dt>Provider</dt>
                <dd
                  data-testid="director-provider"
                  data-provider-kind={state.providerId === "openai-compatible" ? "local-openai-compatible" : "mock"}
                  data-provider-offline={state.providerId === "mock" ? "true" : "false"}
                >
                  {state.providerLabel}
                </dd>
              </div>
              <div>
                <dt>Mode</dt>
                <dd data-testid="director-mode">{state.modeLabel}</dd>
              </div>
              <div>
                <dt>Context</dt>
                <dd data-testid="director-context">{state.contextLabel}</dd>
              </div>
              <div>
                <dt>Transaction</dt>
                <dd data-testid="director-transaction">{state.transactionLabel}</dd>
              </div>
            </dl>
            <div className="director-config" data-testid="director-config">
              <label htmlFor="director-provider-select">Provider</label>
              <select
                id="director-provider-select"
                data-testid="director-provider-select"
                value={state.providerId === "openai-compatible" ? "openai-compatible" : "mock"}
                onChange={(e) => {
                  const id = e.target.value as ProviderId;
                  commitProviderConfig(
                    applyProviderId(state, id === "openai-compatible" ? "openai-compatible" : "mock"),
                  );
                }}
              >
                <option value="mock">mock (offline)</option>
                <option value="openai-compatible">local-openai-compatible</option>
              </select>
              <label htmlFor="director-mode">Mode</label>
              <select
                id="director-mode"
                data-testid="director-mode-select"
                value={state.mode}
                onChange={(e) => commit(applyMode(state, e.target.value as DirectorMode))}
              >
                {DIRECTOR_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {mode}
                  </option>
                ))}
              </select>
              <label htmlFor="director-grant">Grant</label>
              <select
                id="director-grant"
                data-testid="director-grant-select"
                value={state.grant}
                onChange={(e) => commit(applyGrant(state, e.target.value as Grant))}
              >
                {GRANTS.map((grant) => (
                  <option key={grant} value={grant}>
                    {grant}
                  </option>
                ))}
              </select>
              <label htmlFor="director-context-level">Context level</label>
              <select
                id="director-context-level"
                data-testid="director-context-level"
                value={state.contextLevel}
                onChange={(e) => commit(applyContextLevel(state, e.target.value as ContextLevel))}
              >
                {CONTEXT_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ))}
              </select>
              {state.providerId === "openai-compatible" ? (
                <>
                  <label htmlFor="director-base-url">Base URL</label>
                  <input
                    id="director-base-url"
                    data-testid="director-base-url"
                    value={state.localConfig.baseUrl}
                    placeholder="http://127.0.0.1:11434/v1"
                    onChange={(e) => commitProviderConfig(applyLocalConfig(state, { baseUrl: e.target.value }))}
                  />
                  <label htmlFor="director-model">Model</label>
                  <input
                    id="director-model"
                    data-testid="director-model"
                    value={state.localConfig.model}
                    placeholder="local-model"
                    list="director-model-list"
                    onChange={(e) => commitProviderConfig(applyLocalConfig(state, { model: e.target.value }))}
                  />
                  <datalist id="director-model-list">
                    {state.discoveredModels.map((m) => (
                      <option key={m.id} value={m.id} />
                    ))}
                  </datalist>
                  {state.discoveredModels.length > 0 ? (
                    <>
                      <label htmlFor="director-model-select">Discovered</label>
                      <select
                        id="director-model-select"
                        data-testid="director-model-select"
                        value={
                          state.discoveredModels.some((m) => m.id === state.localConfig.model)
                            ? state.localConfig.model
                            : ""
                        }
                        onChange={(e) => {
                          if (!e.target.value) return;
                          commitProviderConfig(applyLocalConfig(state, { model: e.target.value }));
                        }}
                      >
                        <option value="">Select a listed model</option>
                        {state.discoveredModels.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                      </select>
                    </>
                  ) : null}
                  <label htmlFor="director-chat-timeout">Chat timeout (ms)</label>
                  <input
                    id="director-chat-timeout"
                    data-testid="director-chat-timeout"
                    type="number"
                    min={MIN_CHAT_TIMEOUT_MS}
                    max={MAX_CHAT_TIMEOUT_MS}
                    value={state.localConfig.timeoutMs ?? DEFAULT_CHAT_TIMEOUT_MS}
                    title="Cold local models may take ~32s on first chat. Default 90000 ms still fail-closes."
                    onChange={(e) =>
                      commitProviderConfig(
                        applyLocalConfig(state, { timeoutMs: Number(e.target.value) }),
                      )
                    }
                  />
                  <label htmlFor="director-api-key">API key (optional, memory only)</label>
                  <input
                    id="director-api-key"
                    data-testid="director-api-key"
                    type="password"
                    autoComplete="off"
                    value={state.localConfig.apiKey ?? ""}
                    onChange={(e) => commit(applyLocalConfig(state, { apiKey: e.target.value }))}
                  />
                  <div className="director-config-actions">
                    <button
                      type="button"
                      data-testid="director-test-connection"
                      disabled={state.connectionProbe.phase === "testing"}
                      onClick={() => {
                        const gen = ++probeGenRef.current;
                        const testing = beginDirectorConnectionTest(state);
                        commit(testing);
                        void finishDirectorConnectionTest(testing).then((next) => {
                          if (probeGenRef.current === gen) commit(next);
                        });
                      }}
                    >
                      {state.connectionProbe.phase === "testing" ? "Testing..." : "Test connection"}
                    </button>
                    <button
                      type="button"
                      data-testid="director-discover-models"
                      disabled={state.connectionProbe.phase === "testing"}
                      onClick={() => {
                        const gen = ++probeGenRef.current;
                        const testing = beginDirectorConnectionTest(state);
                        commit(testing);
                        void discoverDirectorModels(testing).then((next) => {
                          if (probeGenRef.current === gen) commit(next);
                        });
                      }}
                    >
                      Discover Models
                    </button>
                    <button
                      type="button"
                      data-testid="director-find-local-ai"
                      disabled={state.connectionProbe.phase === "testing"}
                      onClick={() => {
                        const gen = ++probeGenRef.current;
                        const testing = beginDirectorConnectionTest(state);
                        commit(testing);
                        void findLocalAiEndpoints(testing).then((next) => {
                          if (probeGenRef.current === gen) {
                            persistDirectorHostPrefs(next);
                            commit(next);
                          }
                        });
                      }}
                    >
                      Find Local AI
                    </button>
                  </div>
                  <p
                    className="director-probe"
                    data-testid="director-connection-probe"
                    data-phase={state.connectionProbe.phase}
                    data-category={state.connectionProbe.category ?? ""}
                    hidden={state.connectionProbe.phase === "idle"}
                  >
                    {state.connectionProbe.label}
                  </p>
                </>
              ) : null}
            </div>
          </div>
          {conflict ? (
            <div
              className="director-conflict"
              data-testid="director-conflict"
              data-conflict-code="TRANSACTION_CONFLICT"
              role="alert"
            >
              <p data-testid="director-conflict-title">STALE TRANSACTION — CONFLICT</p>
              <p data-testid="director-conflict-detail">
                {state.lastGateMessage ?? "The project changed after this preview."} Apply is blocked.
                Manual edit is intact. Reject this stale draft. Undo / Redo still walk project history and
                do not revive this preview.
              </p>
            </div>
          ) : null}
          {txn ? (
            <div
              className={`director-txn director-txn-${txn.status}${conflict ? " director-txn-conflict" : ""}`}
              data-testid="director-txn"
              data-txn-status={txn.status}
              data-gate={state.lastGateCode ?? ""}
            >
              <p data-testid="director-txn-phase">
                {conflict && pendingDraft
                  ? "STALE — CONFLICT"
                  : txn.status === "draft"
                    ? "PREVIEW"
                    : txn.status === "applied"
                      ? "APPLIED"
                      : "REJECTED"}
              </p>
              <p data-testid="director-txn-status">
                {conflict && pendingDraft ? "conflict · stale preview" : `${txn.status} · ${txn.toolName}`}
              </p>
              <p data-testid="director-txn-tool">Tool: {txn.toolName}</p>
              <p data-testid="director-txn-target">Target: {txn.preview.clipId ?? "—"}</p>
              <p data-testid="director-txn-delta">
                Delta: {txn.command.type === "moveClips" ? `+${txn.command.deltaMs}ms` : "—"}
              </p>
              <p data-testid="director-txn-preview">
                {txn.preview.clipId ?? "—"}: {txn.preview.beforeStartMs ?? "—"} → {txn.preview.afterStartMs ?? "—"}
              </p>
              {txn.status === "rejected" ? (
                <p className="director-txn-result" data-testid="director-txn-rejected">
                  REJECTED. Clip was not moved. No history entry.
                </p>
              ) : null}
              {txn.status === "applied" ? (
                <p className="director-txn-result" data-testid="director-txn-applied">
                  APPLIED. Exact preview committed. Undo / Redo below use the project history.
                </p>
              ) : null}
              {pendingDraft && session ? (
                <div className="director-txn-actions">
                  <button
                    type="button"
                    className="primary"
                    data-testid="director-txn-apply"
                    disabled={conflict}
                    title={
                      conflict
                        ? "Apply blocked — stale TRANSACTION_CONFLICT. Reject or Undo the later edit first."
                        : "Apply this preview to the project"
                    }
                    onClick={() => {
                      const live = sessionRef.current;
                      if (!live) return;
                      const result = applyHostApproved(state, live);
                      commit(result.state);
                      if (result.session !== live) onCanonicalCommit?.(result.session);
                    }}
                  >
                    Apply
                  </button>
                  <button
                    type="button"
                    data-testid="director-txn-reject"
                    title="Reject this preview. No project change."
                    onClick={() => commit(rejectHostTransaction(state))}
                  >
                    Reject
                  </button>
                </div>
              ) : null}
              {onUndo || onRedo ? (
                <div className="director-history-actions" data-testid="director-history-actions">
                  <button
                    type="button"
                    data-testid="director-history-undo"
                    disabled={!canUndo || !onUndo}
                    title="Undo last project history entry (same as Transport Undo)"
                    onClick={() => onUndo?.()}
                  >
                    Undo
                  </button>
                  <button
                    type="button"
                    data-testid="director-history-redo"
                    disabled={!canRedo || !onRedo}
                    title="Redo last undone project history entry (same as Transport Redo)"
                    onClick={() => onRedo?.()}
                  >
                    Redo
                  </button>
                </div>
              ) : null}
            </div>
          ) : onUndo || onRedo ? (
            <div className="director-history-actions" data-testid="director-history-actions">
              <button
                type="button"
                data-testid="director-history-undo"
                disabled={!canUndo || !onUndo}
                title="Undo last project history entry (same as Transport Undo)"
                onClick={() => onUndo?.()}
              >
                Undo
              </button>
              <button
                type="button"
                data-testid="director-history-redo"
                disabled={!canRedo || !onRedo}
                title="Redo last undone project history entry (same as Transport Redo)"
                onClick={() => onRedo?.()}
              >
                Redo
              </button>
            </div>
          ) : null}
          <div className="director-scroll" data-testid="director-scroll">
            <ol className="director-messages" data-testid="director-messages">
              {state.conversation.messages.map((msg) => (
                <li
                  key={msg.id}
                  className={`director-msg director-msg-${msg.role}`}
                  data-testid={`director-msg-${msg.role}`}
                  data-role={msg.role}
                >
                  <span className="director-msg-role">{msg.role}</span>
                  <span className="director-msg-text">{msg.text}</span>
                </li>
              ))}
            </ol>
          </div>
          <form className="director-compose" onSubmit={onSubmit} data-testid="director-compose">
            <label className="director-compose-label" htmlFor="director-input">
              Message
            </label>
            <textarea
              id="director-input"
              ref={composerRef}
              data-testid="director-input"
              rows={3}
              value={draft}
              data-composer-min={COMPOSER_MIN_PX}
              data-composer-max={COMPOSER_MAX_PX}
              style={{ height: composerHeight }}
              onChange={(e) => {
                setDraft(e.target.value);
                growComposer(e.target);
              }}
              onKeyDown={onComposerKeyDown}
              onMouseUp={(e) => persistComposerHeight(e.currentTarget.getBoundingClientRect().height)}
              placeholder="Talk to Director"
            />
            <p className="director-compose-hint" data-testid="director-compose-hint">
              Enter = newline · Ctrl+Enter = Send
            </p>
            <button type="submit" className="primary" data-testid="director-send">
              Send
            </button>
          </form>
        </div>
      ) : null}
    </section>
  );
}
