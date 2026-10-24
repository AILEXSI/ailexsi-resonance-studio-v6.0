import { describe, expect, it } from "vitest";
// @ts-expect-error node:fs is resolved by Vitest, not by the app bundle
import * as nodeFs from "node:fs";

/**
 * Floor from the security review. Our policy may allow fewer sources.
 * `blob:` on connect-src is the only extra: audio decode fetches blob: URLs.
 */
const FLOOR: Record<string, string[]> = {
  "default-src": ["'self'"],
  "script-src": ["'self'"],
  "connect-src": ["'self'", "ipc:", "http://ipc.localhost", "https:", "http://127.0.0.1:*", "http://localhost:*"],
  "img-src": ["'self'", "asset:", "blob:", "data:"],
  "media-src": ["'self'", "asset:", "blob:"],
  "style-src": ["'self'", "'unsafe-inline'"],
};

const EXTRA: Record<string, string[]> = {
  "connect-src": ["blob:"],
  "worker-src": ["'self'"],
  "font-src": ["'self'"],
  "object-src": ["'none'"],
  "base-uri": ["'self'"],
};

function sources(directive: string): string[] {
  return directive.split(/\s+/).slice(1);
}

describe("Tauri content security policy", () => {
  const conf = JSON.parse(nodeFs.readFileSync("src-tauri/tauri.conf.json", "utf8") as string) as {
    app?: { security?: { csp?: string | null } };
  };
  const csp = conf.app?.security?.csp ?? "";
  const parts = new Map(
    csp
      .split(";")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const name = item.split(/\s+/)[0] ?? "";
        return [name, item] as const;
      }),
  );

  function directive(name: string): string {
    const part = parts.get(name);
    expect(part, name).toBeTruthy();
    return part ?? "";
  }

  it("is a restrictive string without unsafe-eval or a host wildcard", () => {
    expect(typeof conf.app?.security?.csp).toBe("string");
    expect(csp.length).toBeGreaterThan(0);
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toContain("unsafe-inline' script");
    const tokens = csp.split(/[\s;]+/).filter(Boolean);
    const stars = tokens.filter((token) => token.includes("*"));
    expect(stars).toEqual(["http://127.0.0.1:*", "http://localhost:*"]);
    expect(directive("script-src")).toBe("script-src 'self'");
    expect(directive("style-src")).toBe("style-src 'self' 'unsafe-inline'");
    expect(directive("default-src")).toBe("default-src 'self'");
    expect(directive("object-src")).toBe("object-src 'none'");
  });

  it("stays at least as strict as the review floor, plus blob fetch", () => {
    for (const [name, floorSources] of Object.entries(FLOOR)) {
      const got = sources(directive(name));
      const allowed = new Set([...(EXTRA[name] ?? []), ...floorSources]);
      for (const source of got) expect(allowed.has(source), `${name} ${source}`).toBe(true);
      for (const source of floorSources) expect(got, name).toContain(source);
    }
    for (const [name, value] of parts) {
      if (FLOOR[name]) continue;
      const allowed = EXTRA[name];
      expect(allowed, name).toBeTruthy();
      for (const source of sources(value)) expect(allowed).toContain(source);
    }
    expect(sources(directive("connect-src"))).toContain("blob:");
    expect(sources(directive("connect-src"))).not.toContain("http:");
  });
});
