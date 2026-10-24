import { describe, expect, it } from "vitest";
// @ts-expect-error node:fs is resolved by Vitest, not by the app bundle
import * as nodeFs from "node:fs";

/**
 * Production loopback is Ollama's port only. Tauri IPC stays on `ipc:` and
 * `http://ipc.localhost`, so it does not need a loopback port wildcard.
 * The dev server port is added only on `devCsp`.
 */
const SHARED = {
  "default-src": ["'self'"],
  "script-src": ["'self'"],
  "img-src": ["'self'", "asset:", "blob:", "data:"],
  "media-src": ["'self'", "asset:", "blob:"],
  "style-src": ["'self'", "'unsafe-inline'"],
  "worker-src": ["'self'"],
  "font-src": ["'self'"],
  "object-src": ["'none'"],
  "base-uri": ["'self'"],
};

const PROD_CONNECT = ["'self'", "ipc:", "http://ipc.localhost", "https:", "http://127.0.0.1:11434", "http://localhost:11434", "blob:"];
const DEV_CONNECT = [
  "'self'",
  "ipc:",
  "http://ipc.localhost",
  "https:",
  "http://127.0.0.1:11434",
  "http://localhost:11434",
  "http://127.0.0.1:1421",
  "http://localhost:1421",
  "blob:",
];

function partsOf(csp: string): Map<string, string> {
  return new Map(
    csp
      .split(";")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => [item.split(/\s+/)[0] ?? "", item] as const),
  );
}

function sources(directive: string): string[] {
  return directive.split(/\s+/).slice(1);
}

describe("Tauri content security policy", () => {
  const conf = JSON.parse(nodeFs.readFileSync("src-tauri/tauri.conf.json", "utf8") as string) as {
    app?: { security?: { csp?: string | null; devCsp?: string | null } };
  };
  const csp = conf.app?.security?.csp ?? "";
  const devCsp = conf.app?.security?.devCsp ?? "";

  it("keeps production loopback on port 11434 and adds the dev port only in devCsp", () => {
    expect(typeof csp).toBe("string");
    expect(csp.length).toBeGreaterThan(0);
    expect(csp).not.toContain("*");
    expect(csp).not.toContain("unsafe-eval");
    expect(devCsp).not.toContain("*");
    expect(devCsp).not.toContain("unsafe-eval");
    const prod = partsOf(csp);
    const dev = partsOf(devCsp);
    expect(sources(prod.get("connect-src") ?? "")).toEqual(PROD_CONNECT);
    expect(sources(dev.get("connect-src") ?? "")).toEqual(DEV_CONNECT);
    expect(prod.get("script-src")).toBe("script-src 'self'");
    expect(dev.get("script-src")).toBe("script-src 'self'");
    expect(prod.get("style-src")).toBe("style-src 'self' 'unsafe-inline'");
    expect(prod.get("object-src")).toBe("object-src 'none'");
    for (const [name, expected] of Object.entries(SHARED)) {
      expect(sources(prod.get(name) ?? ""), name).toEqual(expected);
      expect(sources(dev.get(name) ?? ""), `dev ${name}`).toEqual(expected);
    }
  });
});
