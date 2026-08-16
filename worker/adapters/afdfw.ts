import type { GenerationModality } from "../../shared/contracts";
import type { Env, OwnerSession } from "../types";

const EXACT_ALLOWLIST = new Set([
  "GET /api/me",
  "POST /api/profile-song/generate",
  "GET /api/profile-song/generations",
  "POST /api/profile-image/generate",
  "GET /api/profile-image/generations",
]);

function isAllowed(method: string, path: string) {
  if (EXACT_ALLOWLIST.has(`${method} ${path}`)) return true;
  if (method !== "GET") return false;
  return /^\/api\/profile-(song|image)\/generations\/[a-z0-9_-]+$/i.test(path)
    || /^\/api\/profile-(song|image)\/media\/[a-z0-9_-]+$/i.test(path);
}

async function call(env: Env, incoming: Request, path: string, init: RequestInit = {}) {
  const method = String(init.method ?? "GET").toUpperCase();
  if (!isAllowed(method, path)) throw new Error("afdfw_capability_not_allowlisted");
  const headers = new Headers(init.headers);
  const cookie = incoming.headers.get("cookie");
  const accessJwt = incoming.headers.get("cf-access-jwt-assertion");
  const accessEmail = incoming.headers.get("cf-access-authenticated-user-email");
  if (cookie) headers.set("cookie", cookie);
  if (accessJwt) headers.set("cf-access-jwt-assertion", accessJwt);
  if (accessEmail) headers.set("cf-access-authenticated-user-email", accessEmail);
  if (env.AFDFW_SERVICE_TOKEN) headers.set("x-creative-studio-token", env.AFDFW_SERVICE_TOKEN);
  headers.set("accept", "application/json");

  if (env.AFDFW) {
    return env.AFDFW.fetch(new Request(`https://afdfw.internal${path}`, { ...init, method, headers }));
  }
  const base = String(env.AFDFW_BASE_URL ?? "").replace(/\/+$/, "");
  if (!base) throw new Error("afdfw_backend_not_configured");
  const target = new URL(path, `${base}/`);
  const baseUrl = new URL(base);
  if (target.origin !== baseUrl.origin) throw new Error("afdfw_origin_mismatch");
  return fetch(new Request(target, { ...init, method, headers }));
}

async function payload<T>(response: Response): Promise<T> {
  const value = await response.json() as T & { ok?: boolean; error?: string };
  if (!response.ok || value.ok === false) throw new Error(value.error || `afdfw_${response.status}`);
  return value;
}

export async function afdfwSession(env: Env, request: Request): Promise<OwnerSession> {
  const response = await call(env, request, "/api/me");
  if (response.status === 401 || response.status === 403) throw new Error("approved_login_required");
  const value = await payload<{ status: string; user?: { id?: string }; profile?: { displayName?: string } }>(response);
  if (value.status !== "approved" || !value.user?.id) throw new Error("approved_login_required");
  return {
    status: "approved",
    userId: value.user.id,
    displayName: value.profile?.displayName || "Angelo",
    setCookie: response.headers.get("set-cookie") || undefined,
  };
}

export type AfdfwGeneration = {
  id: string;
  prompt: string;
  status: string;
  progress?: number;
  previewMediaId?: string | null;
  mediaUrl?: string;
  error?: string | null;
  createdAt: string;
  updatedAt: string;
};

export async function afdfwSubmitGeneration(env: Env, request: Request, modality: GenerationModality, prompt: string) {
  const path = modality === "music" ? "/api/profile-song/generate" : "/api/profile-image/generate";
  const input = modality === "music" ? { prompt } : { prompt, medium: "Digital Art", size: "portrait" };
  const response = await call(env, request, path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (response.status === 409) {
    const conflict = await response.json() as { error?: string; generationId?: string };
    if (conflict.error === "generation_in_progress" && conflict.generationId) {
      return { generation: await afdfwGeneration(env, request, modality, conflict.generationId) };
    }
    throw new Error(conflict.error || "generation_in_progress");
  }
  return payload<{ generation: AfdfwGeneration }>(response);
}

export async function afdfwGeneration(env: Env, request: Request, modality: GenerationModality, generationId: string) {
  if (!/^[a-z0-9_-]+$/i.test(generationId)) throw new Error("invalid_upstream_generation_id");
  const kind = modality === "music" ? "song" : "image";
  const response = await call(env, request, `/api/profile-${kind}/generations/${encodeURIComponent(generationId)}`);
  return (await payload<{ generation: AfdfwGeneration }>(response)).generation;
}

export async function afdfwGenerations(env: Env, request: Request, modality: GenerationModality) {
  const path = modality === "music" ? "/api/profile-song/generations" : "/api/profile-image/generations";
  const response = await call(env, request, path);
  return payload<{ generations: AfdfwGeneration[] }>(response);
}

export async function afdfwMedia(env: Env, request: Request, mediaPath: string) {
  if (!mediaPath.startsWith("/api/profile-song/media/") && !mediaPath.startsWith("/api/profile-image/media/")) {
    throw new Error("afdfw_media_not_allowlisted");
  }
  return call(env, request, mediaPath);
}

export const AFDFW_ALLOWLIST = Object.freeze([...EXACT_ALLOWLIST]);
