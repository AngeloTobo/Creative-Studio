import { describe, expect, it } from "vitest";
import { archiveSourceErrorMessage, isArchiveSourceError } from "../../src/app/archiveSourceErrorMessage";

describe("archive source error messages", () => {
  it("maps connection, stale-item, eligibility, and verification failures to recovery copy", () => {
    expect(archiveSourceErrorMessage(new Error("archive_index_catalog_not_found"))).toMatch(/not connected.*Local Runner/i);
    expect(archiveSourceErrorMessage(new Error("archive_materialization_catalog_changed"))).toMatch(/changed or moved.*refresh/i);
    expect(archiveSourceErrorMessage(new Error("archive_materialization_source_ineligible"))).toMatch(/not ready.*verified image/i);
    expect(archiveSourceErrorMessage(new Error("archive_materialization_size_mismatch"))).toMatch(/safe project copy.*archive file and prompt are unchanged/i);
  });

  it("never exposes an unknown backend code", () => {
    const code = "archive_materialization_internal_storage_code_441";
    const message = archiveSourceErrorMessage(new Error(code));
    expect(message).toMatch(/could not add this image/i);
    expect(message).not.toContain(code);
    expect(message).not.toContain("archive_materialization");
  });

  it("uses browse-specific recovery without exposing invalid cursor codes", () => {
    const code = "invalid_archive_entry_cursor";
    const message = archiveSourceErrorMessage(new Error(code), "browse");
    expect(message).toMatch(/changed or moved.*refresh/i);
    expect(message).not.toContain(code);
  });

  it("recognizes archive errors without claiming unrelated failures", () => {
    expect(isArchiveSourceError(new Error("archive_entry_not_found"))).toBe(true);
    expect(isArchiveSourceError(new Error("video_generation_failed"))).toBe(false);
    expect(isArchiveSourceError("archive_entry_not_found")).toBe(false);
  });
});
