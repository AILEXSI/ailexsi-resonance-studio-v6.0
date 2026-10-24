import { describe, expect, it } from "vitest";
import { memoryKeychain, tauriKeychain } from "../../src/app/ai/providers/keychain";
import { readAiPrefs, writeAiPrefs } from "../../src/app/ai/providers/prefs";

describe("OS keychain adapter", () => {
  it("keeps a browser session on memory and never writes the secret to prefs", async () => {
    const chain = memoryKeychain("memory only");
    expect(chain.available).toBe(false);
    await expect(chain.write("super-secret")).rejects.toThrow(/not available/);
    expect(await chain.exists()).toBe(false);
    const data: Record<string, string> = {};
    const storage = {
      getItem: (key: string) => data[key] ?? null,
      setItem: (key: string, value: string) => {
        data[key] = value;
      },
    };
    writeAiPrefs({ provider: "cloud", baseUrl: "https://example.com/v1", model: "m", rememberKey: true }, storage);
    expect(JSON.stringify(data)).not.toContain("super-secret");
    expect(readAiPrefs(storage).rememberKey).toBe(true);
  });

  it("stores through the desktop command and only learns whether a key exists", async () => {
    const calls: { command: string; args?: Record<string, unknown> }[] = [];
    let stored = "";
    const chain = tauriKeychain(async (command, args) => {
      calls.push({ command, args });
      if (command === "ai_keychain_set") {
        stored = String(args?.secret ?? "");
        return null;
      }
      if (command === "ai_keychain_exists") return stored.length > 0;
      if (command === "ai_keychain_delete") {
        stored = "";
        return null;
      }
      if (command === "ai_keychain_get") return stored;
      return null;
    });
    expect(chain.available).toBe(true);
    expect(chain.reason).not.toContain("super-secret");
    await chain.write("super-secret");
    expect(await chain.exists()).toBe(true);
    await chain.remove();
    expect(await chain.exists()).toBe(false);
    expect(calls.map((call) => call.command)).toEqual([
      "ai_keychain_set",
      "ai_keychain_exists",
      "ai_keychain_delete",
      "ai_keychain_exists",
    ]);
    expect(calls.map((call) => call.command)).not.toContain("ai_keychain_get");
    expect(JSON.stringify(calls)).toContain("super-secret");
    expect(chain.reason).not.toContain("super-secret");
  });

  it("does not treat a plaintext command result as the stored key", async () => {
    const chain = tauriKeychain(async (command) => {
      if (command === "ai_keychain_exists") return "super-secret";
      return null;
    });
    expect(await chain.exists()).toBe(false);
    expect(chain.reason).not.toContain("super-secret");
  });
});
