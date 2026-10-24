import { describe, expect, it } from "vitest";
// @ts-expect-error node:fs is resolved by Vitest, not by the app bundle
import * as nodeFs from "node:fs";

describe("AI command capability", () => {
  it("grants the chat command only to the main window and does not return the key", () => {
    const rust = nodeFs.readFileSync("src-tauri/src/lib.rs", "utf8") as string;
    const permissions = nodeFs.readFileSync("src-tauri/permissions/ai.toml", "utf8") as string;
    const capability = JSON.parse(nodeFs.readFileSync("src-tauri/capabilities/default.json", "utf8") as string) as {
      windows?: string[];
      permissions?: unknown[];
    };
    expect(rust).not.toContain("ai_keychain_get");
    expect(rust).toContain("fn ai_chat");
    expect(rust).toContain("fn ai_keychain_exists");
    expect(permissions).not.toMatch(/commands\.allow = \[[^\]]*ai_keychain_get/);
    expect(permissions).toContain('commands.allow = ["ai_chat"]');
    expect(capability.windows).toEqual(["main"]);
    const names = (capability.permissions ?? []).map((entry) => (typeof entry === "string" ? entry : ""));
    expect(names).toContain("allow-ai-chat");
    expect(names).toContain("allow-ai-keychain-exists");
    expect(names).not.toContain("allow-ai-keychain-get");
    const listed = rust.slice(rust.indexOf("generate_handler!"), rust.indexOf("])"));
    for (const name of [
      "allow_media_paths",
      "ai_keychain_status",
      "ai_keychain_exists",
      "ai_keychain_set",
      "ai_keychain_delete",
      "ai_chat",
      "whisper_status",
      "whisper_pick_executable",
      "whisper_pick_model",
      "lyrics_whisper_align",
    ]) {
      expect(listed).toContain(name);
      const slug = name.replaceAll("_", "-");
      expect(names).toContain(name === "allow_media_paths" ? "allow-allow-media-paths" : `allow-${slug}`);
    }
    expect(rust).toMatch(/fn lyrics_whisper_align\(app: tauri::AppHandle, audio_path: String\)/);
    expect(rust).not.toMatch(/fn lyrics_whisper_align\([^)]*executable/);
    expect(rust).not.toMatch(/fn lyrics_whisper_align\([^)]*model/);
    const lyricsUi = nodeFs.readFileSync("src/ui/director/DirectorLyrics.tsx", "utf8") as string;
    const controller = nodeFs.readFileSync("src/ui/director/DirectorController.tsx", "utf8") as string;
    const config = nodeFs.readFileSync("src/app/ai/lyrics/whisper-config.ts", "utf8") as string;
    expect(lyricsUi).not.toContain("<input");
    expect(lyricsUi).toContain("Choose executable");
    expect(lyricsUi).toContain("Choose model");
    expect(controller).toContain('pickWhisper("whisper_pick_executable")');
    expect(controller).toContain('pickWhisper("whisper_pick_model")');
    expect(controller).not.toContain("writeWhisperConfig");
    expect(controller).not.toContain("executable: whisper");
    expect(config).not.toContain("setItem");
    const scope = (capability.permissions ?? []).find(
      (entry): entry is { identifier?: string; allow?: { path?: string }[]; deny?: { path?: string }[] } =>
        typeof entry === "object" && entry !== null && (entry as { identifier?: string }).identifier === "fs:scope",
    );
    const allow = (scope?.allow ?? []).map((item) => item.path ?? "");
    const deny = (scope?.deny ?? []).map((item) => item.path ?? "");
    expect(allow).toEqual(["$APPDATA", "$APPDATA/last-project.json"]);
    expect(allow.join(" ")).not.toContain("*");
    expect(deny).toContain("$APPDATA/whisper-cpp.json");
    expect(deny).toContain("$APPDATA/resonance-sealed");
    expect(deny).toContain("$APPDATA/resonance-sealed/**");
    expect(rust).toContain("resonance-sealed");
    expect(rust).toContain("fn check_whisper_seal");
    expect(rust).toContain("fn path_is_whisper_store");
    const alignFn = rust.slice(rust.indexOf("fn lyrics_whisper_align"), rust.indexOf("fn read_whisper_json"));
    expect(alignFn.indexOf("load_whisper")).toBeGreaterThan(-1);
    expect(alignFn.indexOf("load_whisper")).toBeLessThan(alignFn.indexOf("Command::new"));
    const grant = rust.slice(rust.indexOf("fn allow_media_paths"), rust.indexOf("fn grant_fs_file"));
    expect(grant.indexOf("path_is_whisper_store")).toBeLessThan(grant.indexOf("grant_fs_file"));
  });
});