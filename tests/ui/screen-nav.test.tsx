import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../../src/app/App";
import { settleTimeline } from "../settle-timeline";
import { ScreenNav } from "../../src/ui/screens/ScreenNav";
import "../../src/styles.css";

describe("ScreenNav click + TAB", () => {
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

  it("items are buttons; click CUTTER shows cutter, click ARRANGE shows timeline", async () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(<App />);
    });
    await settleTimeline(host);
    const cutterBtn = host.querySelector<HTMLButtonElement>('[data-testid="screen-nav-cutter"]');
    const arrangeBtn = host.querySelector<HTMLButtonElement>('[data-testid="screen-nav-arrange"]');
    expect(cutterBtn?.tagName).toBe("BUTTON");
    expect(arrangeBtn?.tagName).toBe("BUTTON");
    expect(arrangeBtn?.getAttribute("data-active")).toBe("true");
    const toolbar = host.querySelector("[data-testid=toolbar]");
    const nav = host.querySelector("[data-testid=screen-nav]");
    expect(toolbar?.contains(nav)).toBe(true);
    expect(host.querySelector("[data-testid=stage]")?.contains(nav)).toBe(false);
    expect(host.querySelector(".app > .screen-nav")).toBeNull();
    expect(toolbar?.querySelector(".toolbar-file-row")?.contains(nav)).toBe(true);
    expect(host.querySelector("[data-testid=cutter]")).toBeNull();
    expect(host.querySelector("[data-testid=timeline]")).toBeTruthy();
    expect(host.querySelector("[data-testid=preview]")).toBeTruthy();
    expect(host.querySelector("[data-testid=lane-A1]")).toBeTruthy();
    expect(host.querySelector("[data-testid=lane-A2]")).toBeTruthy();

    await act(async () => {
      cutterBtn!.click();
    });
    expect(host.querySelector("[data-testid=preview]")).toBeTruthy();
    expect(host.querySelector("[data-testid=timeline]")).toBeTruthy();
    expect(host.querySelector("[data-testid=cutter]")).toBeTruthy();
    expect(host.querySelector("[data-testid=lane-V1]")).toBeTruthy();
    expect(host.querySelector("[data-testid=lane-V2]")).toBeTruthy();
    expect(host.querySelector("[data-testid=lane-VIS]")).toBeTruthy();
    expect(host.querySelector("[data-testid=lane-A1]")).toBeNull();
    expect(host.querySelector("[data-testid=lane-A2]")).toBeNull();
    expect(cutterBtn?.getAttribute("data-active")).toBe("true");
    expect(arrangeBtn?.getAttribute("data-active")).toBe("false");

    await act(async () => {
      arrangeBtn!.click();
    });
    expect(host.querySelector("[data-testid=cutter]")).toBeNull();
    expect(host.querySelector("[data-testid=timeline]")).toBeTruthy();
    expect(host.querySelector("[data-testid=preview]")).toBeTruthy();
    expect(host.querySelector("[data-testid=lane-A1]")).toBeTruthy();
    expect(host.querySelector("[data-testid=lane-A2]")).toBeTruthy();
    expect(arrangeBtn?.getAttribute("data-active")).toBe("true");
    expect(nav?.getAttribute("role")).toBe("group");
    expect(arrangeBtn?.className).toContain("screen-nav-item");
    expect(arrangeBtn?.className).toContain("on");
    expect(cutterBtn?.className).not.toContain("on");
  });

  it("TAB still cycles after a click; form focus does not", async () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(<App />);
    });
    await settleTimeline(host);
    await act(async () => {
      host!.querySelector<HTMLButtonElement>('[data-testid="screen-nav-cutter"]')!.click();
    });
    expect(host.querySelector("[data-testid=cutter]")).toBeTruthy();
    expect(host.querySelector("[data-testid=timeline]")).toBeTruthy();

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    });
    expect(host.querySelector("[data-testid=cutter]")).toBeNull();
    expect(host.querySelector("[data-testid=timeline]")).toBeTruthy();
    expect(host.querySelector("[data-testid=preview]")).toBeTruthy();

    const field = document.createElement("input");
    host.appendChild(field);
    field.focus();
    await act(async () => {
      field.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    });
    expect(host.querySelector("[data-testid=timeline]")).toBeTruthy();
    expect(host.querySelector("[data-testid=cutter]")).toBeNull();
  });

  it("ScreenNav buttons still call setScreen", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const seen: string[] = [];
    act(() => {
      root!.render(<ScreenNav screen="arrange" onSelect={(s) => seen.push(s)} />);
    });
    act(() => {
      host!.querySelector<HTMLButtonElement>('[data-testid="screen-nav-cutter"]')!.click();
    });
    expect(seen).toEqual(["cutter"]);
    act(() => {
      host!.querySelector<HTMLButtonElement>('[data-testid="screen-nav-arrange"]')!.click();
    });
    expect(seen).toEqual(["cutter", "arrange"]);
  });

  it("onSelect uses the same screen ids TAB uses", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const seen: string[] = [];
    act(() => {
      root!.render(<ScreenNav screen="arrange" onSelect={(s) => seen.push(s)} />);
    });
    act(() => {
      host!.querySelector<HTMLButtonElement>('[data-testid="screen-nav-cutter"]')!.click();
    });
    expect(seen).toEqual(["cutter"]);
  });
});
