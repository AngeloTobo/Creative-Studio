import { describe, expect, it } from "vitest";
import { resolveStudioAdapterMode } from "../../src/config/runtime";

describe("runtime environment validation", () => {
  it("uses explicit browser modes and safe build defaults", () => {
    expect(resolveStudioAdapterMode(undefined, true)).toBe("development");
    expect(resolveStudioAdapterMode(undefined, false)).toBe("http");
    expect(resolveStudioAdapterMode("http", true)).toBe("http");
    expect(() => resolveStudioAdapterMode("mock-ish", true)).toThrow("Invalid VITE_CREATIVE_STUDIO_ADAPTER");
  });
});
