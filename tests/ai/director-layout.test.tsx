import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../../src/app/App";
import { AI_DIRECTOR_FLAG_KEY } from "../../src/app/ai/flag";
import { AI_PREFS_KEY } from "../../src/app/ai/providers/prefs";
import { PROJECT_SCHEMA_VERSION } from "../../src/core/project";
import {
  DIRECTOR_EXPANDED_KEY,
  DIRECTOR_SPLIT_KEY,
  MIXER_COLLAPSED_KEY,
  MIXER_WIDTH_KEY,
} from "../../src/core/layout-prefs";
import { dbToFader, dbToLinear, faderToDb, formatDb, linearToDb } from "../../src/core/volume";
import "../../src/styles.css";

const Pointer = typeof PointerEvent === "undefined" ? MouseEvent : PointerEvent;

describe("AI Director layout", () => {
  let host: HTMLDivElement | undefined;
  let root: Root | undefined;

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    host?.remove();
    host = undefined;
    root = undefined;
    localStorage.removeItem(AI_DIRECTOR_FLAG_KEY);
    localStorage.removeItem(AI_PREFS_KEY);
    localStorage.removeItem(DIRECTOR_EXPANDED_KEY);
    localStorage.removeItem(DIRECTOR_SPLIT_KEY);
    localStorage.removeItem(MIXER_COLLAPSED_KEY);
    localStorage.removeItem(MIXER_WIDTH_KEY);
  });

  async function mountApp() {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(<App />);
    });
  }

  function q(id: string) {
    return host!.querySelector(`[data-testid="${id}"]`);
  }

  async function click(id: string) {
    await act(async () => {
      (q(id) as HTMLButtonElement).click();
    });
  }

  it("keeps the normal mixer when the flag is off, even if expand was saved", async () => {
    localStorage.setItem(DIRECTOR_EXPANDED_KEY, "1");
    localStorage.setItem(MIXER_COLLAPSED_KEY, "0");
    await mountApp();
    expect(q("ai-director")).toBeNull();
    expect(q("ai-director-expand")).toBeNull();
    expect(q("ai-director-split")).toBeNull();
    expect(q("director-master")).toBeNull();
    expect(q("inspector")).toBeTruthy();
    expect(q("mixer")).toBeTruthy();
    expect(q("mix-V1")).toBeTruthy();
    expect(q("mix-fader-master")).toBeTruthy();
    expect(q("arrange-row")?.getAttribute("data-director-expanded")).toBe("false");
    expect(localStorage.getItem(MIXER_COLLAPSED_KEY)).toBe("0");
  });

  it("docks under the inspector, then expands to full height with only the master slider", async () => {
    localStorage.setItem(MIXER_WIDTH_KEY, "240");
    await mountApp();
    await click("ai-director-toggle");
    expect(localStorage.getItem(AI_DIRECTOR_FLAG_KEY)).toBe("1");
    expect(localStorage.getItem(DIRECTOR_EXPANDED_KEY)).not.toBe("1");
    expect(q("inspector")).toBeTruthy();
    expect(q("ai-director")?.getAttribute("data-expanded")).toBe("false");
    expect(q("ai-director-expand")?.textContent).toBe("Expand");
    expect(q("ai-director-split")).toBeTruthy();
    expect(getComputedStyle(q("ai-director-split")!).cursor).toBe("ns-resize");
    const scroll = q("ai-director-scroll");
    expect(scroll).toBeTruthy();
    expect(scroll!.classList.contains("director-scroll")).toBe(true);
    expect(getComputedStyle(scroll!).overflowY).toBe("auto");
    expect(scroll!.contains(q("ai-director-proposals"))).toBe(true);
    expect(scroll!.contains(q("ai-provider-settings"))).toBe(true);
    expect(scroll!.contains(q("ai-send-context"))).toBe(true);
    expect(scroll!.contains(q("ai-director-send"))).toBe(false);
    const provider = q("ai-provider-kind") as HTMLSelectElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
      setter?.call(provider, "cloud");
      provider.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(q("ai-director-scroll")!.contains(q("ai-provider-url"))).toBe(true);
    expect(q("ai-director-scroll")!.contains(q("ai-provider-model"))).toBe(true);
    expect(q("ai-director-scroll")!.contains(q("ai-provider-key"))).toBe(true);
    expect(q("mixer")).toBeTruthy();
    expect(q("mix-V1")).toBeTruthy();
    expect(q("director-master")).toBeNull();
    expect(q("arrange-row")?.getAttribute("data-mixer-width")).toBe("240");

    await click("ai-director-expand");
    expect(localStorage.getItem(DIRECTOR_EXPANDED_KEY)).toBe("1");
    expect(localStorage.getItem(MIXER_COLLAPSED_KEY)).not.toBe("1");
    expect(localStorage.getItem(MIXER_WIDTH_KEY)).toBe("240");
    expect(q("inspector")).toBeNull();
    expect(q("ai-director-split")).toBeNull();
    expect(q("ai-director")?.getAttribute("data-expanded")).toBe("true");
    expect(q("ai-director-expand")?.textContent).toBe("Dock");
    expect(q("mixer")).toBeNull();
    expect(q("mix-V1")).toBeNull();
    expect(q("mix-fader-master")).toBeNull();
    expect(q("director-master-volume")).toBeTruthy();
    expect(q("arrange-row")?.getAttribute("data-director-expanded")).toBe("true");
    expect(q("arrange-row")?.getAttribute("data-mixer-width")).toBe("240");

    const slider = q("director-master-volume") as HTMLInputElement;
    const before = Number(slider.value);
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(slider, "1");
      slider.dispatchEvent(new Event("input", { bubbles: true }));
      slider.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const linear = dbToLinear(faderToDb(1));
    const masterDb = formatDb(linearToDb(linear));
    expect(q("status")?.textContent).toContain(`Master ${masterDb}`);
    expect(q("director-master-db")?.textContent).toBe(masterDb);
    expect(Number((q("director-master-volume") as HTMLInputElement).value)).toBeCloseTo(
      dbToFader(linearToDb(linear)),
      5,
    );
    expect(Number((q("director-master-volume") as HTMLInputElement).value)).toBeGreaterThan(before);
    const context = JSON.parse(q("ai-send-context")?.textContent ?? "{}") as { project?: { schemaVersion?: number } };
    expect(context.project?.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(PROJECT_SCHEMA_VERSION).toBe(5);

    await click("transport-undo");
    expect(q("status")?.textContent).toContain("Nothing to undo");
    expect(q("director-master-db")?.textContent).toBe(masterDb);

    await click("ai-director-expand");
    expect(localStorage.getItem(DIRECTOR_EXPANDED_KEY)).toBe("0");
    expect(q("inspector")).toBeTruthy();
    expect(q("mixer")).toBeTruthy();
    expect(q("mix-V1")).toBeTruthy();
    expect(q("director-master")).toBeNull();
    expect(q("mix-db-master")?.textContent).toBe(masterDb);
    expect(Number((q("mix-fader-master") as HTMLInputElement).value)).toBeCloseTo(dbToFader(linearToDb(linear)), 5);
    expect(q("arrange-row")?.getAttribute("data-mixer-width")).toBe("240");
  });

  it("restores full height from the saved pref and brings the mixer back if the column is closed", async () => {
    localStorage.setItem(AI_DIRECTOR_FLAG_KEY, "1");
    localStorage.setItem(DIRECTOR_EXPANDED_KEY, "1");
    await mountApp();
    expect(q("inspector")).toBeNull();
    expect(q("mixer")).toBeNull();
    expect(q("director-master-volume")).toBeTruthy();

    await click("inspector-collapse");
    expect(q("ai-director")).toBeNull();
    expect(q("mixer")).toBeTruthy();
    expect(q("mix-V1")).toBeTruthy();
    expect(q("director-master")).toBeNull();
    expect(localStorage.getItem(DIRECTOR_EXPANDED_KEY)).toBe("1");

    await click("inspector-collapse");
    expect(q("ai-director")?.getAttribute("data-expanded")).toBe("true");
    expect(q("mixer")).toBeNull();
    expect(q("director-master-volume")).toBeTruthy();
  });

  it("drags the docked splitter and stores the inspector share", async () => {
    localStorage.setItem(AI_DIRECTOR_FLAG_KEY, "1");
    await mountApp();
    const body = host!.querySelector("#inspector-body") as HTMLElement;
    body.getBoundingClientRect = () =>
      ({
        x: 0,
        y: 100,
        left: 0,
        top: 100,
        right: 320,
        bottom: 500,
        width: 320,
        height: 400,
        toJSON() {
          return {};
        },
      }) as DOMRect;
    const split = q("ai-director-split") as HTMLElement;
    await act(async () => {
      split.dispatchEvent(new Pointer("pointerdown", { bubbles: true, clientY: 296, button: 0 }));
    });
    expect(Number(body.getAttribute("data-director-split"))).toBeCloseTo(0.5, 5);
    expect(Number(localStorage.getItem(DIRECTOR_SPLIT_KEY))).toBeCloseTo(0.5, 5);
    expect(q("inspector")).toBeTruthy();
    expect(q("mixer")).toBeTruthy();
  });
});
