import type { WhisperConfig } from "../../app/ai/lyrics/whisper-config";

interface Props {
  text: string;
  status: string;
  whisper: WhisperConfig;
  busy?: boolean;
  onText: (value: string) => void;
  onWhisper: (value: WhisperConfig) => void;
  onSave: () => void;
  onAlign: () => void;
}

/**
 * Pasted lyrics and a local whisper.cpp aligner.
 * The text is not included in Send context.
 */
export function DirectorLyrics({ text, status, whisper, busy, onText, onWhisper, onSave, onAlign }: Props) {
  return (
    <div className="director-lyrics" data-testid="lyric-panel">
      <h3>Lyrics</h3>
      <p className="director-note">
        Lyrics stay on this machine until you type them into the chat. Align uses a local whisper.cpp only.
      </p>
      <textarea
        data-testid="lyric-text"
        aria-label="Lyrics"
        rows={5}
        value={text}
        disabled={busy}
        onChange={(event) => onText(event.target.value)}
      />
      <div className="director-card-actions">
        <button type="button" data-testid="lyric-save" disabled={busy} onClick={onSave}>
          Save lyrics
        </button>
        <button type="button" data-testid="lyric-align" disabled={busy} onClick={onAlign}>
          Align with whisper.cpp
        </button>
      </div>
      <p data-testid="lyric-status">{status}</p>
      <label>
        whisper.cpp executable
        <input
          data-testid="whisper-executable"
          value={whisper.executable}
          disabled={busy}
          onChange={(event) => onWhisper({ ...whisper, executable: event.target.value })}
        />
      </label>
      <label>
        whisper.cpp model
        <input
          data-testid="whisper-model"
          value={whisper.model}
          disabled={busy}
          onChange={(event) => onWhisper({ ...whisper, model: event.target.value })}
        />
      </label>
    </div>
  );
}
