import type { ApiFailure, ApiSuccess } from "../../shared/contracts";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

export function json<T extends object>(payload: ApiSuccess<T> | ApiFailure, init: ResponseInit = {}) {
  return new Response(JSON.stringify(payload), { ...init, headers: { ...JSON_HEADERS, ...init.headers } });
}

export async function body<T>(request: Request): Promise<T | null> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) return null;
  return request.json<T>().catch(() => null);
}

export function id(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
}

export function boundedText(value: unknown, limit: number) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
}
