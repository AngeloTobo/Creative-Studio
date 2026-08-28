export function videoScriptErrorMessage(error: unknown) {
  const code = error instanceof Error ? error.message : "video_script_request_failed";
  if (code === "video_script_word_budget_exceeded") return "This is too long for the selected video length. Shorten it or choose a longer video.";
  if (code === "video_script_stage_direction_invalid") return "Keep only words the subject should say; remove speaker labels and stage directions.";
  if (code === "video_full_script_incomplete" || code === "video_full_script_word_budget_invalid") return "Gemma returned a partial scene instead of a complete duration-matched script. Try again; your current direction is unchanged.";
  if (code === "video_full_script_length_invalid") return "Keep the full scene within the model's duration-matched script length.";
  if (code === "video_full_script_timeline_invalid") return "Keep the model-specific SHOT timeline and Audio line in the full script.";
  if (code === "video_full_script_picture_alignment_missing") return "Keep the required first-frame Picture 1 instruction at the beginning of this image or extension script.";
  if (code === "video_full_script_timing_invalid") return "Keep every shot timestamp between zero and the selected video length.";
  if (code === "video_script_ending_missing") return "Add a clear final visual beat so the scene has an intentional ending.";
  if (code === "video_script_natural_format_invalid") return "Use chronological prose for this model: no SHOT headings, Audio label, or line breaks.";
  if (code === "video_script_progression_missing") return "Give the scene at least three chronological sentences: opening action, development, and final beat.";
  if (code === "video_script_dialogue_embedded") return "Put spoken words in the Dialogue field, not inside the visual script, so Creative Studio can send them exactly once.";
  if (code === "video_script_spoken_text_invalid") return "Keep Dialogue to one plain spoken line without speaker labels, brackets, or stage directions.";
  if (code === "video_script_unrequested_dialogue") return "Gemma added dialogue you did not request, so Creative Studio rejected the draft. Try again or add the exact line you want.";
  if (code === "video_script_job_prompt_mismatch") return "The model prompt changed after this full script was applied. Review the current direction and write the script again if needed.";
  if (code === "video_script_prompt_derivation_invalid") return "Creative Studio could not verify how this branch was derived from the reviewed script. Start a new script for the current generation setup.";
  if (code === "video_script_source_binding_invalid") return "The selected source no longer matches this script. Reselect the image or video, then write the script again.";
  if (code === "video_script_output_invalid" || code === "video_script_output_invalid_json") return "Gemma returned the wrong script format. Try again; your current direction is unchanged.";
  if (code === "video_script_workflow_mismatch" || code === "video_script_duration_mismatch" || code === "video_script_input_mode_mismatch") return "The model, source, or length changed. Write a new full script for the current setup.";
  if (code === "video_script_version_conflict") return "This script changed in another view. Review the newest draft and try again.";
  if (code === "continuity_commercial_identity_in_prompt") return "Remove named commercial references; describe only the traits you want to preserve.";
  return code.replaceAll("_", " ");
}
