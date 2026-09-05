import type { Env } from "./types";

export type BackendMode = "development" | "self-hosted" | "afdfw";

export function backendMode(env: Env): BackendMode {
  const mode = String(env.BACKEND_MODE ?? "development");
  if (mode !== "development" && mode !== "self-hosted" && mode !== "afdfw") throw new Error("invalid_backend_mode");
  if (mode === "self-hosted") {
    const ownerId = String(env.SELF_HOSTED_OWNER_ID ?? "").trim();
    const accessEmail = String(env.SELF_HOSTED_ACCESS_EMAIL ?? "").trim();
    const internalToken = String(env.SELF_HOSTED_INTERNAL_TOKEN ?? "").trim();
    if (!ownerId || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(accessEmail) || accessEmail.length > 320 || internalToken.length < 40) {
      throw new Error("self_hosted_owner_not_configured");
    }
  }
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
