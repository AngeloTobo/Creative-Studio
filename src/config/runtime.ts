export type StudioAdapterMode = "development" | "http";

export const LOCAL_HTTP_POLL_INTERVAL_MS = 2_000;
export const PC_HOST_HTTP_POLL_INTERVAL_MS = 5_000;
export const REMOTE_HTTP_POLL_INTERVAL_MS = 60_000;

export function resolveStudioAdapterMode(configured: string | undefined, developmentBuild: boolean): StudioAdapterMode {
  if (!configured) return developmentBuild ? "development" : "http";
  if (configured === "development" || configured === "http") return configured;
  throw new Error(`Invalid VITE_CREATIVE_STUDIO_ADAPTER: ${configured}`);
}

export function resolveHttpPollInterval(configured: string | undefined, hostname: string, pcHosted: string | undefined = undefined) {
  if (pcHosted !== undefined && pcHosted !== "true" && pcHosted !== "false") {
    throw new Error(`Invalid VITE_CREATIVE_STUDIO_PC_HOST: ${pcHosted}`);
  }
  if (pcHosted === "true") {
    const allowed = ["127.0.0.1", "localhost", "cs.angelotoborg.com"];
    if (!allowed.includes(hostname)) throw new Error("PC-hosted polling is restricted to approved Creative Studio hosts");
    return hostname === "127.0.0.1" || hostname === "localhost" ? LOCAL_HTTP_POLL_INTERVAL_MS : PC_HOST_HTTP_POLL_INTERVAL_MS;
  }
  if (!configured || configured === "false") return REMOTE_HTTP_POLL_INTERVAL_MS;
  if (configured !== "true") throw new Error(`Invalid VITE_CREATIVE_STUDIO_LOCAL: ${configured}`);
  if (hostname !== "127.0.0.1" && hostname !== "localhost") {
    throw new Error("VITE_CREATIVE_STUDIO_LOCAL is allowed only on localhost");
  }
  return LOCAL_HTTP_POLL_INTERVAL_MS;
}
