import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error node:fs is resolved by Vitest, not by the app bundle
import * as nodeFs from "node:fs";
import { EMPTY_WHISPER } from "../../src/app/ai/lyrics/whisper-config";
import { DirectorLyrics } from "../../src/ui/director/DirectorLyrics";
import "../../src/styles.css";

describe("Director lyrics panel", () => {
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

  function mount(node: ReactNode) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root!.render(node);
    });
  }

  it("shows the not-configured warning and the download links", () => {
    mount(
      <DirectorLyrics
        text=""
        status="Lyrics are stored beside the project."
        whisper={EMPTY_WHISPER}
        desktop
        onText={() => undefined}
        onPickExecutable={() => undefined}
        onPickModel={() => undefined}
        onSave={() => undefined}
        onAlign={() => undefined}
      />,
    );
    expect(host!.querySelector('[data-testid="whisper-not-configured"]')?.textContent).toContain("not configured");
    expect(host!.querySelector('[data-testid="whisper-not-configured"]')?.textContent).toContain("Nothing is sent");
    const links = [...host!.querySelectorAll("a")].map((link) => link.getAttribute("href"));
    expect(links).toContain("https://github.com/ggml-org/whisper.cpp");
    expect(links).toContain("https://huggingface.co/ggerganov/whisper.cpp");
    expect(host!.textContent).not.toContain("\u2014");
  });

  it("lets the system line wrap in the panel scroll area", () => {
    const css = nodeFs.readFileSync("src/styles.css", "utf8") as string;
    const log = css.slice(css.indexOf(".director-log {"), css.indexOf(".director-log p {"));
    const line = css.slice(css.indexOf(".director-log p {"), css.indexOf(".director-role {"));
    const lyrics = css.slice(css.indexOf(".director-lyrics {"), css.indexOf(".director-compose {"));
    expect(log).not.toMatch(/max-height:\s*\d/);
    expect(log).toContain("overflow: visible");
    expect(log).toContain("flex: 0 0 auto");
    expect(line).toContain("overflow-wrap: anywhere");
    expect(line).toContain("white-space: normal");
    expect(line).not.toContain("overflow: auto");
    expect(lyrics).toContain("font-size: 11px");
    expect(lyrics).toContain("text-transform: uppercase");
  });
});
