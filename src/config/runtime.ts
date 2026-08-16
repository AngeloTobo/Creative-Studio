export type StudioAdapterMode = "development" | "http";

export function resolveStudioAdapterMode(configured: string | undefined, developmentBuild: boolean): StudioAdapterMode {
  if (!configured) return developmentBuild ? "development" : "http";
  if (configured === "development" || configured === "http") return configured;
  throw new Error(`Invalid VITE_CREATIVE_STUDIO_ADAPTER: ${configured}`);
}
