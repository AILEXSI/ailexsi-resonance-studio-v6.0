import type { AiPrefs, AiProviderKind } from "../../app/ai/providers/prefs";

interface Props {
  prefs: AiPrefs;
  apiKey: string;
  onPrefs: (prefs: AiPrefs) => void;
  onApiKey: (value: string) => void;
  contextJson: string;
  contextNote: string;
  keychainAvailable: boolean;
  keychainReason: string;
}

export function DirectorSettings({
  prefs,
  apiKey,
  onPrefs,
  onApiKey,
  contextJson,
  contextNote,
  keychainAvailable,
  keychainReason,
}: Props) {
  return (
    <div className="director-settings" data-testid="ai-provider-settings">
      <label>
        Provider
        <select
          data-testid="ai-provider-kind"
          value={prefs.provider}
          onChange={(event) => onPrefs({ ...prefs, provider: event.target.value as AiProviderKind })}
        >
          <option value="mock">Mock (offline)</option>
          <option value="local">Local OpenAI-compatible</option>
          <option value="cloud">Cloud OpenAI-compatible</option>
        </select>
      </label>
      {prefs.provider === "mock" ? (
        <p className="director-note">No request is sent. The mock does not see media or paths.</p>
      ) : (
        <>
          <label>
            Base URL
            <input
              data-testid="ai-provider-url"
              value={prefs.baseUrl}
              placeholder={prefs.provider === "local" ? "http://127.0.0.1:11434/v1" : "https://example.invalid/v1"}
              autoComplete="off"
              onChange={(event) => onPrefs({ ...prefs, baseUrl: event.target.value })}
            />
          </label>
          <label>
            Model
            <input
              data-testid="ai-provider-model"
              value={prefs.model}
              autoComplete="off"
              onChange={(event) => onPrefs({ ...prefs, model: event.target.value })}
            />
          </label>
        </>
      )}
      {prefs.provider === "cloud" ? (
        <>
          <label>
            API key (session memory)
            <input
              type="password"
              data-testid="ai-provider-key"
              value={apiKey}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => onApiKey(event.target.value)}
            />
          </label>
          <label>
            <input
              type="checkbox"
              data-testid="ai-keychain-opt-in"
              checked={prefs.rememberKey}
              disabled={!keychainAvailable}
              onChange={(event) => onPrefs({ ...prefs, rememberKey: event.target.checked })}
            />
            Remember the key in the OS keychain
          </label>
          <p className="director-note" data-testid="ai-keychain-reason">
            {keychainReason}
          </p>
        </>
      ) : null}
      <p className="director-note">{contextNote}</p>
      <pre className="director-context" data-testid="ai-send-context">
        {contextJson}
      </pre>
    </div>
  );
}
