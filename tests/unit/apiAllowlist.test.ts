import { describe, expect, it } from "vitest";
import { matchCreativeStudioRoute } from "../../shared/contracts";

describe("Creative Studio BFF route allowlist", () => {
  it("matches only named product capabilities", () => {
    expect(matchCreativeStudioRoute("GET", "/api/creative-studio/dna")).toBe("dna-list");
    expect(matchCreativeStudioRoute("POST", "/api/creative-studio/jobs")).toBe("jobs-create");
    expect(matchCreativeStudioRoute("POST", "/api/creative-studio/artifacts/artifact_123/accepted")).toBe("artifact-review");
  });

  it("does not become a generic AFDFW proxy", () => {
    expect(matchCreativeStudioRoute("GET", "/api/creative-studio/admin")) .toBeNull();
    expect(matchCreativeStudioRoute("POST", "/api/creative-studio/proxy/api/profile")) .toBeNull();
    expect(matchCreativeStudioRoute("GET", "/api/profile-image/generations")) .toBeNull();
  });
});
