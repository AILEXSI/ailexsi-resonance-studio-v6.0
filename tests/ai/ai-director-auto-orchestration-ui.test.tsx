import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../../src/app/App";
import { createSession, type Session } from "../../src/app/session";
import {
  createDirectorHostState,
  type DirectorHostState,
} from "../../src/app/ai/host";
import { DIRECTOR_FLAG_KEY, setDirectorEnabledForTests } from "../../src/app/ai/flag";
import { GOLDEN_MOVE_PROMPT, HUMAN_MOVE_PROMPT } from "../../src/app/ai/tools/move-clip";
import { clearDiscoveryCache, writeDiscoveryCache } from "../../src/app/ai/orchestration";
import { createMockProvider } from "../../src/app/ai/providers/mock";
import { AI_PREFS_KEY } from "../../src/app/ai/providers/prefs";
import { PROJECT_SCHEMA_VERSION, serializeProject, createEmptyProject } from "../../src/core/project";
import {
  COMPOSER_MAX_PX,
  COMPOSER_MIN_PX,
  DIRECTOR_COMPOSER_HEIGHT_KEY,
  DIRECTOR_DIAGNOSTICS_COLLAPSED_KEY,
  DIRECTOR_FOCUS_H_SPLIT_KEY,
  DIRECTOR_FOCUS_KEY,
  DIRECTOR_PRESENTATION_KEY,
  DIRECTOR_SPLIT_RATIO_KEY,
  DIRECTOR_WORK_SPLIT_KEY,
  INSPECTOR_COLLAPSED_KEY,
  INSPECTOR_SECTION_COLLAPSED_KEY,
} from "../../src/core/layout-prefs";
import { createMemoryBlobStore } from "../../src/core/persistence";
import { DirectorPanel } from "../../src/ui/director/DirectorPanel";
import { asset, clip, projectWith } from "../helpers";
import "../../src/styles.css";

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
  AI_PREFS_KEY,
];

function fixture(startMs = 30_000): Session {
  const a = asset({ id: "asset_aa", kind: "audio", durationMs: 8000 });
  const c = clip({
    id: "clip_test",
    assetId: "asset_aa",
    trackId: "A1",
    startMs,
    durationMs: 2000,
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

describe("AI Director auto-orchestration UI", () => {
  let host: HTMLDivElement | undefined;
  let root: Root | undefined;

  beforeEach(() => {
    clearDiscoveryCache();
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
    clearDiscoveryCache();
    for (const key of PREF_KEYS) localStorage.removeItem(key);
  });

  async function mountPanel(state: DirectorHostState, session: Session) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(
        <DirectorPanel initialState={state} session={session} provider={createMockProvider()} />,
      );
    });
  }

  async function send(text: string) {
    const input = host!.querySelector('[data-testid="director-input"]') as HTMLTextAreaElement;
    await act(async () => {
      const native = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value");
      native?.set?.call(input, text);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      (host!.querySelector('[data-testid="director-send"]') as HTMLButtonElement).click();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it("C/D UI: escalation shows Allow once / session / Cancel; Allow once still needs Apply", async () => {
    const session = fixture();
    await mountPanel(createDirectorHostState(), session);
    await send(GOLDEN_MOVE_PROMPT);
    expect(host!.querySelector('[data-testid="director-auth"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="director-auth-allow-once"]')?.textContent).toBe("Allow once");
    expect(host!.querySelector('[data-testid="director-auth-allow-session"]')?.textContent).toBe(
      "Allow for session",
    );
    expect(host!.querySelector('[data-testid="director-auth-cancel"]')?.textContent).toBe("Cancel");
    expect(host!.querySelector('[data-testid="director-txn"]')).toBeNull();
    expect(session.project.clips[0]!.startMs).toBe(30_000);

    await act(async () => {
      (host!.querySelector('[data-testid="director-auth-allow-once"]') as HTMLButtonElement).click();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host!.querySelector('[data-testid="director-txn-phase"]')?.textContent).toBe("PREVIEW");
    expect(host!.querySelector('[data-testid="director-txn-delta"]')?.textContent).toMatch(/\+2000ms/);
    expect(session.project.clips[0]!.startMs).toBe(30_000);
  });

  it("F UI: Cancel leaves zero mutation and no auth card", async () => {
    const session = fixture();
    await mountPanel(createDirectorHostState(), session);
    await send(GOLDEN_MOVE_PROMPT);
    await act(async () => {
      (host!.querySelector('[data-testid="director-auth-cancel"]') as HTMLButtonElement).click();
    });
    expect(host!.querySelector('[data-testid="director-auth"]')).toBeNull();
    expect(host!.querySelector('[data-testid="director-txn"]')).toBeNull();
    expect(session.project.clips[0]!.startMs).toBe(30_000);
    expect(session.history.past.length).toBe(0);
  });

  it("G UI: delete stays NO_TOOL with no preview", async () => {
    const session = fixture();
    await mountPanel(goldenHost(), session);
    await send("Lösche den markierten Clip");
    expect(host!.querySelector('[data-testid="director-txn"]')).toBeNull();
    expect(host!.textContent).toMatch(/NO_TOOL/);
    expect(session.project.clips[0]!.startMs).toBe(30_000);
  });

  it("J UI: LOCAL AI UNAVAILABLE offers Retry / Advanced and does not mutate", async () => {
    writeDiscoveryCache({
      baseUrl: "http://127.0.0.1:11434/v1",
      available: false,
      models: [],
      model: "",
    });
    const session = fixture();
    const state: DirectorHostState = {
      ...createDirectorHostState(),
      providerId: "openai-compatible",
      localConfig: { baseUrl: "http://127.0.0.1:11434/v1", model: "local-a" },
      connectionProbe: { phase: "failed", label: "down" },
    };
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(<DirectorPanel initialState={state} session={session} />);
    });
    await send("What is selected?");
    expect(host!.querySelector('[data-testid="director-local-unavailable"]')?.textContent).toMatch(
      /LOCAL AI UNAVAILABLE/,
    );
    expect(host!.querySelector('[data-testid="director-retry"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="director-open-advanced"]')).toBeTruthy();
    expect(session.project.clips[0]!.startMs).toBe(30_000);
    expect(session.history.past.length).toBe(0);
  });

  it("Normal compact status + Advanced still exposes Provider/Mode/Grant/Context/local controls", async () => {
    const session = fixture();
    await mountPanel(createDirectorHostState(), session);
    expect(host!.querySelector('[data-testid="director-normal-status"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="director"]')?.getAttribute("data-surface")).toBe("normal");
    expect(host!.querySelector('[data-testid="director-config"]')?.hasAttribute("hidden")).toBe(true);
    expect(host!.querySelector('[data-testid="director-provider-select"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="director-mode-select"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="director-grant-select"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="director-context-level"]')).toBeTruthy();
    await act(async () => {
      (host!.querySelector('[data-testid="director-advanced-toggle"]') as HTMLButtonElement).click();
    });
    expect(host!.querySelector('[data-testid="director"]')?.getAttribute("data-surface")).toBe("advanced");
    expect(host!.querySelector('[data-testid="director-config"]')?.hasAttribute("hidden")).toBe(false);
    const providerSelect = host!.querySelector('[data-testid="director-provider-select"]') as HTMLSelectElement;
    await act(async () => {
      providerSelect.value = "openai-compatible";
      providerSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(host!.querySelector('[data-testid="director-base-url"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="director-model"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="director-api-key"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="director-test-connection"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="director-discover-models"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="director-find-local-ai"]')).toBeTruthy();
  });

  it("AUTO chrome shows plan status; Advanced is MANUAL defaults only", async () => {
    const session = fixture();
    await mountPanel(createDirectorHostState(), session);
    expect(host!.querySelector('[data-testid="director-orch-kind"]')?.textContent).toBe("AUTO ●");
    expect(host!.querySelector('[data-testid="director-permission-status"]')?.textContent).toMatch(/Permission:/);
    expect(host!.querySelector('[data-testid="director-context-auto"]')?.textContent).toBe(
      "Context SELECTION · 1 clip",
    );
    expect(host!.querySelector('[data-testid="director-intent-status"]')?.textContent).toBe("Intent —");
    expect(host!.querySelector('[data-testid="director-plan-status"]')?.textContent).toBe("AUTO · —");
    await act(async () => {
      (host!.querySelector('[data-testid="director-advanced-toggle"]') as HTMLButtonElement).click();
    });
    expect(host!.querySelector('[data-testid="director-manual-legend"]')?.textContent).toMatch(/MANUAL defaults/);
    expect(host!.querySelector('[data-testid="director-mode-select"]')).toBeTruthy();
  });

  it("human prompt with ASK/DRAFT/NONE still auths then previews; dropdowns stay manual", async () => {
    const session = fixture();
    await mountPanel(
      {
        ...createDirectorHostState(),
        grant: "DRAFT",
        mode: "ASK",
        modeLabel: "Mode: ASK",
        contextLevel: "NONE",
        contextLabel: "Context: NONE",
        surface: "advanced",
      },
      session,
    );
    expect((host!.querySelector('[data-testid="director-mode-select"]') as HTMLSelectElement).value).toBe("ASK");
    expect((host!.querySelector('[data-testid="director-grant-select"]') as HTMLSelectElement).value).toBe("DRAFT");
    expect((host!.querySelector('[data-testid="director-context-level"]') as HTMLSelectElement).value).toBe("NONE");
    await send(HUMAN_MOVE_PROMPT);
    expect(host!.textContent).not.toMatch(/Context SELECTION is required/);
    expect(host!.querySelector('[data-testid="director-auth"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="director-plan-status"]')?.textContent).toMatch(
      /AUTO · Intent MOVE_CLIP · Tool timeline\.move_clip · Context SELECTION · Permission EDIT/,
    );
    const planStatus = host!.querySelector('[data-testid="director-plan-status"]') as HTMLElement;
    expect(planStatus.getAttribute("data-required-permission")).toBe("EDIT");
    expect(planStatus.getAttribute("data-authorized-grant")).toBe("DRAFT");
    expect(planStatus.getAttribute("data-runtime-mode")).toBe("AUTO");
    expect((host!.querySelector('[data-testid="director-mode-select"]') as HTMLSelectElement).value).toBe("ASK");
    expect((host!.querySelector('[data-testid="director-grant-select"]') as HTMLSelectElement).value).toBe("DRAFT");
    expect((host!.querySelector('[data-testid="director-context-level"]') as HTMLSelectElement).value).toBe("NONE");
    await act(async () => {
      (host!.querySelector('[data-testid="director-auth-allow-once"]') as HTMLButtonElement).click();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host!.textContent).not.toMatch(/Context SELECTION is required/);
    expect(host!.querySelector('[data-testid="director-txn-phase"]')?.textContent).toBe("PREVIEW");
    expect(host!.querySelector('[data-testid="director-txn-delta"]')?.textContent).toMatch(/\+2000ms/);
    expect((host!.querySelector('[data-testid="director-mode-select"]') as HTMLSelectElement).value).toBe("ASK");
    expect((host!.querySelector('[data-testid="director-grant-select"]') as HTMLSelectElement).value).toBe("DRAFT");
    expect((host!.querySelector('[data-testid="director-context-level"]') as HTMLSelectElement).value).toBe("NONE");
    expect(session.project.clips[0]!.startMs).toBe(30_000);
  });

  it("K UI golden AUTO with EDIT already granted still previews +2000", async () => {
    const session = fixture();
    await mountPanel(goldenHost(), session);
    await send(GOLDEN_MOVE_PROMPT);
    expect(host!.querySelector('[data-testid="director-txn-phase"]')?.textContent).toBe("PREVIEW");
    expect(host!.querySelector('[data-testid="director-txn-delta"]')?.textContent).toMatch(/\+2000ms/);
    expect(session.project.clips[0]!.startMs).toBe(30_000);
  });
});

describe("AI Director workspace UX still holds after auto-orchestration", () => {
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
  });

  async function mountApp() {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(<App />);
    });
  }

  it("collapse / Focus / composer Enter vs Ctrl+Enter / layout order", async () => {
    await mountApp();
    await act(async () => {
      (host!.querySelector('[data-testid="toolbar-ai"]') as HTMLButtonElement).click();
    });
    expect(host!.querySelector('[data-testid="inspector-section-collapse"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="director-focus"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="director-split"]')).toBeTruthy();
    const input = host!.querySelector('[data-testid="director-input"]') as HTMLTextAreaElement;
    expect(input.tagName).toBe("TEXTAREA");
    expect(Number(input.getAttribute("data-composer-min"))).toBe(COMPOSER_MIN_PX);
    expect(Number(input.getAttribute("data-composer-max"))).toBe(COMPOSER_MAX_PX);
    expect(host!.querySelector('[data-testid="director-compose-hint"]')?.textContent).toMatch(
      /Ctrl\+Enter = Send/,
    );
    const body = host!.querySelector('[data-testid="director-body"]') as HTMLElement;
    const kids = [...body.children].map((el) => (el as HTMLElement).dataset.testid);
    expect(kids[0]).toBe("director-chrome");
    expect(kids.at(-1)).toBe("director-compose");

    await act(async () => {
      const native = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value");
      native?.set?.call(input, "line one");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(host!.querySelectorAll("[data-role]").length).toBe(0);
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }));
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const texts = [...host!.querySelectorAll("[data-role]")].map((el) => el.textContent);
    expect(texts.some((t) => t?.includes("line one"))).toBe(true);

    const empty = createEmptyProject();
    expect(empty.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(JSON.parse(serializeProject(empty))).not.toHaveProperty("director");
  });
});
