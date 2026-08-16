import { readFileSync } from "node:fs";

const production = process.argv.includes("--production");
const raw = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
const withoutComments = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const config = JSON.parse(withoutComments);
const issues = [];
const target = production ? { ...config, ...(config.env?.production ?? {}) } : config;

const backendMode = target.vars?.BACKEND_MODE ?? "development";
if (!["development", "afdfw"].includes(backendMode)) issues.push(`Unsupported BACKEND_MODE: ${backendMode}`);
if (config.main !== "worker/index.ts") issues.push("Worker entrypoint must remain worker/index.ts");
if (config.assets?.run_worker_first?.[0] !== "/api/creative-studio/*") issues.push("Creative Studio API must run through the Worker before assets");

const d1 = target.d1_databases?.find((binding) => binding.binding === "DB");
if (!d1) issues.push("Missing Creative Studio D1 binding named DB");

if (production) {
  if (backendMode !== "afdfw") issues.push("Production requires BACKEND_MODE=afdfw");
  if (!d1?.database_id || /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(d1.database_id)) issues.push("Production requires a real Creative Studio D1 database ID");
  const hasServiceBinding = target.services?.some((service) => service.binding === "AFDFW");
  const baseUrl = String(target.vars?.AFDFW_BASE_URL ?? "");
  if (!hasServiceBinding && !baseUrl.startsWith("https://")) issues.push("Production requires an AFDFW service binding or HTTPS base URL");
  if (!target.r2_buckets?.some((bucket) => bucket.binding === "ARTIFACTS" && bucket.bucket_name === "creative-studio-artifacts")) issues.push("Production requires the dedicated Creative Studio artifact bucket");
  if (!target.routes?.some((route) => route.pattern === "cs.angelotoborg.com" && route.custom_domain === true)) issues.push("Production requires the cs.angelotoborg.com custom domain");
  if (target.workers_dev !== false) issues.push("Production must disable the public workers.dev route");
}

if (issues.length) {
  console.error(issues.map((issue) => `- ${issue}`).join("\n"));
  process.exit(1);
}

console.log(production
  ? "Creative Studio production environment contract is ready."
  : `Creative Studio local environment contract is valid (${backendMode} backend mode).`);
