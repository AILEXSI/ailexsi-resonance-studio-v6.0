import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../../src/app/App";
import {
  DIRECTOR_FLAG_KEY,
  isDirectorEnabled,
  persistDirectorEnabled,
  setDirectorEnabledForTests,
} from "../../src/app/ai/flag";
import { serializeProject, PROJECT_SCHEMA_VERSION, createEmptyProject } from "../../src/core/project";
import { INSPECTOR_COLLAPSED_KEY } from "../../src/core/layout-prefs";
import "../../src/styles.css";

describe("AI Director visible UI toggle", () => {
  let host: HTMLDivElement | undefined;
  let root: Root | undefined;
  let fetchCalls = 0;
  let originalFetch: typeof globalThis.fetch | undefined;
  let originalSearch: string;

  beforeEach(() => {
    setDirectorEnabledForTests(null);
    localStorage.removeItem(DIRECTOR_FLAG_KEY);
    localStorage.removeItem(INSPECTOR_COLLAPSED_KEY);
    originalSearch = window.location.search;
    window.history.replaceState({}, "", window.location.pathname);
    fetchCalls = 0;
    originalFetch = globalThis.fetch;
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls += 1;
      return originalFetch!(input, init);
    }) as typeof fetch;
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    host?.remove();
    host = undefined;
    root = undefined;
    setDirectorEnabledForTests(null);
    localStorage.removeItem(DIRECTOR_FLAG_KEY);
    localStorage.removeItem(INSPECTOR_COLLAPSED_KEY);
    window.history.replaceState({}, "", `${window.location.pathname}${originalSearch}`);
    if (originalFetch) globalThis.fetch = originalFetch;
    originalFetch = undefined;
  });

  async function mountApp() {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(<App />);
    });
  }

  async function remountApp() {
    await act(async () => {
      root?.unmount();
    });
    host?.remove();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(<App />);
    });
  }

  function aiButton(): HTMLButtonElement {
    return host!.querySelector('[data-testid="toolbar-ai"]') as HTMLButtonElement;
  }

  async function clickAi() {
    await act(async () => {
      aiButton().click();
    });
  }

  it("1 defaults OFF on a clean preference", async () => {
    expect(localStorage.getItem(DIRECTOR_FLAG_KEY)).toBeNull();
    expect(isDirectorEnabled({ search: "", storage: localStorage })).toBe(false);
    await mountApp();
    expect(aiButton()).toBeTruthy();
    expect(aiButton().textContent?.trim()).toBe("AI");
    expect(aiButton().getAttribute("aria-pressed")).toBe("false");
    expect(aiButton().classList.contains("active")).toBe(false);
    expect(host!.querySelector('[data-testid="director"]')).toBeNull();
    const row = host!.querySelector(".toolbar-file-row");
    const labels = [...(row?.querySelectorAll("button") ?? [])].map((b) =>
      b.textContent?.replace(/\s+/g, " ").trim(),
    );
    expect(labels).toEqual(["Import", "Export", "ARRANGE", "CUTTER", "AI"]);
    expect(host!.querySelector('[data-testid="toolbar-file"]')?.textContent?.trim()).toBe("File");
  });

  it("2/3/4 click opens Director, click again closes, active state follows", async () => {
    await mountApp();
    expect(host!.querySelector('[data-testid="director"]')).toBeNull();

    await clickAi();
    const director = host!.querySelector('[data-testid="director"]');
    expect(director).toBeTruthy();
    expect(host!.querySelector("#inspector-body")?.contains(director)).toBe(true);
    expect(aiButton().getAttribute("aria-pressed")).toBe("true");
    expect(aiButton().classList.contains("active")).toBe(true);

    await clickAi();
    expect(host!.querySelector('[data-testid="director"]')).toBeNull();
    expect(aiButton().getAttribute("aria-pressed")).toBe("false");
    expect(aiButton().classList.contains("active")).toBe(false);
  });

  it("5/6 preference is persisted and remount restores it", async () => {
    await mountApp();
    await clickAi();
    expect(localStorage.getItem(DIRECTOR_FLAG_KEY)).toBe("1");
    expect(isDirectorEnabled({ search: "", storage: localStorage })).toBe(true);

    await remountApp();
    expect(host!.querySelector('[data-testid="director"]')).toBeTruthy();
    expect(aiButton().getAttribute("aria-pressed")).toBe("true");
    expect(aiButton().classList.contains("active")).toBe(true);

    await clickAi();
    expect(localStorage.getItem(DIRECTOR_FLAG_KEY)).toBeNull();
    await remountApp();
    expect(host!.querySelector('[data-testid="director"]')).toBeNull();
    expect(aiButton().getAttribute("aria-pressed")).toBe("false");
  });

  it("7 opening AI while Inspector is collapsed expands Inspector", async () => {
    await mountApp();
    await act(async () => {
      (host!.querySelector('[data-testid="inspector-collapse"]') as HTMLButtonElement).click();
    });
    expect(host!.querySelector('[data-testid="inspector"]')).toBeNull();
    expect(host!.querySelector('[data-testid="director"]')).toBeNull();
    expect(host!.querySelector('[data-testid="workspace-inspector"]')?.getAttribute("data-collapsed")).toBe(
      "true",
    );

    await clickAi();
    expect(host!.querySelector('[data-testid="workspace-inspector"]')?.getAttribute("data-collapsed")).toBe(
      "false",
    );
    expect(host!.querySelector('[data-testid="inspector"]')).toBeTruthy();
    const director = host!.querySelector('[data-testid="director"]');
    expect(director).toBeTruthy();
    expect(host!.querySelector("#inspector-body")?.contains(director)).toBe(true);
    expect(localStorage.getItem(INSPECTOR_COLLAPSED_KEY)).toBe("0");
  });

  it("8 AI OFF preserves normal V6 chrome", async () => {
    await mountApp();
    expect(host!.querySelector('[data-testid="director"]')).toBeNull();
    expect(host!.querySelector('[data-testid="inspector"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="timeline"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="preview"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="mixer"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="screen-nav"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="toolbar"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="status"]')?.textContent).toMatch(/New project/);
  });

  it("9/10/12 open/close does not mutate Project, history, or schema 5", async () => {
    const empty = createEmptyProject();
    expect(empty.schemaVersion).toBe(5);
    expect(PROJECT_SCHEMA_VERSION).toBe(5);
    expect(JSON.parse(serializeProject(empty)).schemaVersion).toBe(5);
    const dumped = JSON.parse(serializeProject(empty)) as Record<string, unknown>;
    expect(dumped).not.toHaveProperty("conversation");
    expect(dumped).not.toHaveProperty("director");
    expect(dumped).not.toHaveProperty("ai");

    await mountApp();
    const statusBefore = host!.querySelector('[data-testid="status"]')?.textContent;
    const nameBefore = host!.querySelector<HTMLInputElement>('[data-testid="project-name"]')?.value;
    expect(host!.querySelector('[data-testid="project-dirty"]')).toBeNull();

    await clickAi();
    await clickAi();

    expect(host!.querySelector('[data-testid="status"]')?.textContent).toBe(statusBefore);
    expect(host!.querySelector<HTMLInputElement>('[data-testid="project-name"]')?.value).toBe(nameBefore);
    expect(host!.querySelector('[data-testid="project-dirty"]')).toBeNull();
    expect(PROJECT_SCHEMA_VERSION).toBe(5);

    await act(async () => {
      (host!.querySelector('[data-testid="transport-undo"]') as HTMLButtonElement).click();
    });
    expect(host!.querySelector('[data-testid="status"]')?.textContent).toMatch(/Nothing to undo/);
  });

  it("11 opening Director does not issue a provider request", async () => {
    await mountApp();
    expect(fetchCalls).toBe(0);
    await clickAi();
    expect(host!.querySelector('[data-testid="director"]')).toBeTruthy();
    expect(fetchCalls).toBe(0);
    await clickAi();
    expect(fetchCalls).toBe(0);
  });

  it("keeps ?ai=1 support for dev/testing", async () => {
    window.history.replaceState({}, "", `${window.location.pathname}?ai=1`);
    await mountApp();
    expect(host!.querySelector('[data-testid="director"]')).toBeTruthy();
    expect(aiButton().getAttribute("aria-pressed")).toBe("true");
  });

  it("persistDirectorEnabled writes 1 and removes the key", () => {
    const map = new Map<string, string>();
    const storage = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => {
        map.set(k, v);
      },
      removeItem: (k: string) => {
        map.delete(k);
      },
    };
    persistDirectorEnabled(true, storage);
    expect(map.get(DIRECTOR_FLAG_KEY)).toBe("1");
    expect(isDirectorEnabled({ search: "", storage })).toBe(true);
    persistDirectorEnabled(false, storage);
    expect(map.has(DIRECTOR_FLAG_KEY)).toBe(false);
    expect(isDirectorEnabled({ search: "", storage })).toBe(false);
  });
});
