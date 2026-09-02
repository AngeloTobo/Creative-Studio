function errorCode(error: unknown) {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "";
}

function normalizedErrorCode(error: unknown) {
  return errorCode(error).toLowerCase().replace(/[\s-]+/g, "_");
}

export function isVideoPromptEnhancementError(error: unknown) {
  const code = normalizedErrorCode(error);
  return code.includes("video_prompt_enhancement") || code.startsWith("prompt_enhancement_");
}

export function videoPromptEnhancementErrorMessage(error: unknown) {
  const code = normalizedErrorCode(error);

  if (code.includes("picture_alignment") || code.includes("picture_reference")) {
    return "Local Gemma returned a motion plan Creative Studio could not safely align to your source.";
  }
  if (code.includes("timing_invalid")) {
    return "Local Gemma placed a shot outside the selected video length.";
  }
  if (code.includes("timeline_invalid")) {
    return "Local Gemma returned an incomplete timed video plan.";
  }
  if (code.includes("length_invalid")) {
    return "Local Gemma returned a video direction outside the safe length.";
  }
  if (code.includes("metadata_leak")) {
    return "Local Gemma returned setup instructions instead of a usable video direction.";
  }
  if (code.includes("context_mismatch") || code.includes("workflow_mismatch") || code.includes("duration_mismatch")
    || code.includes("input_mode_mismatch") || code.includes("source_binding")) {
    return "The image, model, or video length changed while Local Gemma was working.";
  }

  return "Local Gemma could not prepare a safe Enhanced version.";
}
