import { useRef, useState, type FormEvent } from "react";
import {
  applyLocalConfig,
  applyProviderId,
  createDirectorHostState,
  createDirectorRuntime,
  providerForHost,
  setDirectorPanelOpen,
  submitDirectorProviderTurn,
  testDirectorConnection,
  type DirectorHostState,
} from "../../app/ai/host";
import { registerBuiltInProviders } from "../../app/ai/providers";
import type { AIProvider, ProviderId } from "../../app/ai/providers/types";

registerBuiltInProviders();

export interface DirectorPanelProps {
  /** Optional initial host state (tests). */
  initialState?: DirectorHostState;
  /** Inject a provider (tests). Default: host-selected provider. */
  provider?: AIProvider;
  onStateChange?: (state: DirectorHostState) => void;
}

export function DirectorPanel({ initialState, provider, onStateChange }: DirectorPanelProps) {
  const [state, setState] = useState<DirectorHostState>(
    () => initialState ?? createDirectorHostState(),
  );
  const [draft, setDraft] = useState("");
  const runtimeRef = useRef(createDirectorRuntime(provider, initialState));
  const abortRef = useRef<AbortController | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  const commit = (next: DirectorHostState) => {
    setState(next);
    onStateChange?.(next);
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
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
      const next = await submitDirectorProviderTurn(current, text, runtime, ctl.signal);
      commit(next);
    })();
  };

  return (
    <section className="director" data-testid="director">
      <header className="director-head">
        <h2>Director</h2>
        <button
          type="button"
          className="director-toggle"
          data-testid="director-toggle"
          aria-expanded={state.panelOpen}
          aria-controls="director-body"
          onClick={() => commit(setDirectorPanelOpen(state, !state.panelOpen))}
        >
          {state.panelOpen ? "Close" : "Open"}
        </button>
      </header>
      {state.panelOpen ? (
        <div id="director-body" className="director-body" data-testid="director-body">
          <dl className="director-meta">
            <div>
              <dt>Status</dt>
              <dd data-testid="director-status">{state.statusLabel}</dd>
            </div>
            <div>
              <dt>Provider</dt>
              <dd data-testid="director-provider">{state.providerLabel}</dd>
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
                commit(applyProviderId(state, id === "openai-compatible" ? "openai-compatible" : "mock"));
              }}
            >
              <option value="mock">mock</option>
              <option value="openai-compatible">openai-compatible (local)</option>
            </select>
            {state.providerId === "openai-compatible" ? (
              <>
                <label htmlFor="director-base-url">Base URL</label>
                <input
                  id="director-base-url"
                  data-testid="director-base-url"
                  value={state.localConfig.baseUrl}
                  placeholder="http://127.0.0.1:11434/v1"
                  onChange={(e) => commit(applyLocalConfig(state, { baseUrl: e.target.value }))}
                />
                <label htmlFor="director-model">Model</label>
                <input
                  id="director-model"
                  data-testid="director-model"
                  value={state.localConfig.model}
                  placeholder="local-model"
                  onChange={(e) => commit(applyLocalConfig(state, { model: e.target.value }))}
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
                <button
                  type="button"
                  data-testid="director-test-connection"
                  onClick={() => {
                    void testDirectorConnection(state).then(commit);
                  }}
                >
                  Test connection
                </button>
              </>
            ) : null}
          </div>
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
          <form className="director-compose" onSubmit={onSubmit} data-testid="director-compose">
            <label className="director-compose-label" htmlFor="director-input">
              Message
            </label>
            <textarea
              id="director-input"
              data-testid="director-input"
              rows={3}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Talk to Director"
            />
            <button type="submit" className="primary" data-testid="director-send">
              Send
            </button>
          </form>
        </div>
      ) : null}
    </section>
  );
}
