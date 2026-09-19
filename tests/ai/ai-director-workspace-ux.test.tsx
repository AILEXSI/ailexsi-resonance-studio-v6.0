import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../../src/app/App";
import { applyCommand } from "../../src/app/commands";
import { createSession, projectRevisionOf, type Session } from "../../src/app/session";
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
  COMPOSER_MAX_PX,
  COMPOSER_MIN_PX,
  DEFAULT_DIRECTOR_SPLIT_RATIO,
  DEFAULT_H_SPLIT_RATIO,
  DIRECTOR_COMPOSER_HEIGHT_KEY,
  DIRECTOR_FOCUS_KEY,
  DIRECTOR_NORMAL_SPLIT_KEY,
  DIRECTOR_SECTION_MIN_PX,
  DIRECTOR_SPLIT_RATIO_KEY,
  INSPECTOR_COLLAPSED_KEY,
  INSPECTOR_MAX_PX,
  INSPECTOR_MIN_PX,
  INSPECTOR_SECTION_COLLAPSED_KEY,
  INSPECTOR_SECTION_MIN_PX,
  applyDirectorSplitPointer,
  clampComposerHeightPx,
  clampDirectorSplitRatio,
  clampHSplitRatio,
} from "../../src/core/layout-prefs";
import { createMemoryBlobStore } from "../../src/core/persistence";
import { DirectorPanel } from "../../src/ui/director/DirectorPanel";
import { asset, clip, projectWith } from "../helpers";
import "../../src/styles.css";

const VIEWPORTS = [
  { name: "5120x1440", width: 5120, height: 1440 },
  { name: "2560x1440", width: 2560, height: 1440 },
  { name: "1920x1080", width: 1920, height: 1080 },
  { name: "1366x768", width: 1366, height: 768 },
] as const;

const PREF_KEYS = [
  DIRECTOR_FLAG_KEY,
  INSPECTOR_COLLAPSED_KEY,
  INSPECTOR_SECTION_COLLAPSED_KEY,
  DIRECTOR_SPLIT_RATIO_KEY,
  DIRECTOR_NORMAL_SPLIT_KEY,
  DIRECTOR_FOCUS_KEY,
  DIRECTOR_COMPOSER_HEIGHT_KEY,
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

describe("AI Director workspace UX + human-gate UI", () => {
  let host: HTMLDivElement | undefined;
  let root: Root | undefined;
  let fetchCalls = 0;
  let originalFetch: typeof globalThis.fetch | undefined;

  beforeEach(() => {
    setDirectorEnabledForTests(null);
    for (const key of PREF_KEYS) localStorage.removeItem(key);
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
    for (const key of PREF_KEYS) localStorage.removeItem(key);
    document.documentElement.style.width = "";
    document.documentElement.style.height = "";
    document.body.style.width = "";
    document.body.style.height = "";
    if (originalFetch) globalThis.fetch = originalFetch;
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

  it("2A collapse/expand Inspector section: Director uses space, selection preserved, no Project write", async () => {
    await mountApp();
    await click("toolbar-ai");
    const inspector = host!.querySelector('[data-testid="inspector"]');
    const selected = host!.querySelector('[data-testid="inspector"]')?.textContent;
    expect(inspector).toBeTruthy();
    expect(host!.querySelector('[data-testid="director"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="inspector-section-collapse"]')?.textContent).toMatch(
      /Collapse Inspector/,
    );

    await click("inspector-section-collapse");
    expect(host!.querySelector('[data-testid="workspace-inspector"]')?.getAttribute("data-inspector-section-collapsed")).toBe(
      "true",
    );
    expect(host!.querySelector('[data-testid="inspector-section"]')?.hasAttribute("hidden")).toBe(true);
    expect(host!.querySelector('[data-testid="director"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="director-split"]')).toBeNull();
    expect(host!.querySelector('[data-testid="timeline"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="preview"]')).toBeTruthy();
    expect(localStorage.getItem(INSPECTOR_SECTION_COLLAPSED_KEY)).toBe("1");
    expect(host!.querySelector('[data-testid="project-dirty"]')).toBeNull();

    await click("inspector-section-collapse");
    expect(host!.querySelector('[data-testid="inspector-section"]')?.hasAttribute("hidden")).toBe(false);
    expect(host!.querySelector('[data-testid="inspector"]')).toBe(inspector);
    expect(host!.querySelector('[data-testid="inspector"]')?.textContent).toBe(selected);
    expect(host!.querySelector('[data-testid="director"]')).toBeTruthy();
    expect(localStorage.getItem(INSPECTOR_SECTION_COLLAPSED_KEY)).toBe("0");
  });

  it("sidebar Collapse/Expand stays obvious and still hides the whole right column", async () => {
    await mountApp();
    await click("toolbar-ai");
    expect(host!.querySelector('[data-testid="inspector-collapse"]')?.textContent).toMatch(/Collapse/);
    await click("inspector-collapse");
    expect(host!.querySelector('[data-testid="workspace-inspector"]')?.getAttribute("data-collapsed")).toBe(
      "true",
    );
    expect(host!.querySelector('[data-testid="inspector"]')).toBeNull();
    expect(host!.querySelector('[data-testid="director"]')).toBeNull();
    expect(host!.querySelector('[data-testid="inspector-collapse"]')?.textContent).toMatch(/Expand/);
    expect(host!.querySelector('[data-testid="inspector-collapse"]')?.textContent).toMatch(/INS/);
    await click("inspector-collapse");
    expect(host!.querySelector('[data-testid="inspector"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="director"]')).toBeTruthy();
  });

  it("2B Director/Inspector split has min heights and persists", () => {
    const available = 400;
    expect(clampDirectorSplitRatio(0, available) * available).toBe(INSPECTOR_SECTION_MIN_PX);
    expect((1 - clampDirectorSplitRatio(1, available)) * available).toBe(DIRECTOR_SECTION_MIN_PX);
    const junk = applyDirectorSplitPointer({ clientY: 1, bodyTop: 0, bodyHeight: 408 });
    expect(junk.inspectorPx).toBeGreaterThanOrEqual(INSPECTOR_SECTION_MIN_PX);
    expect(junk.directorPx).toBeGreaterThanOrEqual(DIRECTOR_SECTION_MIN_PX);
    expect(DEFAULT_DIRECTOR_SPLIT_RATIO).toBeGreaterThan(0.1);
  });

  it("2C sidebar width reuses the existing Preview/Inspector splitter with min/max", async () => {
    await mountApp(5120, 1440);
    await click("toolbar-ai");
    expect(host!.querySelector('[data-testid="layout-split-h"]')).toBeTruthy();
    const ultra = 5120 - 14;
    expect((1 - clampHSplitRatio(0, ultra)) * ultra).toBe(INSPECTOR_MAX_PX);
    expect((1 - clampHSplitRatio(1, ultra)) * ultra).toBe(INSPECTOR_MIN_PX);
    expect(host!.querySelector('[data-testid="workspace-inspector"]')?.style.maxWidth).toBe(
      `${INSPECTOR_MAX_PX}px`,
    );
    expect(host!.querySelector('[data-testid="timeline"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="mixer"]')).toBeTruthy();
    expect(DEFAULT_H_SPLIT_RATIO).toBeGreaterThan(0.5);
  });

  it("2D Director Focus collapses Inspector and exit restores split", async () => {
    await mountApp();
    await click("toolbar-ai");
    const splitBefore = host!.querySelector('[data-testid="inspector-body"]')?.getAttribute(
      "data-director-split-ratio",
    );
    expect(host!.querySelector('[data-testid="director-focus"]')?.textContent).toBe("Focus");
    await click("director-focus");
    expect(host!.querySelector('[data-testid="director"]')?.getAttribute("data-focus")).toBe("true");
    expect(host!.querySelector('[data-testid="inspector-body"]')?.getAttribute("data-director-focus")).toBe(
      "true",
    );
    expect(host!.querySelector('[data-testid="inspector-section"]')?.hasAttribute("hidden")).toBe(true);
    expect(host!.querySelector('[data-testid="director-split"]')).toBeNull();
    expect(host!.querySelector('[data-testid="director-focus"]')?.textContent).toBe("Exit Focus");
    expect(localStorage.getItem(DIRECTOR_FOCUS_KEY)).toBe("1");

    await click("director-focus");
    expect(host!.querySelector('[data-testid="director"]')?.getAttribute("data-focus")).toBe("false");
    expect(host!.querySelector('[data-testid="inspector-section"]')?.hasAttribute("hidden")).toBe(false);
    expect(host!.querySelector('[data-testid="inspector-body"]')?.getAttribute("data-director-split-ratio")).toBe(
      splitBefore,
    );
    expect(localStorage.getItem(DIRECTOR_FOCUS_KEY)).toBe("0");
  });

  it("2E composer is multiline, bounded, Enter=newline, Ctrl+Enter=Send", async () => {
    await mountApp();
    await click("toolbar-ai");
    const input = host!.querySelector('[data-testid="director-input"]') as HTMLTextAreaElement;
    expect(input.tagName).toBe("TEXTAREA");
    expect(Number(input.getAttribute("data-composer-min"))).toBe(COMPOSER_MIN_PX);
    expect(Number(input.getAttribute("data-composer-max"))).toBe(COMPOSER_MAX_PX);
    expect(clampComposerHeightPx(8)).toBe(COMPOSER_MIN_PX);
    expect(clampComposerHeightPx(900)).toBe(COMPOSER_MAX_PX);
    expect(host!.querySelector('[data-testid="director-compose-hint"]')?.textContent).toMatch(
      /Ctrl\+Enter = Send/,
    );
    expect(getComputedStyle(input).resize).toMatch(/vertical|both/);

    await act(async () => {
      const native = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value");
      native?.set?.call(input, "line one");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(host!.querySelectorAll("[data-role]").length).toBe(0);

    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }),
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const texts = [...host!.querySelectorAll("[data-role]")].map((el) => el.textContent);
    expect(texts.some((t) => t?.includes("line one"))).toBe(true);
    expect(host!.querySelector('[data-testid="director-send"]')).toBeTruthy();
  });

  it("2F layout order is chrome → txn/conflict → conversation → composer/Send", async () => {
    await mountApp();
    await click("toolbar-ai");
    const body = host!.querySelector('[data-testid="director-body"]') as HTMLElement;
    const kids = [...body.children].map((el) => (el as HTMLElement).dataset.testid);
    expect(kids[0]).toBe("director-chrome");
    expect(kids).toContain("director-scroll");
    expect(kids.at(-1)).toBe("director-compose");
    expect(kids.indexOf("director-chrome")).toBeLessThan(kids.indexOf("director-scroll"));
    expect(kids.indexOf("director-scroll")).toBeLessThan(kids.indexOf("director-compose"));
    expect(host!.querySelector('[data-testid="director-history-actions"]')).toBeTruthy();
  });

  it("geometry / Focus / collapse never write Project, history, revision, or provider", async () => {
    const empty = createEmptyProject();
    expect(empty.schemaVersion).toBe(5);
    expect(PROJECT_SCHEMA_VERSION).toBe(5);
    await mountApp();
    const statusBefore = host!.querySelector('[data-testid="status"]')?.textContent;
    await click("toolbar-ai");
    await click("inspector-section-collapse");
    await click("director-focus");
    await click("director-focus");
    await click("inspector-section-collapse");
    expect(host!.querySelector('[data-testid="status"]')?.textContent).toBe(statusBefore);
    expect(host!.querySelector('[data-testid="project-dirty"]')).toBeNull();
    expect(fetchCalls).toBe(0);
    const dumped = JSON.parse(serializeProject(empty)) as Record<string, unknown>;
    expect(dumped).not.toHaveProperty("director");
    expect(dumped).not.toHaveProperty("ai");
    expect(JSON.stringify(dumped)).not.toMatch(/director-split|inspector-section-collapsed/);
  });

  it.each(VIEWPORTS)(
    "viewport $name keeps AI, collapse, Focus, splitter, composer, Send, scrolls",
    async ({ width, height }) => {
      await mountApp(width, height);
      expect(host!.querySelector('[data-testid="toolbar-ai"]')).toBeTruthy();
      await click("toolbar-ai");
      expect(host!.querySelector('[data-testid="director"]')).toBeTruthy();
      expect(host!.querySelector('[data-testid="inspector-collapse"]')).toBeTruthy();
      expect(host!.querySelector('[data-testid="inspector-section-collapse"]')).toBeTruthy();
      expect(host!.querySelector('[data-testid="director-focus"]')).toBeTruthy();
      expect(host!.querySelector('[data-testid="director-split"]')).toBeTruthy();
      expect(host!.querySelector('[data-testid="director-input"]')).toBeTruthy();
      expect(host!.querySelector('[data-testid="director-send"]')).toBeTruthy();
      expect(host!.querySelector('[data-testid="timeline"]')).toBeTruthy();
      expect(host!.querySelector('[data-testid="mixer"]')).toBeTruthy();
      expect(host!.querySelector('[data-testid="preview"]')).toBeTruthy();
      await click("director-focus");
      expect(host!.querySelector('[data-testid="director"]')).toBeTruthy();
      expect(host!.querySelector('[data-testid="director-send"]')).toBeTruthy();
      await click("director-focus");
    },
  );
});

describe("AI Director human-gate UI (not human-proven)", () => {
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

  async function mountPanel(state: DirectorHostState, session: Session, extras?: {
    canUndo?: boolean;
    canRedo?: boolean;
    onUndo?: () => void;
    onRedo?: () => void;
    onCanonicalCommit?: (next: Session) => void;
  }) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(
        <DirectorPanel
          initialState={state}
          session={session}
          canUndo={extras?.canUndo}
          canRedo={extras?.canRedo}
          onUndo={extras?.onUndo}
          onRedo={extras?.onRedo}
          onCanonicalCommit={extras?.onCanonicalCommit}
        />,
      );
    });
  }

  it("Reject shows a clear REJECTED state without moving the clip", async () => {
    const session = fixture();
    const preview = await submitDirectorProviderTurn(
      goldenHost(),
      GOLDEN_MOVE_PROMPT,
      { provider: createMockProvider(), orchestrator: createOrchestrator() },
      undefined,
      session,
    );
    const rejected = rejectHostTransaction(preview);
    await mountPanel(rejected, session);
    expect(host!.querySelector('[data-testid="director-txn"]')?.getAttribute("data-txn-status")).toBe(
      "rejected",
    );
    expect(host!.querySelector('[data-testid="director-txn-phase"]')?.textContent).toBe("REJECTED");
    expect(host!.querySelector('[data-testid="director-txn-rejected"]')?.textContent).toMatch(/not moved/);
    expect(host!.querySelector('[data-testid="director-txn-apply"]')).toBeNull();
    expect(session.project.clips[0]!.startMs).toBe(30_000);
    expect(session.history.past.length).toBe(0);
  });

  it("stale TRANSACTION_CONFLICT is a dedicated banner and Apply is blocked", async () => {
    const session = fixture();
    const preview = await submitDirectorProviderTurn(
      goldenHost(),
      GOLDEN_MOVE_PROMPT,
      { provider: createMockProvider(), orchestrator: createOrchestrator() },
      undefined,
      session,
    );
    const human = applyCommand(session, { type: "moveClips", clipIds: ["clip_test"], deltaMs: 80 });
    const approved = applyHostApproved(preview, human);
    expect(approved.state.lastGateCode).toBe("TRANSACTION_CONFLICT");
    await mountPanel(approved.state, human);
    expect(host!.querySelector('[data-testid="director-conflict"]')?.getAttribute("data-conflict-code")).toBe(
      "TRANSACTION_CONFLICT",
    );
    expect(host!.querySelector('[data-testid="director-conflict-title"]')?.textContent).toMatch(
      /STALE TRANSACTION — CONFLICT/,
    );
    expect(host!.querySelector('[data-testid="director-txn-phase"]')?.textContent).toMatch(/CONFLICT/);
    const apply = host!.querySelector('[data-testid="director-txn-apply"]') as HTMLButtonElement;
    const reject = host!.querySelector('[data-testid="director-txn-reject"]') as HTMLButtonElement;
    expect(apply).toBeTruthy();
    expect(apply.disabled).toBe(true);
    expect(reject).toBeTruthy();
    expect(reject.disabled).toBe(false);
    expect(human.project.clips[0]!.startMs).toBe(30_080);
    expect(projectRevisionOf(human)).toBe(1);
  });

  it("Undo/Redo controls are labeled and call the existing history path", async () => {
    const session = fixture();
    let undone = 0;
    let redone = 0;
    await mountPanel(goldenHost(), session, {
      canUndo: true,
      canRedo: true,
      onUndo: () => {
        undone += 1;
      },
      onRedo: () => {
        redone += 1;
      },
    });
    expect(host!.querySelector('[data-testid="director-history-undo"]')?.textContent).toBe("Undo");
    expect(host!.querySelector('[data-testid="director-history-redo"]')?.textContent).toBe("Redo");
    await act(async () => {
      (host!.querySelector('[data-testid="director-history-undo"]') as HTMLButtonElement).click();
      (host!.querySelector('[data-testid="director-history-redo"]') as HTMLButtonElement).click();
    });
    expect(undone).toBe(1);
    expect(redone).toBe(1);
  });

  it("Apply still commits exact +2000 from PREVIEW", async () => {
    const session = fixture();
    const preview = await submitDirectorProviderTurn(
      goldenHost(),
      GOLDEN_MOVE_PROMPT,
      { provider: createMockProvider(), orchestrator: createOrchestrator() },
      undefined,
      session,
    );
    let committed: Session | undefined;
    await mountPanel(preview, session, {
      onCanonicalCommit: (next) => {
        committed = next;
      },
    });
    expect(host!.querySelector('[data-testid="director-txn-phase"]')?.textContent).toBe("PREVIEW");
    expect(host!.querySelector('[data-testid="director-txn-delta"]')?.textContent).toMatch(/\+2000ms/);
    await act(async () => {
      (host!.querySelector('[data-testid="director-txn-apply"]') as HTMLButtonElement).click();
    });
    expect(committed).toBeTruthy();
    expect(committed!.project.clips[0]!.startMs).toBe(32_000);
    expect(committed!.history.past.length).toBe(1);
  });
});
