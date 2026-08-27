import { describe, expect, it } from "vitest";
import { compileProjectContext } from "../../src/features/generation/projectContext";

describe("project context", () => {
  it("strips known provenance-only commercial identities before provider text", () => {
    const result = compileProjectContext({
      description: "An original glass organism with Blade Runner lighting and a tender internal pulse.",
      note: "Move away from Blade Runner's city language and into wet mineral space.",
      authoredDirection: "A translucent organism suspended in darkness.",
      excludedReferenceIdentities: ["Blade Runner"],
    });
    expect(result.text).toBe("Project context: An original glass organism with lighting and a tender internal pulse. Current scene: Move away from city language and into wet mineral space.");
    expect(result.text).not.toMatch(/Blade Runner/i);
    expect(result.excludedReferenceIdentityMentions).toBe(2);
  });

  it("strips a one-character identity without removing it inside other words", () => {
    const result = compileProjectContext({
      description: "X lighting around an extra-soft organism.",
      note: "Move away from X's styling and keep the texture.",
      authoredDirection: "A translucent organism suspended in darkness.",
      excludedReferenceIdentities: ["X"],
    });
    expect(result.text).toContain("extra-soft organism");
    expect(result.text).not.toMatch(/(?:^|\s)X(?:'s)?(?:\s|$)/i);
    expect(result.excludedReferenceIdentityMentions).toBe(2);
  });

  it("suppresses whole fields already present and labels legacy text as Project context", () => {
    const result = compileProjectContext({
      description: "A luminous embryo suspended in violet space.",
      note: "The camera stays intimate.",
      authoredDirection: "A luminous embryo suspended in violet space.",
    });
    expect(result.text).toBe("Project context: Current scene: The camera stays intimate.");
    expect(result.text).not.toContain("World continuity");
  });

  it("bounds long legacy fields without claiming clause-level deduplication", () => {
    const result = compileProjectContext({
      description: "organic material ".repeat(80),
      note: "slow orbit ".repeat(50),
      authoredDirection: "new frame",
    });
    expect(result.text.length).toBeLessThanOrEqual(900);
    expect(result.truncated).toBe(true);
  });
});
