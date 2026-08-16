export type StudioView = "portal" | "dna" | "media" | "library" | "gallery" | "projects" | "flows" | "queue" | "runtime" | "settings";

export const VIEW_TITLES: Record<StudioView, [string, string]> = {
  portal: ["Welcome back, Angelo.", "This is your Creative Studio. What shall we make today?"],
  dna: ["CreativeDNA Studio", "Build, train from uploads, and generate in one workspace."],
  media: ["Media", "Upload, retain, and inspect real project source assets."],
  library: ["Library", "CreativeDNA versions, decisions, and retained memory."],
  gallery: ["Artifact History", "Review outputs, lineage, and explicit decisions."],
  projects: ["Projects", "Your creative worlds and systems."],
  flows: ["Workflows", "Upload, customize, version, and reuse ComfyUI graphs."],
  queue: ["Creative Queue", "Durable job state that survives navigation and reloads."],
  runtime: ["Runtime", "Real capability state without leaking credentials."],
  settings: ["Settings", "Application and adapter behavior."],
};
