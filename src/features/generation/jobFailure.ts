import type { GenerationModality, JobStatus } from "../../../shared/contracts";

export type JobIssuePresentation = {
  title: string;
  summary: string;
  action: string;
  raw: string;
};

const FAILURE_SUMMARIES: Record<string, string> = {
  approved_login_required: "The AFDFW session is no longer approved. Sign in again, refresh Creative Studio, and retry.",
  background_identity_required: "The job did not have a verified Cloudflare Access identity for background processing. Reload after signing in and retry.",
  generation_not_found: "AFDFW no longer has the upstream generation. Retry to create a new generation without deleting this job record.",
  generation_media_missing: "The provider finished generation but did not return a media file. Confirm the ComfyUI workflow has a saved output node, then retry.",
  artifact_media_not_found: "The generated result could not be retrieved for retention. Confirm AFDFW and ComfyUI can still serve the output, then retry.",
  artifact_retention_not_configured: "Creative Studio artifact storage is not connected. Restore the R2 binding before retrying.",
  artifact_retention_verification_failed: "Creative Studio received media bytes that did not match the provider's declared size. Check the upstream output, then retry retention through a new job.",
  generation_in_progress: "The provider already has an active generation for this capability. Let it finish or cancel it upstream before retrying.",
  generation_timed_out: "The remote AFDFW generation did not finish inside its 30-minute durable tracking window. Its timing and settings remain in history; inspect the stamped workload before retrying.",
  comfyui_execution_timed_out: "Local ComfyUI did not return an output inside the 24-hour safety window. The prompt ID and settings remain recorded so the machine and workflow can be inspected before retrying.",
  comfyui_workflow_media_output_missing: "The selected ComfyUI workflow has no executable saved-media output for this generation type. Add or repair its Save Image, Save Audio, or Save Video node before retrying.",
  comfyui_media_output_not_scheduled: "ComfyUI accepted the graph but did not schedule its saved-media output. The job stopped immediately instead of blocking the runner; repair or re-export the workflow before retrying.",
  comfyui_completed_without_media_output: "ComfyUI completed without returning a saved media file. The job stopped immediately instead of occupying the runner; inspect the workflow output node before retrying.",
  runner_input_source_not_found: "A bound upload or generated artifact is no longer retained. Choose a current retained input and queue a new run.",
  runner_input_media_mismatch: "A bound workflow input has the wrong media type. Choose an image, audio file, or video that matches the workflow control.",
};

function sentence(value: string) {
  const readable = value.replaceAll("_", " ").replaceAll("-", " ").trim();
  return readable ? `${readable.charAt(0).toUpperCase()}${readable.slice(1)}.` : "The provider did not return a failure code.";
}

export function jobIssuePresentation(status: JobStatus, error: string | null, modality: GenerationModality): JobIssuePresentation | null {
  if (status !== "failed" && status !== "cancelled") return null;
  const raw = error?.trim() || (status === "cancelled" ? "cancelled_by_user" : "unknown_generation_failure");
  if (status === "cancelled") {
    return {
      title: "Tracking cancelled",
      summary: "Creative Studio stopped tracking this job. An upstream generation that had already started may still finish outside this job.",
      action: `Retry creates a new durable ${modality} job from the same CreativeDNA; this cancelled job remains in history.`,
      raw,
    };
  }
  const summary = FAILURE_SUMMARIES[raw]
    ?? (raw.startsWith("afdfw_media_")
      ? "AFDFW could not serve the generated media. Check the AFDFW/ComfyUI media route, then retry."
      : raw.startsWith("comfyui_prompt_rejected")
        ? "ComfyUI rejected the saved workflow before execution. Open the provider detail below, correct the named node or setting, save a new workflow version, and retry."
        : raw.startsWith("comfyui_execution_failed")
          ? "ComfyUI failed while executing the workflow. Review the provider detail and machine logs, correct the workflow or model state, then retry as a new durable job."
          : sentence(raw));
  return {
    title: "Job failed",
    summary,
    action: `Retry creates a new durable ${modality} job from the same CreativeDNA; this failed job remains in history.`,
    raw,
  };
}
