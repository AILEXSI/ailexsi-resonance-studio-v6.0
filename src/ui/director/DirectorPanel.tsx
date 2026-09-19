import { useState, type FormEvent } from "react";
import {
  createDirectorHostState,
  setDirectorPanelOpen,
  submitDirectorMockTurn,
  type DirectorHostState,
} from "../../app/ai/host";

export interface DirectorPanelProps {
  /** Optional initial host state (tests). */
  initialState?: DirectorHostState;
  onStateChange?: (state: DirectorHostState) => void;
}

export function DirectorPanel({ initialState, onStateChange }: DirectorPanelProps) {
  const [state, setState] = useState<DirectorHostState>(
    () => initialState ?? createDirectorHostState(),
  );
  const [draft, setDraft] = useState("");

  const commit = (next: DirectorHostState) => {
    setState(next);
    onStateChange?.(next);
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    const next = submitDirectorMockTurn(state, text);
    setDraft("");
    commit(next);
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
              placeholder="Talk to Director (offline mock)"
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
