import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../../src/app/App";
import { applyCommand } from "../../src/app/commands";
import { createSession, type Session } from "../../src/app/session";
import {
  applyHostApproved,
  createDirectorHostState,
  rejectHostTransaction,
  type DirectorHostState,
} from "../../src/app/ai/host";
import { DIRECTOR_FLAG_KEY, setDirectorEnabledForTests } from "../../src/app/ai/flag";
import { GOLDEN_MOVE_PROMPT } from "../../src/app/ai/tools/move-clip";
import { createOrchestrator } from "../../src/app/ai/orchestrator";
import { createMockProvider } from "../../src/app/ai/providers/mock";
import { submitDirectorProviderTurn } from "../../src/app/ai/host";
import { PROJECT_SCHEMA_VERSION, serializeProject, createEmptyProject } from "../../src/core/project";
import {
  DEFAULT_DIRECTOR_FOCUS_H_SPLIT,
  DEFAULT_DIRECTOR_FOCUS_RATIO,
  DIRECTOR_COMPOSER_HEIGHT_KEY,
  DIRECTOR_DIAGNOSTICS_COLLAPSED_KEY,
  DIRECTOR_FOCUS_H_SPLIT_KEY,
  DIRECTOR_FOCUS_KEY,
  DIRECTOR_FOCUS_RATIO_MAX,
  DIRECTOR_FOCUS_RATIO_MIN,
  DIRECTOR_PRESENTATION_KEY,
  DIRECTOR_SPLIT_RATIO_KEY,
  DIRECTOR_WORK_SPLIT_KEY,
  H_SPLIT_RATIO_KEY,
  INSPECTOR_COLLAPSED_KEY,
  INSPECTOR_COLLAPSED_PX,
  INSPECTOR_MAX_PX,
  INSPECTOR_SECTION_COLLAPSED_KEY,
  clampFocusHSplitRatio,
  directorPresentationOf,
} from "../../src/core/layout-prefs";
import { createMemoryBlobStore } from "../../src/core/persistence";
import { DirectorPanel } from "../../src/ui/director/DirectorPanel";
import { asset, clip, projectWith } from "../helpers";
import "../../src/styles.css";

const VIEWPORTS = [
  { name: "3840x2160", width: 3840, height: 2160 },
  { name: "2560x1440", width: 2560, height: 1440 },
  { name: "1920x1080", width: 1920, height: 1080 },
  { name: "1366x768", width: 1366, height: 768 },
] as const;

const PREF_KEYS = [
  DIRECTOR_FLAG_KEY,
  INSPECTOR_COLLAPSED_KEY,
  INSPECTOR_SECTION_COLLAPSED_KEY,
  DIRECTOR_SPLIT_RATIO_KEY,
  DIRECTOR_FOCUS_KEY,
  DIRECTOR_COMPOSER_HEIGHT_KEY,
  DIRECTOR_PRESENTATION_KEY,
  DIRECTOR_FOCUS_H_SPLIT_KEY,
  DIRECTOR_WORK_SPLIT_KEY,
  DIRECTOR_DIAGNOSTICS_COLLAPSED_KEY,
  H_SPLIT_RATIO_KEY,
];

function fixture(startMs = 30_000): Session {
  const a = asset({ id: "asset_aa", kind: "audio", durationMs: 8000 });
  const c = clip({
    id: "clip_test",
    assetId: "asset_aa",
    trackId: "A1",
    startMs,
    durationMs: 2000,
    locked: false,
  });
  return {
    ...createSession(createMemoryBlobStore()),
    project: { ...projectWith([c], [a]), snap: true, playheadMs: 31_950 },
    selectedClipId: "clip_test",
    selectedClipIds: ["clip_test"],
  };
}

function goldenHost(patch?: Partial<DirectorHostState>): DirectorHostState {
  return {
    ...createDirectorHostState(),
    grant: "EDIT",
    mode: "AGENT",
    modeLabel: "Mode: AGENT",
    contextLevel: "SELECTION",
    contextLabel: "Context: SELECTION",
    ...patch,
  };
}

describe("AI Director workspace presentation", () => {
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

  it("COLLAPSED is a 32px strip so Preview / Arrange / Mixer keep the workspace", async () => {
    await mountApp();
    await click("toolbar-ai");
    expect(host!.querySelector('[data-testid="workspace-inspector"]')?.getAttribute("data-director-presentation")).toBe(
      "docked",
    );
    await click("inspector-collapse");
    const strip = host!.querySelector('[data-testid="workspace-inspector"]') as HTMLElement;
    expect(strip.getAttribute("data-director-presentation")).toBe("collapsed");
    expect(strip.getAttribute("data-collapsed")).toBe("true");
    expect(strip.style.width).toBe(`${INSPECTOR_COLLAPSED_PX}px`);
    expect(host!.querySelector('[data-testid="director"]')).toBeNull();
    expect(host!.querySelector('[data-testid="preview"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="timeline"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="mixer"]')).toBeTruthy();
    expect(localStorage.getItem(DIRECTOR_PRESENTATION_KEY)).toBe("collapsed");
    expect(directorPresentationOf({ inspectorCollapsed: true, directorEnabled: true, directorFocus: false })).toBe(
      "collapsed",
    );
  });

  it("DOCKED keeps the existing right-side cap and persists width separately from Focus", async () => {
    await mountApp(2560, 1440);
    await click("toolbar-ai");
    const inspector = host!.querySelector('[data-testid="workspace-inspector"]') as HTMLElement;
    expect(inspector.getAttribute("data-director-presentation")).toBe("docked");
    expect(inspector.style.maxWidth).toBe(`${INSPECTOR_MAX_PX}px`);
    expect(host!.querySelector('[data-testid="layout-split-h"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="preview"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="timeline"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="mixer"]')).toBeTruthy();
    const dockedRatio = host!.querySelector('[data-testid="preview-pane"]')?.getAttribute("data-h-split-ratio");
    expect(dockedRatio).toBeTruthy();
    expect(localStorage.getItem(DIRECTOR_PRESENTATION_KEY)).toBe("docked");

    await click("director-focus");
    expect(inspector.getAttribute("data-director-presentation")).toBe("focus");
    expect(inspector.style.maxWidth).toBe("none");
    const focusRatio = Number(
      host!.querySelector('[data-testid="preview-pane"]')?.getAttribute("data-h-split-ratio"),
    );
    expect(1 - focusRatio).toBeGreaterThanOrEqual(DIRECTOR_FOCUS_RATIO_MIN - 0.001);
    expect(1 - focusRatio).toBeLessThanOrEqual(DIRECTOR_FOCUS_RATIO_MAX + 0.001);
    expect(localStorage.getItem(DIRECTOR_FOCUS_H_SPLIT_KEY)).toBeTruthy();

    await click("director-focus");
    expect(inspector.getAttribute("data-director-presentation")).toBe("docked");
    expect(inspector.style.maxWidth).toBe(`${INSPECTOR_MAX_PX}px`);
    expect(host!.querySelector('[data-testid="preview-pane"]')?.getAttribute("data-h-split-ratio")).toBe(dockedRatio);
  });

  it("FOCUS is a non-modal 35–45% working panel beside Preview, not a permanently wider dock", async () => {
    await mountApp(3840, 2160);
    await click("toolbar-ai");
    await click("director-focus");
    const inspector = host!.querySelector('[data-testid="workspace-inspector"]') as HTMLElement;
    expect(inspector.getAttribute("data-director-presentation")).toBe("focus");
    expect(host!.querySelector('[data-testid="director"]')?.getAttribute("data-focus")).toBe("true");
    expect(inspector.style.maxWidth).toBe("none");
    const live = Number(host!.querySelector('[data-testid="preview-pane"]')?.getAttribute("data-h-split-ratio"));
    const directorShare = 1 - live;
    expect(directorShare).toBeGreaterThanOrEqual(DIRECTOR_FOCUS_RATIO_MIN - 0.001);
    expect(directorShare).toBeLessThanOrEqual(DIRECTOR_FOCUS_RATIO_MAX + 0.001);
    expect(directorShare).toBeCloseTo(DEFAULT_DIRECTOR_FOCUS_RATIO, 5);
    expect(clampFocusHSplitRatio(DEFAULT_DIRECTOR_FOCUS_H_SPLIT, 3840 - 14)).toBeCloseTo(
      DEFAULT_DIRECTOR_FOCUS_H_SPLIT,
      5,
    );
    expect(host!.querySelector('[data-testid="preview"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="timeline"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="mixer"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="director-input"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="director-send"]')).toBeTruthy();
    expect(host!.querySelector(".project-overlay[aria-modal='true']")).toBeNull();
    expect(localStorage.getItem(DIRECTOR_FOCUS_KEY)).toBe("1");
    expect(localStorage.getItem(DIRECTOR_PRESENTATION_KEY)).toBe("focus");
  });

  it("diagnostics start compact, expand on demand, and stay local-only", async () => {
    await mountApp();
    await click("toolbar-ai");
    expect(host!.querySelector('[data-testid="director-chrome"]')?.getAttribute("data-diagnostics-collapsed")).toBe(
      "true",
    );
    expect(host!.querySelector('[data-testid="director-diagnostics-compact"]')?.textContent).toMatch(/Mode/);
    expect(host!.querySelector('[data-testid="director-meta"]')?.hasAttribute("hidden")).toBe(true);
    expect(host!.querySelector('[data-testid="director-status"]')).toBeTruthy();
    await click("director-diagnostics-toggle");
    expect(host!.querySelector('[data-testid="director-chrome"]')?.getAttribute("data-diagnostics-collapsed")).toBe(
      "false",
    );
    expect(host!.querySelector('[data-testid="director-meta"]')?.hasAttribute("hidden")).toBe(false);
    expect(localStorage.getItem(DIRECTOR_DIAGNOSTICS_COLLAPSED_KEY)).toBe("0");
    await click("director-diagnostics-toggle");
    expect(localStorage.getItem(DIRECTOR_DIAGNOSTICS_COLLAPSED_KEY)).toBe("1");
    expect(host!.querySelector('[data-testid="project-dirty"]')).toBeNull();
  });

  it("conversation is separated from the result pane and composer stays pinned", async () => {
    await mountApp();
    await click("toolbar-ai");
    const body = host!.querySelector('[data-testid="director-body"]') as HTMLElement;
    const work = host!.querySelector('[data-testid="director-work"]') as HTMLElement;
    expect(body.firstElementChild?.getAttribute("data-testid")).toBe("director-chrome");
    expect(body.lastElementChild?.getAttribute("data-testid")).toBe("director-compose");
    expect(work.querySelector('[data-testid="director-conversation"]')).toBeTruthy();
    expect(work.querySelector('[data-testid="director-scroll"]')).toBeTruthy();
    expect(work.querySelector('[data-testid="director-result"]')).toBeTruthy();
    expect(work.querySelector('[data-testid="director-history-actions"]')).toBeTruthy();
    expect(work.getAttribute("data-has-txn")).toBe("false");
    expect(host!.querySelector('[data-testid="director-work-split"]')).toBeNull();
  });

  it("long transaction details get their own scroll split and do not replace the composer", async () => {
    const session = fixture();
    const preview = await submitDirectorProviderTurn(
      goldenHost(),
      GOLDEN_MOVE_PROMPT,
      { provider: createMockProvider(), orchestrator: createOrchestrator() },
      undefined,
      session,
    );
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(
        <DirectorPanel
          initialState={preview}
          session={session}
          canUndo
          canRedo
          onUndo={() => undefined}
          onRedo={() => undefined}
        />,
      );
    });
    const work = host!.querySelector('[data-testid="director-work"]') as HTMLElement;
    expect(work.getAttribute("data-has-txn")).toBe("true");
    expect(work.classList.contains("has-txn")).toBe(true);
    expect(host!.querySelector('[data-testid="director-work-split"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="director-txn-phase"]')?.textContent).toBe("PREVIEW");
    expect(host!.querySelector('[data-testid="director-conversation"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="director-compose"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="director-history-undo"]')).toBeTruthy();
    const rejected = rejectHostTransaction(preview);
    await act(async () => {
      root!.render(
        <DirectorPanel initialState={rejected} session={session} canUndo canRedo />,
      );
    });
    expect(host!.querySelector('[data-testid="director-txn-phase"]')?.textContent).toBe("REJECTED");
    const human = applyCommand(session, { type: "moveClips", clipIds: ["clip_test"], deltaMs: 80 });
    const conflicted = applyHostApproved(preview, human);
    await act(async () => {
      root!.render(<DirectorPanel initialState={conflicted.state} session={human} />);
    });
    expect(host!.querySelector('[data-testid="director-conflict"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="director-work-split"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="director-compose"]')).toBeTruthy();
  });

  it.each(VIEWPORTS)(
    "viewport $name keeps collapsed / docked / focus with Preview, Arrange, Mixer, and composer",
    async ({ width, height }) => {
      await mountApp(width, height);
      await click("toolbar-ai");
      expect(host!.querySelector('[data-testid="workspace-inspector"]')?.getAttribute("data-director-presentation")).toBe(
        "docked",
      );
      expect(host!.querySelector('[data-testid="director-input"]')).toBeTruthy();
      expect(host!.querySelector('[data-testid="director-send"]')).toBeTruthy();
      expect(host!.querySelector('[data-testid="preview"]')).toBeTruthy();
      expect(host!.querySelector('[data-testid="timeline"]')).toBeTruthy();
      expect(host!.querySelector('[data-testid="mixer"]')).toBeTruthy();

      await click("director-focus");
      expect(host!.querySelector('[data-testid="workspace-inspector"]')?.getAttribute("data-director-presentation")).toBe(
        "focus",
      );
      const live = Number(host!.querySelector('[data-testid="preview-pane"]')?.getAttribute("data-h-split-ratio"));
      expect(1 - live).toBeGreaterThanOrEqual(DIRECTOR_FOCUS_RATIO_MIN - 0.02);
      expect(1 - live).toBeLessThanOrEqual(DIRECTOR_FOCUS_RATIO_MAX + 0.02);
      expect(host!.querySelector('[data-testid="preview"]')).toBeTruthy();
      expect(host!.querySelector('[data-testid="timeline"]')).toBeTruthy();

      await click("director-focus");
      await click("inspector-collapse");
      expect(host!.querySelector('[data-testid="workspace-inspector"]')?.getAttribute("data-director-presentation")).toBe(
        "collapsed",
      );
      expect(host!.querySelector('[data-testid="preview"]')).toBeTruthy();
      expect(host!.querySelector('[data-testid="timeline"]')).toBeTruthy();
    },
  );

  it("presentation prefs never write Project / schema / history", async () => {
    const empty = createEmptyProject();
    expect(empty.schemaVersion).toBe(5);
    expect(PROJECT_SCHEMA_VERSION).toBe(5);
    await mountApp();
    await click("toolbar-ai");
    await click("director-diagnostics-toggle");
    await click("director-focus");
    await click("inspector-collapse");
    expect(host!.querySelector('[data-testid="project-dirty"]')).toBeNull();
    const dumped = JSON.parse(serializeProject(empty)) as Record<string, unknown>;
    expect(dumped).not.toHaveProperty("director");
    expect(JSON.stringify(dumped)).not.toMatch(
      /director-presentation|director-focus-h-split|director-work-split|director-diagnostics/,
    );
  });
});
