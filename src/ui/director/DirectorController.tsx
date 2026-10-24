import { useEffect, useRef, useState } from "react";
import { createId } from "../../core/ids";
import type { Session } from "../../app/session";
import { runDirectorTurn } from "../../app/ai/loop";
import { createOpenAiCompatibleProvider } from "../../app/ai/providers/openai-compatible";
import { createMockProvider } from "../../app/ai/providers/mock";
import { buildSendContext } from "../../app/ai/context";
import { BROWSER_KEYCHAIN_REASON, detectOsKeychain, memoryKeychain, type OsKeychain } from "../../app/ai/providers/keychain";
import { readAiPrefs, writeAiPrefs, type AiPrefs } from "../../app/ai/providers/prefs";
import { acceptTransaction, rejectTransaction, type AITransaction } from "../../app/ai/transactions";
import { DirectorPanel, type DirectorLine, type DirectorProposalCard } from "./DirectorPanel";
import { DirectorSettings } from "./DirectorSettings";

const SHELL_NOTICE =
  "Mock provider is local. Click Send to make a proposal. Accept is required before the project changes. Beat detection runs only when you ask, and only on audio already in the project.";

interface Props {
  session: Session;
  /** Must invoke `update` immediately. Accept reads the outcome before returning. */
  applySession: (update: (session: Session) => Session) => void;
  /** Optional proposal delivered by a host. The panel does not invent one. */
  offer?: AITransaction | null;
  /** Layout lives in the app shell. The controller does not persist it. */
  expanded?: boolean;
  onToggleExpanded?: () => void;
}

function cardOf(txn: AITransaction): DirectorProposalCard {
  return {
    id: txn.id,
    status: txn.status,
    tool: txn.tool,
    summary: txn.summary,
    commandJson: JSON.stringify(txn.command, null, 2),
    error: txn.error,
  };
}

function storageOrNull(): Storage | null {
  return typeof localStorage === "undefined" ? null : localStorage;
}

/**
 * Director host. Send is the only path that talks to a provider.
 * Accept calls the existing command path. Reject does not.
 */
export function DirectorController({ session, applySession, offer, expanded, onToggleExpanded }: Props) {
  const [lines, setLines] = useState<DirectorLine[]>(() => [
    { id: createId("aimsg"), role: "system", text: SHELL_NOTICE },
  ]);
  const [draft, setDraft] = useState("");
  const [transactions, setTransactions] = useState<AITransaction[]>([]);
  const [busy, setBusy] = useState(false);
  const [prefs, setPrefs] = useState<AiPrefs>(() => readAiPrefs(storageOrNull()));
  const [apiKey, setApiKey] = useState("");
  const [keychain, setKeychain] = useState<OsKeychain>(() => memoryKeychain(BROWSER_KEYCHAIN_REASON));
  const abortRef = useRef<AbortController | null>(null);
  const keyRef = useRef("");
  keyRef.current = apiKey;

  useEffect(() => {
    if (!offer) return;
    setTransactions((current) => (current.some((txn) => txn.id === offer.id) ? current : [...current, offer]));
  }, [offer]);

  useEffect(() => {
    writeAiPrefs(prefs, storageOrNull());
  }, [prefs]);

  useEffect(() => {
    let cancelled = false;
    void detectOsKeychain().then((found) => {
      if (cancelled) return;
      if (found.available || found.reason !== BROWSER_KEYCHAIN_REASON) setKeychain(found);
      if (!found.available || !prefs.rememberKey) return;
      void found.read().then((stored) => {
        if (!cancelled && stored && keyRef.current.length === 0) setApiKey(stored);
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  function say(role: DirectorLine["role"], text: string) {
    setLines((current) => [...current, { id: createId("aimsg"), role, text }]);
  }

  async function onSend() {
    const text = draft.trim();
    if (!text || busy) return;
    say("user", text);
    setDraft("");
    setBusy(true);
    const abort = new AbortController();
    abortRef.current = abort;
    try {
      const provider =
        prefs.provider === "mock"
          ? createMockProvider()
          : createOpenAiCompatibleProvider({
              baseUrl: prefs.baseUrl,
              model: prefs.model,
              apiKey: prefs.provider === "cloud" ? apiKey : undefined,
            });
      const turn = await runDirectorTurn({ session, prompt: text, provider, signal: abort.signal });
      if (turn.transaction) {
        setTransactions((current) => [...current, turn.transaction!]);
      }
      say("assistant", turn.text);
    } finally {
      setBusy(false);
    }
  }

  function replaceTxn(next: AITransaction) {
    setTransactions((current) => current.map((txn) => (txn.id === next.id ? next : txn)));
  }

  function onAccept(id: string) {
    const txn = transactions.find((item) => item.id === id);
    if (!txn) return;
    let outcomeError: string | undefined;
    let outcomeTxn: AITransaction | undefined;
    applySession((current) => {
      const outcome = acceptTransaction(current, txn);
      outcomeError = outcome.error;
      outcomeTxn = outcome.transaction;
      return outcome.session;
    });
    if (outcomeTxn) replaceTxn(outcomeTxn);
    if (outcomeError) {
      say("assistant", outcomeError);
      return;
    }
    say("assistant", "Accepted. One undo step was added. Use the editor Undo button to restore the project.");
  }

  function onReject(id: string) {
    const txn = transactions.find((item) => item.id === id);
    if (!txn) return;
    let outcomeTxn: AITransaction | undefined;
    applySession((current) => {
      const outcome = rejectTransaction(current, txn);
      outcomeTxn = outcome.transaction;
      return outcome.session;
    });
    if (outcomeTxn) replaceTxn(outcomeTxn);
    say("assistant", "Rejected. The project was not changed.");
  }

  return (
    <DirectorPanel
      lines={lines}
      draft={draft}
      onDraft={setDraft}
      onSend={() => {
        void onSend();
      }}
      busy={busy}
      proposals={transactions.map(cardOf)}
      onAccept={onAccept}
      onReject={onReject}
      expanded={expanded}
      onToggleExpanded={onToggleExpanded}
      extra={
        <DirectorSettings
          prefs={prefs}
          apiKey={apiKey}
          onPrefs={(next) => {
            const previous = prefs.rememberKey;
            setPrefs(next);
            if (!keychain?.available) return;
            if (next.rememberKey && !previous) {
              const secret = apiKey.trim();
              if (secret) void keychain.write(secret);
            }
            if (!next.rememberKey && previous) void keychain.remove();
          }}
          onApiKey={(value) => {
            setApiKey(value);
            if (prefs.rememberKey && keychain?.available) {
              const secret = value.trim();
              if (secret) void keychain.write(secret);
              else void keychain.remove();
            }
          }}
          contextJson={JSON.stringify(buildSendContext(session), null, 2)}
          contextNote={
            prefs.provider === "mock"
              ? "This is the context Send would include. The mock provider does not receive it. Names are included. Paths and media are not."
              : "This is the context Send includes when you click Send. Names are included. Paths, media, and the API key are not."
          }
          keychainAvailable={keychain.available}
          keychainReason={keychain.reason}
        />
      }
    />
  );
}
