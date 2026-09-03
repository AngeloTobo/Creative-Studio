function archiveSourceErrorCode(error: unknown) {
  return error instanceof Error ? error.message.trim() : "";
}

export function isArchiveSourceError(error: unknown) {
  const code = archiveSourceErrorCode(error);
  return code.startsWith("archive_") || code.startsWith("archive-");
}

export function archiveSourceErrorMessage(error: unknown, operation: "browse" | "add" = "add") {
  const code = archiveSourceErrorCode(error);

  if (code === "archive_index_requires_creative_studio_worker"
    || code === "archive_index_unavailable"
    || code === "archive_index_catalog_not_found"
    || code === "archive_catalog_not_found"
    || code === "archive_catalog_unavailable") {
    return "Angelo Art Index is not connected yet. Start the Local Runner, then try again.";
  }
  if (code === "project_not_found" || code === "project_archived" || code === "project_required") {
    return "Choose an active Creative Studio project, then add this image again.";
  }
  if (code === "archive_entry_not_found"
    || code === "archive_materialization_not_found"
    || code === "archive_materialization_catalog_changed"
    || code === "archive_catalog_changed"
    || code === "archive_materialization_entry_changed"
    || code === "invalid_archive_entry_cursor") {
    return "That archive item changed or moved. Refresh Angelo Art Index and choose it again.";
  }
  if (code === "archive_entry_unavailable"
    || code === "archive_entry_not_materializable"
    || code === "archive_materialization_source_unavailable"
    || code === "archive_materialization_source_ineligible"
    || code === "archive_materialization_unsupported_media"
    || code === "archive_materialization_media_too_large") {
    return "This item is not ready to use. Choose another verified image from Angelo Art Index.";
  }
  if (code === "archive_materialization_size_mismatch"
    || code === "archive_materialization_verification_failed"
    || code === "archive_materialization_copy_verification_failed"
    || code === "archive_materialization_source_mismatch"
    || code === "archive_materialization_not_claimable"
    || code === "archive_materialization_not_completable"
    || code === "archive_materialization_asset_missing") {
    return "Creative Studio could not make a safe project copy. Your archive file and prompt are unchanged. Try again.";
  }
  if (code === "archive_materialization_timed_out"
    || code === "archive_materialization_runner_unavailable"
    || code === "archive_materialization_runner_offline"
    || code === "runner_revoked") {
    return "The Local Runner did not finish adding this image. Check that it is running, then try again.";
  }

  return operation === "browse"
    ? "Creative Studio could not open Angelo Art Index. Your prompt is unchanged. Try again."
    : "Creative Studio could not add this image. Your archive file and prompt are unchanged. Try again.";
}
