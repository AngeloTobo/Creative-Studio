import { readFileSync } from "node:fs";
import { retiredCloudDeploymentIssues, retiredCloudExecutionIssues } from "./cloud-execution-policy.mjs";

const production = process.argv.includes("--production");
const raw = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
const config = JSON.parse(raw);
const retirementConfig = production
  ? JSON.parse(readFileSync(new URL("../wrangler.retired.jsonc", import.meta.url), "utf8"))
  : undefined;
const issues = [];
const target = production ? { ...config, ...(config.env?.production ?? {}) } : config;

const backendMode = target.vars?.BACKEND_MODE ?? "development";
const localHardwareOnly = target.vars?.LOCAL_HARDWARE_ONLY;
if (!production && !["development", "self-hosted", "afdfw"].includes(backendMode)) issues.push(`Unsupported BACKEND_MODE: ${backendMode}`);
if (!production && backendMode === "development" && localHardwareOnly !== "true") issues.push("Local development must keep LOCAL_HARDWARE_ONLY=true");
if (config.main !== "worker/index.ts") issues.push("Worker entrypoint must remain worker/index.ts");
if (config.assets?.run_worker_first?.[0] !== "/*") issues.push("Creative Studio must run the Worker before assets so the runner hostname stays API-only");

const d1 = target.d1_databases?.find((binding) => binding.binding === "DB");
if (!production && !d1) issues.push("Missing Creative Studio D1 binding named DB");

if (production) {
  issues.push(...retiredCloudExecutionIssues(config));
  issues.push(...retiredCloudDeploymentIssues(retirementConfig));
}

if (issues.length) {
  console.error(issues.map((issue) => `- ${issue}`).join("\n"));
  process.exit(1);
}

console.log(production
  ? "Creative Studio production Cloudflare execution plane is deliberately retired."
  : `Creative Studio local environment contract is valid (${backendMode} backend mode).`);
