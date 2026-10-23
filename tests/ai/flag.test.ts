import { describe, expect, it } from "vitest";
import {
  AI_DIRECTOR_FLAG_KEY,
  readAiDirectorEnabled,
  writeAiDirectorEnabled,
} from "../../src/app/ai/flag";

function memoryStorage(initial?: Record<string, string>) {
  const data = { ...(initial ?? {}) };
  return {
    data,
    getItem(key: string) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key]! : null;
    },
    setItem(key: string, value: string) {
      data[key] = value;
    },
  };
}

describe("AI Director feature flag", () => {
  it("is off when storage is missing, empty, or any value other than 1", () => {
    expect(readAiDirectorEnabled(null)).toBe(false);
    expect(readAiDirectorEnabled(undefined)).toBe(false);
    expect(readAiDirectorEnabled(memoryStorage())).toBe(false);
    expect(readAiDirectorEnabled(memoryStorage({ [AI_DIRECTOR_FLAG_KEY]: "0" }))).toBe(false);
    expect(readAiDirectorEnabled(memoryStorage({ [AI_DIRECTOR_FLAG_KEY]: "true" }))).toBe(false);
    expect(readAiDirectorEnabled(memoryStorage({ [AI_DIRECTOR_FLAG_KEY]: "1" }))).toBe(true);
  });

  it("writes 1 or 0 and does not throw when storage rejects", () => {
    const storage = memoryStorage();
    writeAiDirectorEnabled(true, storage);
    expect(storage.data[AI_DIRECTOR_FLAG_KEY]).toBe("1");
    expect(readAiDirectorEnabled(storage)).toBe(true);
    writeAiDirectorEnabled(false, storage);
    expect(storage.data[AI_DIRECTOR_FLAG_KEY]).toBe("0");
    expect(readAiDirectorEnabled(storage)).toBe(false);
    expect(() =>
      writeAiDirectorEnabled(true, {
        getItem: () => {
          throw new Error("denied");
        },
        setItem: () => {
          throw new Error("denied");
        },
      }),
    ).not.toThrow();
    expect(readAiDirectorEnabled({
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {},
    })).toBe(false);
  });

  it("uses the V6 localStorage prefix and not the V5.6 prefix", () => {
    expect(AI_DIRECTOR_FLAG_KEY.startsWith("resonance-studio-v6-0-")).toBe(true);
    expect(AI_DIRECTOR_FLAG_KEY.includes("v5-5")).toBe(false);
  });
});
