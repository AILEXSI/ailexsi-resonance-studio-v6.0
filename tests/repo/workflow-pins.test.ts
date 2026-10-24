import { describe, expect, it } from "vitest";
// @ts-expect-error node:fs is resolved by Vitest, not by the app bundle
import * as nodeFs from "node:fs";

describe("workflow action pins", () => {
  const files = [".github/workflows/ci.yml", ".github/workflows/windows-exe.yml"];

  it("pins every third-party action to a full commit SHA with a version comment", () => {
    const uses: string[] = [];
    for (const file of files) {
      const text = nodeFs.readFileSync(file, "utf8") as string;
      for (const line of text.split("\n")) {
        if (!line.includes("uses:")) continue;
        expect(line, file).toMatch(/#\s*(?:v\d|stable)/);
        const match = /uses:\s*(\S+)/.exec(line);
        expect(match, line).toBeTruthy();
        uses.push(match?.[1] ?? "");
      }
    }
    expect(uses.length).toBeGreaterThan(0);
    for (const use of uses) {
      expect(use).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
      expect(use).not.toMatch(/@(v\d|stable)$/);
    }
    expect(uses.some((use) => use.startsWith("dtolnay/rust-toolchain@"))).toBe(true);
    expect(uses.some((use) => use.startsWith("swatinem/rust-cache@"))).toBe(true);
  });
});
