export type StudioView = "portal" | "cockpit" | "dna" | "media" | "library" | "gallery" | "projects" | "flows" | "queue" | "runtime" | "settings" | "system";

export const VIEW_TITLES: Record<StudioView, [string, string]> = {
  portal: ["Welcome back, Angelo.", "This is your Creative Studio. What shall we make today?"],
  cockpit: ["Production Cockpit", "Cross-project decisions, runs, recovery, runners, and retained storage."],
  dna: ["Create", "Choose a model, add a source if needed, then generate."],
  media: ["Media", "Upload, retain, and inspect real project source assets."],
  library: ["Library", "CreativeDNA versions, decisions, and retained memory."],
  gallery: ["Artifact History", "Review outputs, lineage, and explicit decisions."],
  projects: ["Projects", "Switch workspaces, continue the next task, or open project tools."],
  flows: ["Workflows", "Upload, customize, version, and reuse ComfyUI graphs."],
  queue: ["Creative Queue", "Durable job state that survives navigation and reloads."],
  runtime: ["Runtime", "Real capability state without leaking credentials."],
  settings: ["Settings", "Application and adapter behavior."],
  system: ["System", "Local execution, service health, and paired machines."],
};
