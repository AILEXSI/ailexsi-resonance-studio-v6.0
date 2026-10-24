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
    for (const name of ["allow_media_paths", "ai_keychain_status", "ai_keychain_exists", "ai_keychain_set", "ai_keychain_delete", "ai_chat", "lyrics_whisper_align"]) {
      expect(listed).toContain(name);
      const slug = name.replaceAll("_", "-");
      expect(names).toContain(name === "allow_media_paths" ? "allow-allow-media-paths" : `allow-${slug}`);
    }
  });
});