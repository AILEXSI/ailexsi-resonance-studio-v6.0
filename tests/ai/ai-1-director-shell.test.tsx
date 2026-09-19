import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../../src/app/App";
import { applyCommand } from "../../src/app/commands";
import { createSession, selectionOf, type Session } from "../../src/app/session";
import {
  appendDirectorMessage,
  createDirectorConversation,
  mockDirectorReply,
} from "../../src/app/ai/conversation";
import { DIRECTOR_FLAG_KEY, setDirectorEnabledForTests } from "../../src/app/ai/flag";
import { createDirectorHostState, submitDirectorMockTurn } from "../../src/app/ai/host";
import { serializeProject, PROJECT_SCHEMA_VERSION } from "../../src/core/project";
import { createMemoryBlobStore } from "../../src/core/persistence";
import { DirectorPanel } from "../../src/ui/director/DirectorPanel";
import { asset, clip, projectWith } from "../helpers";
import "../../src/styles.css";

function sessionWithClip(): Session {
  const a = asset({ id: "aa", kind: "audio", durationMs: 4000 });
  const c = clip({
    id: "clip_test",
    assetId: "aa",
    trackId: "A1",
    startMs: 30_000,
    durationMs: 2000,
  });
  return {
    ...createSession(createMemoryBlobStore()),
    project: projectWith([c], [a]),
    selectedClipId: "clip_test",
    selectedClipIds: ["clip_test"],
  };
}

describe("AI-1 Director shell", () => {
  let host: HTMLDivElement | undefined;
  let root: Root | undefined;
  let fetchCalls = 0;
  let originalFetch: typeof globalThis.fetch | undefined;

  beforeEach(() => {
    setDirectorEnabledForTests(null);
    localStorage.removeItem(DIRECTOR_FLAG_KEY);
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

  async function mountPanel() {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(<DirectorPanel />);
    });
  }

  it("is hidden when the feature gate is off", async () => {
    setDirectorEnabledForTests(false);
    await mountApp();
    expect(host!.querySelector('[data-testid="director"]')).toBeNull();
    expect(host!.querySelector('[data-testid="toolbar-ai"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="inspector"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="timeline"]')).toBeTruthy();
  });

  it("renders in the inspector when the feature gate is on", async () => {
    setDirectorEnabledForTests(true);
    await mountApp();
    const director = host!.querySelector('[data-testid="director"]');
    expect(director).toBeTruthy();
    expect(host!.querySelector("#inspector-body")?.contains(director)).toBe(true);
    expect(host!.querySelector('[data-testid="director-status"]')?.textContent).toMatch(/Offline/);
    expect(host!.querySelector('[data-testid="director-status"]')?.textContent).not.toMatch(/OpenAI/i);
    expect(host!.querySelector('[data-testid="director-provider"]')?.textContent).toMatch(/mock/i);
  });

  it("opens and closes without touching Project", async () => {
    await mountPanel();
    expect(host!.querySelector('[data-testid="director-body"]')).toBeTruthy();
    await act(async () => {
      (host!.querySelector('[data-testid="director-toggle"]') as HTMLButtonElement).click();
    });
    expect(host!.querySelector('[data-testid="director-body"]')).toBeNull();
    await act(async () => {
      (host!.querySelector('[data-testid="director-toggle"]') as HTMLButtonElement).click();
    });
    expect(host!.querySelector('[data-testid="director-body"]')).toBeTruthy();
  });

  it("appends a user message and a mock reply with no fetch", async () => {
    await mountPanel();
    const input = host!.querySelector('[data-testid="director-input"]') as HTMLTextAreaElement;
    await act(async () => {
      const native = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value");
      native?.set?.call(input, "Hello Director");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      (host!.querySelector('[data-testid="director-send"]') as HTMLButtonElement).click();
    });
    await act(async () => {
      await Promise.resolve();
    });
    const texts = [...host!.querySelectorAll("[data-role]")].map((el) => el.textContent);
    expect(texts.some((t) => t?.includes("Hello Director"))).toBe(true);
    expect(texts.some((t) => t?.includes("Director (mock)"))).toBe(true);
    expect(fetchCalls).toBe(0);
  });

  it("does not mutate Project, selection, or schema 5", () => {
    const start = sessionWithClip();
    const beforeProject = start.project;
    const beforeClips = structuredClone(start.project.clips);
    const beforeSelection = selectionOf(start);
    const beforeHistory = start.history.past.length;
    const next = submitDirectorMockTurn(createDirectorHostState(), "Hello");
    expect(next.conversation.messages).toHaveLength(2);
    expect(next.conversation.messages[0]?.role).toBe("user");
    expect(next.conversation.messages[1]?.text).toBe(mockDirectorReply("Hello"));
    expect(start.project).toBe(beforeProject);
    expect(start.project.clips).toEqual(beforeClips);
    expect(selectionOf(start)).toEqual(beforeSelection);
    expect(start.history.past.length).toBe(beforeHistory);
    expect(start.project.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(JSON.parse(serializeProject(start.project)).schemaVersion).toBe(5);
    const afterCommand = applyCommand(start, { type: "select", clipId: "clip_test" });
    expect(afterCommand.project.schemaVersion).toBe(5);
    expect(afterCommand.project).toBe(start.project);
  });

  it("keeps conversation in memory only (not on Project)", () => {
    let conv = createDirectorConversation();
    conv = appendDirectorMessage(conv, "user", "ping");
    const project = sessionWithClip().project;
    const dumped = JSON.parse(serializeProject(project)) as Record<string, unknown>;
    expect(dumped.schemaVersion).toBe(5);
    expect(dumped).not.toHaveProperty("conversation");
    expect(dumped).not.toHaveProperty("director");
    expect(dumped).not.toHaveProperty("ai");
    expect(JSON.stringify(dumped)).not.toContain("ping");
  });
});
