import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../../src/app/App";
import {
  DIRECTOR_FLAG_KEY,
  setDirectorEnabledForTests,
} from "../../src/app/ai/flag";
import { serializeProject, PROJECT_SCHEMA_VERSION, createEmptyProject } from "../../src/core/project";
import { INSPECTOR_COLLAPSED_KEY } from "../../src/core/layout-prefs";
import "../../src/styles.css";

const VIEWPORTS = [
  { name: "5120x1440", width: 5120, height: 1440 },
  { name: "2560x1440", width: 2560, height: 1440 },
  { name: "1920x1080", width: 1920, height: 1080 },
  { name: "1366x768", width: 1366, height: 768 },
] as const;

function loadStylesCss(): string {
  const proc = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }).process;
  const fs = proc?.getBuiltinModule?.("node:fs") as
    | { readFileSync(path: string, encoding: string): string }
    | undefined;
  const path = proc?.getBuiltinModule?.("node:path") as
    | { join(...parts: string[]): string; dirname(p: string): string }
    | undefined;
  const url = proc?.getBuiltinModule?.("node:url") as { fileURLToPath(u: string): string } | undefined;
  if (!fs || !path || !url) return "";
  return fs.readFileSync(path.join(path.dirname(url.fileURLToPath(import.meta.url)), "../../src/styles.css"), "utf8");
}

const stylesCss = loadStylesCss();

function cssRule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = stylesCss.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`));
  expect(match, `missing CSS rule ${selector}`).toBeTruthy();
  return match![1]!.replace(/\s+/g, " ");
}

describe("AI Director sidebar layout hardening", () => {
  let host: HTMLDivElement | undefined;
  let root: Root | undefined;
  let fetchCalls = 0;
  let originalFetch: typeof globalThis.fetch | undefined;

  beforeEach(() => {
    setDirectorEnabledForTests(null);
    localStorage.removeItem(DIRECTOR_FLAG_KEY);
    localStorage.removeItem(INSPECTOR_COLLAPSED_KEY);
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
    document.documentElement.style.width = "";
    document.documentElement.style.height = "";
    document.body.style.width = "";
    document.body.style.height = "";
    if (originalFetch) globalThis.fetch = originalFetch;
    originalFetch = undefined;
  });

  async function mountApp(width = 1920, height = 1080) {
    document.documentElement.style.width = `${width}px`;
    document.documentElement.style.height = `${height}px`;
    document.body.style.width = `${width}px`;
    document.body.style.height = `${height}px`;
    host = document.createElement("div");
    host.style.width = `${width}px`;
    host.style.height = `${height}px`;
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

  function directorControls() {
    return {
      status: host!.querySelector('[data-testid="director-status"]'),
      provider: host!.querySelector('[data-testid="director-provider"]'),
      providerSelect: host!.querySelector('[data-testid="director-provider-select"]'),
      mode: host!.querySelector('[data-testid="director-mode-select"]'),
      grant: host!.querySelector('[data-testid="director-grant-select"]'),
      context: host!.querySelector('[data-testid="director-context-level"]'),
      messages: host!.querySelector('[data-testid="director-messages"]'),
      compose: host!.querySelector('[data-testid="director-compose"]'),
      input: host!.querySelector('[data-testid="director-input"]'),
      send: host!.querySelector('[data-testid="director-send"]'),
    };
  }

  it("CSS keeps Director on its own viewport so Inspector cannot starve it", () => {
    const sidebar = cssRule(".inspector-body.director-open");
    expect(sidebar).toMatch(/display:\s*grid/);
    expect(sidebar).toMatch(/minmax\(64px,\s*28%\)/);
    expect(sidebar).toMatch(/minmax\(180px,\s*1fr\)/);

    expect(cssRule(".inspector-body")).toMatch(/overflow:\s*hidden/);
    expect(cssRule(".inspector-body")).toMatch(/min-height:\s*0/);
    expect(cssRule(".inspector-section")).toMatch(/overflow:\s*auto/);
    expect(cssRule(".inspector-body.director-open .inspector-section")).toMatch(/overflow:\s*auto/);
    expect(cssRule(".director-section")).toMatch(/overflow:\s*hidden/);
    expect(cssRule(".director-section")).toMatch(/min-height:\s*0/);
    expect(cssRule(".director")).toMatch(/overflow:\s*hidden/);
    expect(cssRule(".director")).toMatch(/min-height:\s*0/);
    expect(cssRule(".director-body")).toMatch(/overflow-y:\s*hidden/);
    expect(cssRule(".director-chrome")).toMatch(/overflow-y:\s*auto/);
    expect(cssRule(".director-scroll")).toMatch(/overflow-y:\s*auto/);
    expect(cssRule(".director-messages")).toMatch(/overflow:\s*auto/);

    const compose = cssRule(".director-compose");
    expect(compose).toMatch(/position:\s*sticky/);
    expect(compose).toMatch(/bottom:\s*0/);
    expect(compose).toMatch(/flex:\s*0 0 auto/);

    expect(cssRule(".app")).toMatch(/overflow:\s*hidden/);
    expect(stylesCss).not.toMatch(/\.workspace-inspector \.director \{[^}]*max-height:\s*48%/);
  });

  it("opens a dedicated Director viewport with internal scroll and sticky composer", async () => {
    await mountApp();
    expect(host!.querySelector('[data-testid="inspector"]')).toBeTruthy();
    await clickAi();

    const body = host!.querySelector('[data-testid="inspector-body"]') as HTMLElement;
    const inspectorSection = host!.querySelector('[data-testid="inspector-section"]') as HTMLElement;
    const directorSection = host!.querySelector('[data-testid="director-section"]') as HTMLElement;
    const director = host!.querySelector('[data-testid="director"]') as HTMLElement;
    const directorBody = host!.querySelector('[data-testid="director-body"]') as HTMLElement;
    const directorScroll = host!.querySelector('[data-testid="director-scroll"]') as HTMLElement;
    const compose = host!.querySelector('[data-testid="director-compose"]') as HTMLElement;

    expect(body.classList.contains("director-open")).toBe(true);
    expect(body.getAttribute("data-director-open")).toBe("true");
    expect(host!.querySelector('[data-testid="workspace-inspector"]')?.getAttribute("data-director-open")).toBe(
      "true",
    );
    expect(inspectorSection.contains(host!.querySelector('[data-testid="inspector"]'))).toBe(true);
    expect(directorSection.contains(director)).toBe(true);
    expect(body.contains(inspectorSection)).toBe(true);
    expect(body.contains(directorSection)).toBe(true);
    expect(inspectorSection.contains(director)).toBe(false);
    expect(directorScroll.contains(host!.querySelector('[data-testid="director-messages"]'))).toBe(true);
    expect(directorBody.lastElementChild).toBe(compose);

    const controls = directorControls();
    for (const [name, el] of Object.entries(controls)) {
      expect(el, name).toBeTruthy();
      expect(director.contains(el), name).toBe(true);
    }
    const chrome = host!.querySelector('[data-testid="director-chrome"]') as HTMLElement;
    expect(chrome.contains(controls.status)).toBe(true);
    expect(chrome.contains(controls.providerSelect)).toBe(true);
    expect(chrome.contains(controls.mode)).toBe(true);
    expect(chrome.contains(controls.grant)).toBe(true);
    expect(chrome.contains(controls.context)).toBe(true);
    expect(directorScroll.contains(controls.providerSelect)).toBe(false);
    expect(directorScroll.contains(controls.messages)).toBe(true);
    expect(directorBody.contains(controls.status)).toBe(true);
    expect(directorScroll.contains(controls.status)).toBe(false);
    expect(directorScroll.contains(controls.compose)).toBe(false);
    expect(directorBody.contains(controls.messages)).toBe(true);
    expect(directorBody.contains(controls.compose)).toBe(true);
    expect(host!.querySelector('[data-testid="director-split"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="director-focus"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="inspector-section-collapse"]')).toBeTruthy();
  });

  it("keeps Inspector mounted and capped so it cannot starve Director", async () => {
    await mountApp();
    const inspector = host!.querySelector('[data-testid="inspector"]');
    expect(inspector).toBeTruthy();
    await clickAi();
    expect(host!.querySelector('[data-testid="inspector"]')).toBe(inspector);
    expect(host!.querySelector('[data-testid="inspector-body"]')?.classList.contains("director-open")).toBe(
      true,
    );
    expect(cssRule(".inspector-body.director-open")).toMatch(/minmax\(180px,\s*1fr\)/);
  });

  it("syncs Director Close with the toolbar AI toggle", async () => {
    await mountApp();
    await clickAi();
    expect(host!.querySelector('[data-testid="director"]')).toBeTruthy();
    expect(aiButton().getAttribute("aria-pressed")).toBe("true");

    await act(async () => {
      (host!.querySelector('[data-testid="director-toggle"]') as HTMLButtonElement).click();
    });
    expect(host!.querySelector('[data-testid="director"]')).toBeNull();
    expect(aiButton().getAttribute("aria-pressed")).toBe("false");
    expect(aiButton().classList.contains("active")).toBe(false);
    expect(localStorage.getItem(DIRECTOR_FLAG_KEY)).toBeNull();

    await clickAi();
    expect(host!.querySelector('[data-testid="director"]')).toBeTruthy();
    expect(aiButton().getAttribute("aria-pressed")).toBe("true");
  });

  it("keeps INS working while Director is open without destroying Inspector", async () => {
    await mountApp();
    await clickAi();
    expect(host!.querySelector('[data-testid="inspector"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="director"]')).toBeTruthy();

    await act(async () => {
      (host!.querySelector('[data-testid="inspector-collapse"]') as HTMLButtonElement).click();
    });
    expect(host!.querySelector('[data-testid="workspace-inspector"]')?.getAttribute("data-collapsed")).toBe(
      "true",
    );
    expect(host!.querySelector('[data-testid="inspector"]')).toBeNull();
    expect(host!.querySelector('[data-testid="director"]')).toBeNull();
    expect(aiButton().getAttribute("aria-pressed")).toBe("true");

    await act(async () => {
      (host!.querySelector('[data-testid="inspector-collapse"]') as HTMLButtonElement).click();
    });
    expect(host!.querySelector('[data-testid="workspace-inspector"]')?.getAttribute("data-collapsed")).toBe(
      "false",
    );
    expect(host!.querySelector('[data-testid="inspector"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="director"]')).toBeTruthy();
    expect(aiButton().getAttribute("aria-pressed")).toBe("true");
  });

  it.each(VIEWPORTS)(
    "exposes Director chrome at $name without depending on the page scrollbar",
    async ({ width, height }) => {
      await mountApp(width, height);
      await clickAi();
      const controls = directorControls();
      for (const [name, el] of Object.entries(controls)) {
        expect(el, `${name} @ ${width}x${height}`).toBeTruthy();
      }
      expect(host!.querySelector('[data-testid="director-txn"]')).toBeNull();
      expect(host!.querySelector('[data-testid="inspector-body"]')?.classList.contains("director-open")).toBe(
        true,
      );
      expect(host!.querySelector('[data-testid="director-scroll"]')).toBeTruthy();
      expect(host!.querySelector('[data-testid="director-body"]')?.lastElementChild).toBe(
        host!.querySelector('[data-testid="director-compose"]'),
      );
    },
  );

  it("open/close layout does not mutate Project, schema, or issue a provider request", async () => {
    const empty = createEmptyProject();
    expect(empty.schemaVersion).toBe(5);
    expect(PROJECT_SCHEMA_VERSION).toBe(5);
    expect(JSON.parse(serializeProject(empty)).schemaVersion).toBe(5);

    await mountApp();
    const statusBefore = host!.querySelector('[data-testid="status"]')?.textContent;
    expect(host!.querySelector('[data-testid="project-dirty"]')).toBeNull();
    expect(fetchCalls).toBe(0);

    await clickAi();
    await act(async () => {
      (host!.querySelector('[data-testid="director-toggle"]') as HTMLButtonElement).click();
    });
    await clickAi();

    expect(host!.querySelector('[data-testid="status"]')?.textContent).toBe(statusBefore);
    expect(host!.querySelector('[data-testid="project-dirty"]')).toBeNull();
    expect(PROJECT_SCHEMA_VERSION).toBe(5);
    expect(fetchCalls).toBe(0);
  });
});
