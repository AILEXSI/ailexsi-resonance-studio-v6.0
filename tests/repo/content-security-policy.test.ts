import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The webview policy. Preview uses blob: media, export fetches those blob URLs,
 * and the Director talks to a local OpenAI-compatible server or an https provider.
 * Remote scripts stay blocked.
 */
describe("Tauri content security policy", () => {
  const conf = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8")) as {
    app?: { security?: { csp?: string | null } };
  };
  const csp = conf.app?.security?.csp ?? "";

  function directive(name: string): string {
    const part = csp.split(";").map((item) => item.trim()).find((item) => item.startsWith(`${name} `) || item === name);
    expect(part, name).toBeTruthy();
    return part ?? "";
  }

  it("is a restrictive string, not null", () => {
    expect(typeof conf.app?.security?.csp).toBe("string");
    expect(csp.length).toBeGreaterThan(0);
    expect(csp).not.toMatch(/\*|unsafe-eval/);
  });

  it("lets the Director reach loopback Ollama and https providers", () => {
    const connect = directive("connect-src");
    expect(connect).toContain("'self'");
    expect(connect).toContain("ipc:");
    expect(connect).toContain("http://ipc.localhost");
    expect(connect).toContain("http://127.0.0.1:11434");
    expect(connect).toContain("http://localhost:11434");
    expect(connect).toContain("https:");
    expect(connect).toContain("blob:");
  });

  it("allows preview media, posters, workers, and the asset protocol", () => {
    for (const name of ["img-src", "media-src"]) {
      const value = directive(name);
      expect(value).toContain("blob:");
      expect(value).toContain("data:");
      expect(value).toContain("asset:");
      expect(value).toContain("http://asset.localhost");
    }
    expect(directive("worker-src")).toContain("blob:");
    expect(directive("script-src")).toBe("script-src 'self'");
    expect(directive("style-src")).toContain("'unsafe-inline'");
    expect(directive("object-src")).toBe("object-src 'none'");
  });
});
