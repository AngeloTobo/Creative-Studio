export type StudioView = "portal" | "dna" | "work" | "studio" | "cockpit" | "media" | "library" | "gallery" | "projects" | "flows" | "queue" | "runtime" | "settings" | "system";

export const VIEW_TITLES: Record<StudioView, [string, string]> = {
  portal: ["Ideas", "Story directions, overnight work, and creative memory."],
  work: ["Work", "Run, review, and evolve without changing screens."],
  studio: ["Studio", "Project context, media, memory, models, and local systems."],
  cockpit: ["Production Dashboard", "Live runs, decisions, retained outputs, and local execution."],
  dna: ["Create", "Describe what you want. Creative Studio handles the setup."],
  media: ["Media", "Upload, retain, and inspect real project source assets."],
  library: ["Library", "CreativeDNA versions, decisions, and retained memory."],
  gallery: ["Artifact History", "Review outputs, lineage, and explicit decisions."],
  projects: ["Projects", "Switch workspaces, continue the next task, or open project tools."],
  flows: ["Workflows", "Upload, customize, version, and reuse ComfyUI graphs."],
  queue: ["Production Dashboard", "Live runs, decisions, retained outputs, and local execution."],
  runtime: ["Runtime", "Real capability state without leaking credentials."],
  settings: ["Settings", "Application and adapter behavior."],
  system: ["System", "Local execution, service health, and paired machines."],
};
