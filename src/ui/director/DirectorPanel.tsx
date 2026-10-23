export interface DirectorLine {
  id: string;
  role: "system" | "user" | "assistant";
  text: string;
}

interface Props {
  lines: DirectorLine[];
  draft: string;
  onDraft: (value: string) => void;
  onSend: () => void;
  busy?: boolean;
}

/**
 * Presentational Director shell. It has no session and cannot mutate a project.
 * Later phases pass proposals in; AI-1 only shows the empty proposal slot.
 */
export function DirectorPanel({ lines, draft, onDraft, onSend, busy }: Props) {
  return (
    <section className="director-panel" data-testid="ai-director" aria-label="AI Director">
      <header className="director-head">
        <h2>AI Director</h2>
        <p>Proposal only. Nothing changes until you accept it here.</p>
      </header>
      <div className="director-log" data-testid="ai-director-log" role="log">
        {lines.map((line) => (
          <p key={line.id} data-role={line.role}>
            <span className="director-role">{line.role}</span>
            {line.text}
          </p>
        ))}
      </div>
      <div className="director-proposals" data-testid="ai-director-proposals">
        <h3>Proposals</h3>
        <p data-testid="ai-director-empty">No proposals yet.</p>
      </div>
      <form
        className="director-compose"
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy) onSend();
        }}
      >
        <label className="director-compose-label" htmlFor="ai-director-input">
          Message
        </label>
        <textarea
          id="ai-director-input"
          data-testid="ai-director-input"
          value={draft}
          rows={2}
          disabled={busy}
          onChange={(event) => onDraft(event.target.value)}
        />
        <button type="submit" data-testid="ai-director-send" disabled={busy || draft.trim().length === 0}>
          Send
        </button>
      </form>
    </section>
  );
}
