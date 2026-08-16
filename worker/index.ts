import { routeCreativeStudioApi } from "./routes/api";
import { consumeJobQueue, sweepBackgroundJobs } from "./jobs";
import type { Env, JobMessage } from "./types";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const runnerHost = url.hostname === "runner.cs.angelotoborg.com";
    if (runnerHost && !url.pathname.startsWith("/api/creative-studio/runner/")) {
      return new Response(JSON.stringify({ ok: false, error: "runner_route_not_found" }), {
        status: 404,
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
      });
    }
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
  async queue(batch: MessageBatch<JobMessage>, env: Env): Promise<void> {
    await consumeJobQueue(batch, env);
  },
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    await sweepBackgroundJobs(env);
  },
} satisfies ExportedHandler<Env, JobMessage>;
