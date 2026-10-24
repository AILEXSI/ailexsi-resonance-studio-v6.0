import { useState } from "react";
import { createId } from "../../core/ids";
import { DirectorPanel, type DirectorLine } from "./DirectorPanel";

const SHELL_NOTICE =
  "AI Director shell. No model and no tools are connected. Sending a message does not change the project.";

/**
 * AI-1 shell. Local chat state only. No provider, no tools, no project access.
 */
export function DirectorShell() {
  const [lines, setLines] = useState<DirectorLine[]>(() => [
    { id: createId("aimsg"), role: "system", text: SHELL_NOTICE },
  ]);
  const [draft, setDraft] = useState("");

  function onSend() {
    const text = draft.trim();
    if (!text) return;
    setLines((current) => [
      ...current,
      { id: createId("aimsg"), role: "user", text },
      {
        id: createId("aimsg"),
        role: "assistant",
        text: "No model is connected. The project was not changed.",
      },
    ]);
    setDraft("");
  }

  return <DirectorPanel lines={lines} draft={draft} onDraft={setDraft} onSend={onSend} />;
}
