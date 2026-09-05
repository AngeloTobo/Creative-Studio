import { expect, it } from "vitest";
import { supportsMeshOutput } from "../../worker/runner";

it("claims mesh work only after the image-conditioned runner fix", () => {
  for (const version of [null, "invalid", "1.22.0", "1.23.0"]) expect(supportsMeshOutput(version)).toBe(false);
  for (const version of ["1.23.1", "1.24.0", "2.0.0"]) expect(supportsMeshOutput(version)).toBe(true);
});
