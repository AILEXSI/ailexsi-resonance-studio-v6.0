import { act, useRef, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { applyCommand } from "../../src/app/commands";
import { dispatchTool } from "../../src/app/ai/orchestrator";
import type { AITransaction } from "../../src/app/ai/transactions";
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
        [asset({ id: "a", kind: "audio", durationMs: 60000 })],
      ),
      snap: true,
    },
  };
}

function proposalFor(session: Session): AITransaction {
  const dispatched = dispatchTool(
    session,
    "timeline.move_clip",
    { deltaSeconds: 2 },
    "Verschiebe den markierten Clip exakt zwei Sekunden nach rechts",
  );
  if (dispatched.kind !== "proposal") throw new Error("expected proposal");
  return dispatched.transaction;
}

describe("AI-4 accept and reject in the panel", () => {
  let host: HTMLDivElement | undefined;
  let root: Root | undefined;

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    host?.remove();
    host = undefined;
    root = undefined;
  });

  function mount(node: ReactNode) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root!.render(node);
    });
  }

  it("accepts a +2s proposal and the editor undo restores the clip", () => {
    const initial = sessionAt();
    const txn = proposalFor(initial);
    function Direct() {
      const [session, setSession] = useState(initial);
      const ref = useRef(session);
      ref.current = session;
      return (
        <div>
          <span data-testid="start">{session.project.clips.find((clip) => clip.id === "c1")?.startMs}</span>
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
            offer={txn}
            applySession={(update) => {
              const next = update(ref.current);
              ref.current = next;
              setSession(next);
            }}
          />
        </div>
      );
    }
    mount(<Direct />);
    expect(host!.querySelector('[data-testid="start"]')?.textContent).toBe("30000");
    act(() => {
      (host!.querySelector(`[data-testid="ai-proposal-accept-${txn.id}"]`) as HTMLButtonElement).click();
    });
    expect(host!.querySelector('[data-testid="start"]')?.textContent).toBe("32000");
    expect(host!.querySelector('[data-testid="past"]')?.textContent).toBe("1");
    expect(host!.querySelector(`[data-testid="ai-proposal-${txn.id}"]`)?.getAttribute("data-status")).toBe(
      "executed",
    );
    expect(host!.textContent).toContain("One undo step");
    act(() => {
      (host!.querySelector('[data-testid="editor-undo"]') as HTMLButtonElement).click();
    });
    expect(host!.querySelector('[data-testid="start"]')?.textContent).toBe("30000");
    expect(host!.querySelector('[data-testid="past"]')?.textContent).toBe("0");
  });

  it("rejects a proposal without moving the clip", () => {
    const initial = sessionAt();
    const txn = proposalFor(initial);
    function Direct() {
      const [session, setSession] = useState(initial);
      const ref = useRef(session);
      ref.current = session;
      return (
        <div>
          <span data-testid="start">{session.project.clips.find((clip) => clip.id === "c1")?.startMs}</span>
          <DirectorController
            session={session}
            offer={txn}
            applySession={(update) => {
              const next = update(ref.current);
              ref.current = next;
              setSession(next);
            }}
          />
        </div>
      );
    }
    mount(<Direct />);
    act(() => {
      (host!.querySelector(`[data-testid="ai-proposal-reject-${txn.id}"]`) as HTMLButtonElement).click();
    });
    expect(host!.querySelector('[data-testid="start"]')?.textContent).toBe("30000");
    expect(host!.querySelector(`[data-testid="ai-proposal-${txn.id}"]`)?.getAttribute("data-status")).toBe(
      "rejected",
    );
    expect(host!.textContent).toContain("The project was not changed.");
  });
});
