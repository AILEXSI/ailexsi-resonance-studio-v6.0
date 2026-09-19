/**
 * Human Gate Repair #2 — Director Focus full-height + Master-only mixer.
 * Layout is UI state only. Must not write Project / History / Revision.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../../src/app/App";
import { DIRECTOR_FLAG_KEY, setDirectorEnabledForTests } from "../../src/app/ai/flag";
import { PROJECT_SCHEMA_VERSION, serializeProject, createEmptyProject } from "../../src/core/project";
import {
  DIRECTOR_FOCUS_KEY,
  DIRECTOR_PRESENTATION_KEY,
  INSPECTOR_COLLAPSED_KEY,
  INSPECTOR_SECTION_COLLAPSED_KEY,
  MIXER_COLLAPSED_KEY,
} from "../../src/core/layout-prefs";
import "../../src/styles.css";

const VIEWPORTS = [
  { name: "5120x1440", width: 5120, height: 1440 },
  { name: "2560x1440", width: 2560, height: 1440 },
  { name: "1920x1080", width: 1920, height: 1080 },
  { name: "1366x768", width: 1366, height: 768 },
] as const;

const PREF_KEYS = [
  DIRECTOR_FLAG_KEY,
  DIRECTOR_FOCUS_KEY,
  DIRECTOR_PRESENTATION_KEY,
  INSPECTOR_COLLAPSED_KEY,
  INSPECTOR_SECTION_COLLAPSED_KEY,
  MIXER_COLLAPSED_KEY,
];

describe("Director Focus full-height layout", () => {
  let host: HTMLDivElement | undefined;
  let root: Root | undefined;

  beforeEach(() => {
    setDirectorEnabledForTests(null);
    for (const key of PREF_KEYS) localStorage.removeItem(key);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    host?.remove();
    host = undefined;
    root = undefined;
    setDirectorEnabledForTests(null);
    for (const key of PREF_KEYS) localStorage.removeItem(key);
    document.documentElement.style.width = "";
    document.documentElement.style.height = "";
    document.body.style.width = "";
    document.body.style.height = "";
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

  async function click(testId: string) {
    await act(async () => {
      (host!.querySelector(`[data-testid="${testId}"]`) as HTMLButtonElement).click();
    });
  }

  it("Focus uses full right-side height, Master only, and restores the mixer", async () => {
    await mountApp(1920, 1080);
    await click("toolbar-ai");
    expect(host!.querySelector('[data-testid="preview-pane"]')?.getAttribute("data-director-focus")).toBe("false");
    expect(host!.querySelector('[data-testid="mixer"]')?.getAttribute("data-master-only")).toBe("false");
    expect(host!.querySelector('[data-testid="mix-V1"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="mix-V2"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="mix-A1"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="mix-A2"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="mix-master"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="timeline"]')).toBeTruthy();

    await click("director-focus");
    const pane = host!.querySelector('[data-testid="preview-pane"]') as HTMLElement;
    const inspector = host!.querySelector('[data-testid="workspace-inspector"]') as HTMLElement;
    expect(pane.classList.contains("director-focus")).toBe(true);
    expect(pane.getAttribute("data-director-focus")).toBe("true");
    expect(inspector.getAttribute("data-director-focus")).toBe("true");
    expect(inspector.getAttribute("data-director-presentation")).toBe("focus");
    expect(host!.querySelector('[data-testid="director"]')?.getAttribute("data-focus")).toBe("true");
    expect(host!.querySelector('[data-testid="director-focus"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="director-input"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="director-send"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="director-compose"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="timeline"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="mixer"]')?.getAttribute("data-master-only")).toBe("true");
    expect(host!.querySelector('[data-testid="mixer"]')?.getAttribute("data-collapsed")).toBe("false");
    expect(host!.querySelector('[data-testid="arrange-row"]')?.getAttribute("data-mixer-master-only")).toBe("true");
    expect(host!.querySelector('[data-testid="mix-master"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="mix-V1"]')).toBeNull();
    expect(host!.querySelector('[data-testid="mix-V2"]')).toBeNull();
    expect(host!.querySelector('[data-testid="mix-A1"]')).toBeNull();
    expect(host!.querySelector('[data-testid="mix-A2"]')).toBeNull();
    expect(host!.querySelector('[data-testid="mixer-channel-scroll"]')).toBeNull();
    expect(localStorage.getItem(DIRECTOR_FOCUS_KEY)).toBe("1");
    expect(localStorage.getItem(MIXER_COLLAPSED_KEY)).not.toBe("1");

    await click("director-focus");
    expect(pane.getAttribute("data-director-focus")).toBe("false");
    expect(host!.querySelector('[data-testid="mixer"]')?.getAttribute("data-master-only")).toBe("false");
    expect(host!.querySelector('[data-testid="mix-V1"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="mix-V2"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="mix-A1"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="mix-A2"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="mix-master"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="timeline"]')).toBeTruthy();
    expect(localStorage.getItem(DIRECTOR_FOCUS_KEY)).toBe("0");
  });

  it.each(VIEWPORTS)(
    "viewport $name Focus ON/OFF: Arrange left, Master strip, composer reachable",
    async ({ width, height }) => {
      await mountApp(width, height);
      await click("toolbar-ai");
      expect(host!.querySelector('[data-testid="timeline"]')).toBeTruthy();
      expect(host!.querySelector('[data-testid="mix-V1"]')).toBeTruthy();
      expect(host!.querySelector('[data-testid="director-compose"]')).toBeTruthy();

      await click("director-focus");
      expect(host!.querySelector('[data-testid="preview-pane"]')?.getAttribute("data-director-focus")).toBe("true");
      expect(host!.querySelector('[data-testid="timeline"]')).toBeTruthy();
      expect(host!.querySelector('[data-testid="mix-master"]')).toBeTruthy();
      expect(host!.querySelector('[data-testid="mix-V1"]')).toBeNull();
      expect(host!.querySelector('[data-testid="director-input"]')).toBeTruthy();
      expect(host!.querySelector('[data-testid="director-send"]')).toBeTruthy();
      expect(host!.querySelector('[data-testid="director-focus"]')).toBeTruthy();

      await click("director-focus");
      expect(host!.querySelector('[data-testid="preview-pane"]')?.getAttribute("data-director-focus")).toBe("false");
      expect(host!.querySelector('[data-testid="mix-V1"]')).toBeTruthy();
      expect(host!.querySelector('[data-testid="mix-master"]')).toBeTruthy();
    },
  );

  it("Focus layout never writes Project / history / revision / schema", async () => {
    const empty = createEmptyProject();
    expect(empty.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    await mountApp();
    await click("toolbar-ai");
    await click("director-focus");
    await click("director-focus");
    expect(host!.querySelector('[data-testid="project-dirty"]')).toBeNull();
    const dumped = JSON.parse(serializeProject(empty)) as Record<string, unknown>;
    expect(dumped.schemaVersion).toBe(5);
    expect(dumped).not.toHaveProperty("director");
    expect(dumped).not.toHaveProperty("directorFocus");
    expect(JSON.stringify(dumped)).not.toMatch(/director-focus|master-only|stage-grid/);
  });
});
