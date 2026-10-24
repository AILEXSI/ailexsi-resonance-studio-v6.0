import { act, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyCommand } from "../../src/app/commands";
import { AI_PREFS_KEY } from "../../src/app/ai/providers/prefs";
import { createSession, type Session } from "../../src/app/session";
import { createMemoryBlobStore } from "../../src/core/persistence";
import { DirectorController } from "../../src/ui/director/DirectorController";
import { asset, clip, projectWith } from "../helpers";

function sessionAt(): Session {
  const base = createSession(createMemoryBlobStore());
  return {
    ...base,
    selectedClipId: "c1",
    selectedClipIds: ["c1"],
    project: {
      ...projectWith(
        [clip({ id: "c1", assetId: "a", trackId: "A1", startMs: 30000, durationMs: 8000 })],
        [asset({ id: "a", kind: "audio", durationMs: 60000, name: "secret.wav", sourcePath: "/tmp/secret.wav" })],
      ),
      snap: true,
    },
  };
}

function typeInto(input: HTMLTextAreaElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  setter?.call(input, text);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("AI-5 send, accept, undo", () => {
  let host: HTMLDivElement | undefined;
  let root: Root | undefined;

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    host?.remove();
    host = undefined;
    root = undefined;
    localStorage.removeItem(AI_PREFS_KEY);
    vi.unstubAllGlobals();
  });

  it("proposes the German move from Send, accepts it, and undoes it", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const initial = sessionAt();
    function Direct() {
      const [session, setSession] = useState(initial);
      const ref = useRef(session);
      ref.current = session;
      return (
        <div>
          <span data-testid="start">{session.project.clips.find((item) => item.id === "c1")?.startMs}</span>
          <span data-testid="past">{session.history.past.length}</span>
          <button
            type="button"
            data-testid="editor-undo"
            onClick={() => {
              const next = applyCommand(ref.current, { type: "undo" });
              ref.current = next;
              setSession(next);
            }}
          >
            Undo
          </button>
          <DirectorController
            session={session}
            applySession={(update) => {
              const next = update(ref.current);
              ref.current = next;
              setSession(next);
            }}
          />
        </div>
      );
    }
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(<Direct />);
    });
    const input = host.querySelector('[data-testid="ai-director-input"]') as HTMLTextAreaElement;
    act(() => {
      typeInto(input, "Verschiebe den markierten Clip exakt zwei Sekunden nach rechts");
    });
    await act(async () => {
      (host!.querySelector('[data-testid="ai-director-send"]') as HTMLButtonElement).click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const accept = host.querySelector('[data-testid^="ai-proposal-accept-"]') as HTMLButtonElement | null;
    expect(accept).toBeTruthy();
    expect(host.textContent).toContain("moveClips");
    expect(host.textContent).toContain("2000");
    expect(host.querySelector('[data-testid="start"]')?.textContent).toBe("30000");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(localStorage.getItem(AI_PREFS_KEY)).not.toContain("apiKey");
    act(() => {
      accept!.click();
    });
    const view = host;
    if (!view) throw new Error("host missing");
    expect(view.querySelector('[data-testid="start"]')?.textContent).toBe("32000");
    expect(view.querySelector('[data-testid="past"]')?.textContent).toBe("1");
    act(() => {
      (view.querySelector('[data-testid="editor-undo"]') as HTMLButtonElement).click();
    });
    expect(view.querySelector('[data-testid="start"]')?.textContent).toBe("30000");
    expect(view.querySelector('[data-testid="past"]')?.textContent).toBe("0");
  });
});
