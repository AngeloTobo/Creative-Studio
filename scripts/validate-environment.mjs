import { readFileSync } from "node:fs";

const production = process.argv.includes("--production");
const raw = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
const config = JSON.parse(raw);
const issues = [];
const target = production ? { ...config, ...(config.env?.production ?? {}) } : config;

const backendMode = target.vars?.BACKEND_MODE ?? "development";
const localHardwareOnly = target.vars?.LOCAL_HARDWARE_ONLY;
if (!["development", "afdfw"].includes(backendMode)) issues.push(`Unsupported BACKEND_MODE: ${backendMode}`);
if (production && localHardwareOnly !== "false") issues.push("Production must keep LOCAL_HARDWARE_ONLY=false");
if (!production && backendMode === "development" && localHardwareOnly !== "true") issues.push("Local development must keep LOCAL_HARDWARE_ONLY=true");
if (config.main !== "worker/index.ts") issues.push("Worker entrypoint must remain worker/index.ts");
if (config.assets?.run_worker_first?.[0] !== "/*") issues.push("Creative Studio must run the Worker before assets so the runner hostname stays API-only");

const d1 = target.d1_databases?.find((binding) => binding.binding === "DB");
if (!d1) issues.push("Missing Creative Studio D1 binding named DB");

if (production) {
  if (backendMode !== "afdfw") issues.push("Production requires BACKEND_MODE=afdfw");
  if (!d1?.database_id || /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(d1.database_id)) issues.push("Production requires a real Creative Studio D1 database ID");
  const hasServiceBinding = target.services?.some((service) => service.binding === "AFDFW");
  const baseUrl = String(target.vars?.AFDFW_BASE_URL ?? "");
  if (!hasServiceBinding && !baseUrl.startsWith("https://")) issues.push("Production requires an AFDFW service binding or HTTPS base URL");
  if (!target.r2_buckets?.some((bucket) => bucket.binding === "ARTIFACTS" && bucket.bucket_name === "creative-studio-artifacts")) issues.push("Production requires the dedicated Creative Studio artifact bucket");
  if (!target.queues?.producers?.some((queue) => queue.binding === "JOB_QUEUE" && queue.queue === "creative-studio-jobs")) issues.push("Production requires the Creative Studio job queue producer binding");
  if (!target.queues?.consumers?.some((queue) => queue.queue === "creative-studio-jobs")) issues.push("Production requires the Creative Studio job queue consumer");
  if (!target.triggers?.crons?.includes("0 * * * *")) issues.push("Production requires the hourly free-tier recovery trigger");
  const consumer = target.queues?.consumers?.find((queue) => queue.queue === "creative-studio-jobs");
  if (Number(consumer?.max_retries ?? 99) > 3) issues.push("Production queue retries must stay capped at three for the free-tier budget");
  if (!target.routes?.some((route) => route.pattern === "cs.angelotoborg.com" && route.custom_domain === true)) issues.push("Production requires the cs.angelotoborg.com custom domain");
  if (!target.routes?.some((route) => route.pattern === "runner.cs.angelotoborg.com" && route.custom_domain === true)) issues.push("Production requires the token-authenticated runner.cs.angelotoborg.com custom domain");
  if (target.workers_dev !== false) issues.push("Production must disable the public workers.dev route");
}

if (issues.length) {
  console.error(issues.map((issue) => `- ${issue}`).join("\n"));
  process.exit(1);
}

console.log(production
  ? "Creative Studio production environment contract is ready."
  : `Creative Studio local environment contract is valid (${backendMode} backend mode).`);
