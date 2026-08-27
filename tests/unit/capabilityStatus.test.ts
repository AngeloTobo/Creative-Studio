import { describe, expect, it } from "vitest";
import type { Capability } from "../../shared/contracts";
import { capabilitiesNeedingAttention, isCapabilityOffByDesign } from "../../src/features/runtime/capabilityStatus";

const checkedAt = "2026-08-26T12:00:00.000Z";

function capability(overrides: Partial<Capability>): Capability {
  return {
    key: "local-runner",
    label: "Local runner",
    state: "available",
    provider: "Creative Studio",
    detail: "Ready.",
    checkedAt,
    ...overrides,
  };
}

describe("capability status presentation", () => {
  it("treats explicitly remote-only AFDFW routes as off by design", () => {
    const remoteOnly = capability({ key: "afdfw-session", state: "unavailable", provider: "remote mode only" });
    expect(isCapabilityOffByDesign(remoteOnly)).toBe(true);
    expect(capabilitiesNeedingAttention([remoteOnly])).toEqual([]);
  });

  it("keeps actual AFDFW configuration failures and local failures visible", () => {
    const remoteFailure = capability({ key: "afdfw-session", state: "unavailable", provider: "approved-session handoff" });
    const localFailure = capability({ key: "local-runner", state: "unavailable", provider: "Creative Studio" });
    expect(capabilitiesNeedingAttention([remoteFailure, localFailure])).toEqual([remoteFailure, localFailure]);
  });
});
