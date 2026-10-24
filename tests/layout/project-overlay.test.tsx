import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../../src/app/App";
import { settleTimeline } from "../settle-timeline";
import "../../src/styles.css";

describe("Projekt overlay", () => {
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

  async function mount() {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(<App />);
    });
    await settleTimeline(host);
  }

  it("is closed by default; File toggles it; Esc and Close dismiss; Arrange stays reachable", async () => {
    await mount();
    expect(host!.querySelector('[data-testid="project-overlay"]')).toBeNull();
    expect(host!.querySelector('[data-testid="project-file-panel"]')).toBeNull();
    expect(host!.querySelector('[data-testid="workspace-preview"]')).toBeTruthy();
    expect(host!.querySelector(".workspace-left")).toBeNull();

    await act(async () => {
      (host!.querySelector('[data-testid="toolbar-file"]') as HTMLButtonElement).click();
    });
    expect(host!.querySelector('[data-testid="project-overlay"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="project-file-panel"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="project-overlay"]')?.classList.contains("pass-through")).toBe(
      true,
    );

    await act(async () => {
      (host!.querySelector('[data-testid="toolbar-file"]') as HTMLButtonElement).click();
    });
    expect(host!.querySelector('[data-testid="project-overlay"]')).toBeNull();

    await act(async () => {
      (host!.querySelector('[data-testid="toolbar-file"]') as HTMLButtonElement).click();
    });
    expect(host!.querySelector('[data-testid="project-overlay"]')).toBeTruthy();

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(host!.querySelector('[data-testid="project-overlay"]')).toBeNull();

    await act(async () => {
      (host!.querySelector('[data-testid="toolbar-file"]') as HTMLButtonElement).click();
    });
    expect(host!.querySelector('[data-testid="project-overlay"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="media-browser"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="timeline"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="project-choose-folder"]')).toBeNull();
    expect(host!.querySelector('[data-testid="revert-project"]')).toBeNull();
    expect(host!.querySelector('[data-testid="import-input-panel"]')).toBeNull();
    expect(host!.querySelector('[data-testid="save-project"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="project-save-as"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="open-fsa"]')).toBeTruthy();

    await act(async () => {
      (host!.querySelector('[data-testid="project-overlay-close"]') as HTMLButtonElement).click();
    });
    expect(host!.querySelector('[data-testid="project-overlay"]')).toBeNull();
  });
});
