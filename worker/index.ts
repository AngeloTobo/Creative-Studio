import { routeCreativeStudioApi } from "./routes/api";
import type { Env } from "./types";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/creative-studio/")) {
      return routeCreativeStudioApi(request, env);
    }
    if (url.pathname.startsWith("/api/")) {
      return new Response(JSON.stringify({ ok: false, error: "api_route_not_found" }), {
        status: 404,
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
      });
    }
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("Creative Studio assets are not built.", { status: 503 });
  },
} satisfies ExportedHandler<Env>;
