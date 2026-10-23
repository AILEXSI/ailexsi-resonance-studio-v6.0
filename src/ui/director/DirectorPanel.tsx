import type { ReactNode } from "react";

export interface DirectorLine {
  id: string;
  role: "system" | "user" | "assistant";
  text: string;
}

export interface DirectorProposalCard {
  id: string;
  status: string;
  tool: string;
  summary: string;
  commandJson: string;
  error?: string;
}

interface Props {
  lines: DirectorLine[];
  draft: string;
  onDraft: (value: string) => void;
  onSend: () => void;
  busy?: boolean;
  proposals?: DirectorProposalCard[];
  onAccept?: (id: string) => void;
  onReject?: (id: string) => void;
  extra?: ReactNode;
}

/**
 * Presentational Director panel. It does not own the session.
 * Accept and Reject are callbacks. The parent decides whether a project changes.
 */
export function DirectorPanel({
  lines,
  draft,
  onDraft,
  onSend,
  busy,
  proposals,
  onAccept,
  onReject,
  extra,
}: Props) {
  const cards = proposals ?? [];
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
        {cards.length === 0 ? <p data-testid="ai-director-empty">No proposals yet.</p> : null}
        {cards.map((card) => (
          <article key={card.id} className="director-card" data-testid={`ai-proposal-${card.id}`} data-status={card.status}>
            <p>
              <strong>{card.tool}</strong> · {card.status}
            </p>
            <p>{card.summary}</p>
            <pre>{card.commandJson}</pre>
            {card.error ? <p data-testid="ai-proposal-error">{card.error}</p> : null}
            <div className="director-card-actions">
              <button
                type="button"
                data-testid={`ai-proposal-accept-${card.id}`}
                disabled={busy || card.status !== "proposed"}
                onClick={() => onAccept?.(card.id)}
              >
                Accept
              </button>
              <button
                type="button"
                data-testid={`ai-proposal-reject-${card.id}`}
                disabled={busy || card.status !== "proposed"}
                onClick={() => onReject?.(card.id)}
              >
                Reject
              </button>
            </div>
          </article>
        ))}
        <p className="director-note">Undo uses the editor Undo button. The Director does not undo by itself.</p>
      </div>
      {extra}
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
