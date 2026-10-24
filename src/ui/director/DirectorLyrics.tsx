import type { WhisperStatus } from "../../app/ai/lyrics/whisper-config";

interface Props {
  text: string;
  status: string;
  whisper: WhisperStatus;
  desktop: boolean;
  busy?: boolean;
  onText: (value: string) => void;
  onPickExecutable: () => void;
  onPickModel: () => void;
  onSave: () => void;
  onAlign: () => void;
}

/**
 * Pasted lyrics and a local whisper.cpp aligner.
 * The text is not included in Send context.
 * The executable and model are chosen by a native dialog in the desktop app.
 */
export function DirectorLyrics({
  text,
  status,
  whisper,
  desktop,
  busy,
  onText,
  onPickExecutable,
  onPickModel,
  onSave,
  onAlign,
}: Props) {
  const executableLabel = whisper.executableName || "not chosen";
  const modelLabel = whisper.modelName || "not chosen";
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
      <div className="director-card-actions">
        <button
          type="button"
          data-testid="whisper-pick-executable"
          disabled={busy || !desktop}
          onClick={onPickExecutable}
        >
          Choose executable
        </button>
        <button type="button" data-testid="whisper-pick-model" disabled={busy || !desktop} onClick={onPickModel}>
          Choose model
        </button>
      </div>
      <p data-testid="whisper-status">
        {desktop
          ? `Executable: ${executableLabel}. Model: ${modelLabel}.`
          : "Choose the executable and model in the desktop app. This page cannot pass a path."}
      </p>
    </div>
  );
}
