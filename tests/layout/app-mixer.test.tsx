import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../../src/app/App";
import { settleTimeline } from "../settle-timeline";
import { MIXER_WIDTH_KEY } from "../../src/core/layout-prefs";
import "../../src/styles.css";

const Pointer = typeof PointerEvent === "undefined" ? MouseEvent : PointerEvent;

describe("App arrange layout", () => {
  let host: HTMLDivElement | undefined;
  let root: Root | undefined;

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    host?.remove();
    host = undefined;
    root = undefined;
    localStorage.removeItem(MIXER_WIDTH_KEY);
  });

  it("App mounts mixer beside the timeline and the Projekt panel", async () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(<App />);
    });
    await settleTimeline(host);
    const row = host.querySelector('[data-testid="arrange-row"]');
    const timeline = host.querySelector('[data-testid="timeline"]');
    const mixer = host.querySelector('[data-testid="mixer"]');
    expect(row && timeline && mixer).toBeTruthy();
    expect(row!.contains(timeline!)).toBe(true);
    expect(row!.contains(mixer!)).toBe(true);
    expect(timeline!.nextElementSibling).toBe(mixer);
    expect(getComputedStyle(mixer!).display).not.toBe("none");
    expect(getComputedStyle(mixer!).minWidth).not.toBe("0px");
    expect(host.querySelector('[data-testid="project-overlay"]')).toBeNull();
    expect(host.querySelector('[data-testid="project-file-panel"]')).toBeNull();
    expect(host.querySelector('[data-testid="layout-split"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="layout-split-grip"]')).toBeTruthy();
    expect(getComputedStyle(host.querySelector('[data-testid="layout-split"]')!).cursor).toBe("ns-resize");
    expect(host.querySelector('[data-testid="layout-split-h"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="layout-split-h-grip"]')).toBeTruthy();
    expect(getComputedStyle(host.querySelector('[data-testid="layout-split-h"]')!).cursor).toBe("ew-resize");
    expect(host.querySelector('[data-testid="mixer-collapse"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="mixer-resize"]')).toBeTruthy();
    expect(getComputedStyle(host.querySelector('[data-testid="mixer-resize"]')!).cursor).toBe("col-resize");
    expect(host.querySelector('[data-testid="preview-pane"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="workspace-preview"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="screen-nav"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="screen-nav"]')?.textContent).toMatch(/ARRANGE/);
    expect(host.querySelector('[data-testid="screen-nav"]')?.textContent).toMatch(/CUTTER/);
    expect(host.querySelector('[data-testid="cutter"]')).toBeNull();
  });

  it("writes mixer width to localStorage while dragging the left-edge divider", async () => {
    localStorage.removeItem(MIXER_WIDTH_KEY);
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(<App />);
    });
    const row = host.querySelector('[data-testid="arrange-row"]') as HTMLElement;
    row.getBoundingClientRect = () =>
      ({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 900,
        bottom: 400,
        width: 900,
        height: 400,
        toJSON() {
          return {};
        },
      }) as DOMRect;
    const divider = host.querySelector('[data-testid="mixer-resize"]') as HTMLElement;
    await act(async () => {
      divider.dispatchEvent(new Pointer("pointerdown", { bubbles: true, clientX: 500, button: 0 }));
    });
    expect(row.getAttribute("data-mixer-width")).toBe("400");
    expect(localStorage.getItem(MIXER_WIDTH_KEY)).toBe("400");
  });
});
