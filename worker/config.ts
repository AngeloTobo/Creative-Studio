import type { Env } from "./types";

export type BackendMode = "development" | "afdfw";

export function backendMode(env: Env): BackendMode {
  const mode = String(env.BACKEND_MODE ?? "development");
  if (mode !== "development" && mode !== "afdfw") throw new Error("invalid_backend_mode");
  if (mode === "afdfw" && !env.AFDFW) {
    const base = String(env.AFDFW_BASE_URL ?? "").trim();
    if (!base) throw new Error("afdfw_backend_not_configured");
    let url: URL;
    try {
      url = new URL(base);
    } catch {
      throw new Error("invalid_afdfw_base_url");
    }
    const localHttp = url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname);
    if (url.protocol !== "https:" && !localHttp) throw new Error("insecure_afdfw_base_url");
  }
  return mode;
}
