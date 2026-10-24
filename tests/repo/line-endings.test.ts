import { describe, expect, it } from "vitest";
// @ts-expect-error node:fs is resolved by Vitest, not by the app bundle
import * as nodeFs from "node:fs";

/**
 * `tauri build` calls rewrite_manifest and may write src-tauri/Cargo.toml back as LF.
 * Windows Git with core.autocrlf=true checks that file out as CRLF, so the rewrite
 * dirties the worktree. .gitattributes eol=lf keeps the checkout in LF.
 */
describe("repo line endings", () => {
  it("forces LF for Cargo.toml and the Tauri config", () => {
    const text = nodeFs.readFileSync(".gitattributes", "utf8") as string;
    expect(text).toMatch(/^\*\.toml text eol=lf$/m);
    expect(text).toMatch(/^src-tauri\/tauri\.conf\.json text eol=lf$/m);
    expect(text).toMatch(/^src-tauri\/capabilities\/\*\.json text eol=lf$/m);
    const cargo = nodeFs.readFileSync("src-tauri/Cargo.toml", "utf8") as string;
    expect(cargo.includes("\r")).toBe(false);
  });
});
