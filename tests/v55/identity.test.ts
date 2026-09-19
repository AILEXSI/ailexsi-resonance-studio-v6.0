import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { exportFrameEngineLabel, getFrameSourceBackend } from "../../src/core/exporter/frame-source";
import {
  GROUP_COLLAPSED_KEY,
  DIRECTOR_COMPOSER_HEIGHT_KEY,
  DIRECTOR_FOCUS_KEY,
  DIRECTOR_NORMAL_SPLIT_KEY,
  DIRECTOR_SPLIT_RATIO_KEY,
  H_SPLIT_RATIO_KEY,
  INSPECTOR_COLLAPSED_KEY,
  INSPECTOR_SECTION_COLLAPSED_KEY,
  LANE_HEIGHTS_KEY,
  LANE_LABEL_PX_KEY,
  MIXER_COLLAPSED_KEY,
  MIXER_WIDTH_KEY,
  NORMAL_SPLIT_RATIO_KEY,
  SPLIT_RATIO_KEY,
  TIMELINE_FOCUS_KEY,
  VOLUME_LANE_OPEN_KEY,
} from "../../src/core/layout-prefs";

describe("V6.0 product identity", () => {
  it("npm package is @ailexsi/resonance-studio-v6.0 6.0.0", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { name: string; version: string };
    expect(pkg.name).toBe("@ailexsi/resonance-studio-v6.0");
    expect(pkg.version).toBe("6.0.0");
  });

  it("Tauri productName / identifier / version are V6.0", () => {
    const conf = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8")) as {
      productName: string;
      version: string;
      identifier: string;
    };
    expect(conf.productName).toBe("AILEXSI Resonance Studio V6.0");
    expect(conf.version).toBe("6.0.0");
    expect(conf.identifier).toBe("com.ailexsi.resonance-studio-v6-0");
  });

  it("Cargo crate is ailexsi-resonance-studio-v6-0 6.0.0", () => {
    const toml = readFileSync("src-tauri/Cargo.toml", "utf8");
    expect(toml).toMatch(/name\s*=\s*"ailexsi-resonance-studio-v6-0"/);
    expect(toml).toMatch(/version\s*=\s*"6.0.0"/);
    expect(toml).toMatch(/name\s*=\s*"ailexsi_resonance_studio_v6_0_lib"/);
  });

  it("project schemaVersion stays 5", () => {
    const src = readFileSync("src/core/project.ts", "utf8");
    expect(src).toMatch(/PROJECT_SCHEMA_VERSION = 5/);
  });

  it("Export label comes from live getFrameSourceBackend()", () => {
    expect(getFrameSourceBackend()).toBe("ailexsi");
    expect(exportFrameEngineLabel()).toBe("AILEXSI");
  });

  it("AppData / localStorage keys use resonance-studio-v6-0*", () => {
    const keys = [
      MIXER_COLLAPSED_KEY,
      INSPECTOR_COLLAPSED_KEY,
      INSPECTOR_SECTION_COLLAPSED_KEY,
      DIRECTOR_SPLIT_RATIO_KEY,
      DIRECTOR_NORMAL_SPLIT_KEY,
      DIRECTOR_FOCUS_KEY,
      DIRECTOR_COMPOSER_HEIGHT_KEY,
      SPLIT_RATIO_KEY,
      H_SPLIT_RATIO_KEY,
      TIMELINE_FOCUS_KEY,
      NORMAL_SPLIT_RATIO_KEY,
      LANE_LABEL_PX_KEY,
      LANE_HEIGHTS_KEY,
      GROUP_COLLAPSED_KEY,
      VOLUME_LANE_OPEN_KEY,
      MIXER_WIDTH_KEY,
    ];
    for (const key of keys) {
      expect(key.startsWith("resonance-studio-v6-0")).toBe(true);
      expect(key.includes("resonance-studio-v5-5") || key.includes("resonance-studio-v5-mixer") || key === "resonance-studio-v5").toBe(false);
    }
    const persistence = readFileSync("src/core/persistence.ts", "utf8");
    const projectFile = readFileSync("src/core/project-file-store.ts", "utf8");
    expect(persistence).toMatch(/resonance-studio-v6-0"/);
    expect(projectFile).toMatch(/resonance-studio-v6-0-project-file/);
  });
});
