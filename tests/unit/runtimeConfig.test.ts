import { describe, expect, it } from "vitest";
import {
  LOCAL_HTTP_POLL_INTERVAL_MS,
  REMOTE_HTTP_POLL_INTERVAL_MS,
  resolveHttpPollInterval,
  resolveStudioAdapterMode,
} from "../../src/config/runtime";

describe("runtime environment validation", () => {
  it("uses explicit browser modes and safe build defaults", () => {
    expect(resolveStudioAdapterMode(undefined, true)).toBe("development");
    expect(resolveStudioAdapterMode(undefined, false)).toBe("http");
    expect(resolveStudioAdapterMode("http", true)).toBe("http");
    expect(() => resolveStudioAdapterMode("mock-ish", true)).toThrow("Invalid VITE_CREATIVE_STUDIO_ADAPTER");
  });

  it("permits fast HTTP refresh only on an explicitly local browser", () => {
    expect(resolveHttpPollInterval("true", "127.0.0.1")).toBe(LOCAL_HTTP_POLL_INTERVAL_MS);
    expect(resolveHttpPollInterval("true", "localhost")).toBe(LOCAL_HTTP_POLL_INTERVAL_MS);
    expect(resolveHttpPollInterval(undefined, "cs.angelotoborg.com")).toBe(REMOTE_HTTP_POLL_INTERVAL_MS);
    expect(resolveHttpPollInterval("false", "127.0.0.1")).toBe(REMOTE_HTTP_POLL_INTERVAL_MS);
    expect(() => resolveHttpPollInterval("true", "cs.angelotoborg.com")).toThrow("allowed only on localhost");
    expect(() => resolveHttpPollInterval("sometimes", "localhost")).toThrow("Invalid VITE_CREATIVE_STUDIO_LOCAL");
  });
});
