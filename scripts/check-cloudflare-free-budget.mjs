import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const config = JSON.parse(readFileSync(new URL("wrangler.jsonc", root), "utf8"));
const production = config.env?.production ?? {};
const runner = readFileSync(new URL("runner/index.mjs", root), "utf8");
const provider = readFileSync(new URL("src/app/StudioProvider.tsx", root), "utf8");
const adapter = readFileSync(new URL("src/adapters/httpAdapter.ts", root), "utf8");
const jobs = readFileSync(new URL("worker/jobs.ts", root), "utf8");
const issues = [];

const consumer = production.queues?.consumers?.find((item) => item.queue === "creative-studio-jobs");
if (!production.triggers?.crons?.includes("0 * * * *")) issues.push("Recovery cron must run no more than hourly.");
if (Number(consumer?.max_retries ?? 99) > 3) issues.push("Queue retries must stay capped at three.");
if (!runner.includes("MIN_IDLE_POLL_INTERVAL_MS = 60_000")) issues.push("Runner idle polling must stay at one minute or slower.");
if (!runner.includes("/api/creative-studio/runner/work/claim")) issues.push("Runner must use the consolidated work-claim request.");
if (!provider.includes('adapter.id === "development-local-storage" ? 1_000 : 60_000')) issues.push("The real HTTP adapter must refresh no faster than once per minute.");
if (!provider.includes('document.visibilityState === "visible"')) issues.push("Background tabs must not poll the Worker.");
if (!adapter.includes("CREATIVE_STUDIO_ROUTES.snapshot")) issues.push("Browser reads must use the consolidated snapshot route.");
if (!jobs.includes("enqueueJob(env, job.id, 60)")) issues.push("AFDFW Queue reconciliation must wait at least 60 seconds.");
for (const binding of ["durable_objects", "workflows", "containers", "browser"]) {
  if (production[binding]) issues.push(`Paid-only binding must not be configured: ${binding}.`);
}

if (issues.length) {
  process.stderr.write(`${issues.map((issue) => `- ${issue}`).join("\n")}\n`);
  process.exit(1);
}

const runnerIdleRequestsPerDay = 24 * 60;
const visibleActiveBrowserRequestsPerDay = 24 * 60;
const recoveryRequestsPerDay = 24;
const baseline = runnerIdleRequestsPerDay + visibleActiveBrowserRequestsPerDay + recoveryRequestsPerDay;
process.stdout.write(`Creative Studio free-tier guard passed: <=${baseline.toLocaleString("en-US")} baseline Worker invocations/day before explicit user actions or active Queue messages.\n`);
