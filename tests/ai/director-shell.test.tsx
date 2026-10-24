import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../../src/app/App";
import { AI_DIRECTOR_FLAG_KEY } from "../../src/app/ai/flag";
import { createSession } from "../../src/app/session";
import { PROJECT_SCHEMA_VERSION } from "../../src/core/project";
import { DirectorShell } from "../../src/ui/director/DirectorShell";
import "../../src/styles.css";

describe("AI-1 Director shell", () => {
  let host: HTMLDivElement | undefined;
  let root: Root | undefined;

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    host?.remove();
    host = undefined;
    root = undefined;
    localStorage.removeItem(AI_DIRECTOR_FLAG_KEY);
  });

  function mount(node: ReactNode) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root!.render(node);
    });
  }

  it("shows chat and proposal placeholders and has no project to mutate", () => {
    const before = createSession();
    const snapshot = structuredClone(before.project);
    mount(<DirectorShell />);
    expect(host!.querySelector('[data-testid="ai-director"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="ai-director-empty"]')?.textContent).toMatch(/No proposals/);
    expect(host!.textContent).toContain("No model and no tools");
    const send = host!.querySelector('[data-testid="ai-director-send"]') as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    expect(before.project).toEqual(snapshot);
    expect(before.project.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(before.history.past).toHaveLength(0);
  });

  it("appends a no-model reply when Send is clicked", () => {
    mount(<DirectorShell />);
    const input = host!.querySelector('[data-testid="ai-director-input"]') as HTMLTextAreaElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(input, "hello");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const send = host!.querySelector('[data-testid="ai-director-send"]') as HTMLButtonElement;
    expect(send.disabled).toBe(false);
    act(() => {
      send.click();
    });
    const log = host!.querySelector('[data-testid="ai-director-log"]')?.textContent ?? "";
    expect(log).toContain("hello");
    expect(log).toContain("The project was not changed.");
    expect(host!.querySelector('[data-testid="ai-director-empty"]')).toBeTruthy();
  });
});

describe("AI-1 Director flag in the app shell", () => {
  let host: HTMLDivElement | undefined;
  let root: Root | undefined;

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    host?.remove();
    host = undefined;
    root = undefined;
    localStorage.removeItem(AI_DIRECTOR_FLAG_KEY);
  });

  async function flushLazy() {
    if (localStorage.getItem(AI_DIRECTOR_FLAG_KEY) !== "1") return;
    for (let i = 0; i < 25; i += 1) {
      if (host?.querySelector('[data-testid="ai-director"]')) return;
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
    }
  }

  async function mountApp() {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(<App />);
    });
    await flushLazy();
  }

  it("keeps the director out of the inspector until the flag is turned on", async () => {
    await mountApp();
    expect(host!.querySelector('[data-testid="ai-director"]')).toBeNull();
    expect(host!.querySelector('[data-testid="inspector"]')).toBeTruthy();
    await act(async () => {
      (host!.querySelector('[data-testid="ai-director-toggle"]') as HTMLButtonElement).click();
    });
    await flushLazy();
    expect(localStorage.getItem(AI_DIRECTOR_FLAG_KEY)).toBe("1");
    expect(host!.querySelector('[data-testid="ai-director"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="ai-director-empty"]')?.textContent).toMatch(/No proposals/);
    await act(async () => {
      (host!.querySelector('[data-testid="ai-director-toggle"]') as HTMLButtonElement).click();
    });
    expect(localStorage.getItem(AI_DIRECTOR_FLAG_KEY)).toBe("0");
    expect(host!.querySelector('[data-testid="ai-director"]')).toBeNull();
    expect(host!.querySelector('[data-testid="inspector"]')).toBeTruthy();
  });
});
