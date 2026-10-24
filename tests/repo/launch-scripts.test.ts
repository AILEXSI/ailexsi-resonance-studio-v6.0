import { describe, expect, it } from "vitest";
// @ts-expect-error node:fs is resolved by Vitest, not by the app bundle
import * as nodeFs from "node:fs";

describe("V6 launch scripts stay at the repo root", () => {
  const rootLaunchers = ["Start-V6.cmd", "BUILD_AND_RUN_V6.0.cmd", "INSTALL_BUILD_RUN_V6.0.cmd"];
  const legacyLaunchers = ["legacy/Start-V5.cmd", "legacy/BUILD_AND_RUN_V5.5.cmd", "legacy/INSTALL_BUILD_RUN_V5.5.cmd"];

  it("keeps the V6 cmd files next to package.json and the PowerShell helpers", () => {
    for (const name of rootLaunchers) {
      const text = nodeFs.readFileSync(name, "utf8") as string;
      expect(text).toContain("%~dp0package.json");
      expect(text).toContain("%~dp0scripts\\");
      expect(nodeFs.existsSync("scripts/run-v5.5.ps1")).toBe(true);
      expect(nodeFs.existsSync("scripts/build-v5.5-windows.ps1")).toBe(true);
    }
  });

  it("keeps the V5 launchers and points them at the parent helpers", () => {
    for (const name of legacyLaunchers) {
      const text = nodeFs.readFileSync(name, "utf8") as string;
      expect(text).toContain("%ROOT%\\scripts\\");
      expect(text).not.toContain("%~dp0scripts\\");
      expect(nodeFs.existsSync(name.replace("legacy/", ""))).toBe(false);
    }
  });
});
