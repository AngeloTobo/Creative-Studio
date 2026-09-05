import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { retiredCloudDeploymentIssues, retiredCloudExecutionIssues } from "./cloud-execution-policy.mjs";

const root = new URL("../", import.meta.url);
const config = JSON.parse(readFileSync(new URL("wrangler.jsonc", root), "utf8"));
const retirementConfig = JSON.parse(readFileSync(new URL("wrangler.retired.jsonc", root), "utf8"));
const runner = readFileSync(new URL("runner/index.mjs", root), "utf8");
const provider = readFileSync(new URL("src/app/StudioProvider.tsx", root), "utf8");
const adapter = readFileSync(new URL("src/adapters/httpAdapter.ts", root), "utf8");
const runtime = readFileSync(new URL("src/config/runtime.ts", root), "utf8");
const jobs = readFileSync(new URL("worker/jobs.ts", root), "utf8");
const workerEntry = readFileSync(new URL("worker/index.ts", root), "utf8");
const issues = [];

issues.push(...retiredCloudExecutionIssues(config));
issues.push(...retiredCloudDeploymentIssues(retirementConfig));

function filesUnder(directory, extensions) {
  return readdirSync(new URL(`${directory}/`, root), { withFileTypes: true }).flatMap((entry) => {
    const relative = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return filesUnder(relative, extensions);
    return extensions.some((extension) => entry.name.endsWith(extension)) ? [relative] : [];
  });
}

// The remote archive is intentionally not a row-per-file D1 catalog. One
// 17,353-item sync consumed 192,000 billed writes once table indexes and
// retries were counted. Future archive browsing must keep its bulk manifest
// on the PC and never reserve cloud rows for per-artwork metadata.
const frozenArchiveMigration = "migrations/0025_archive_index.sql";
const frozenArchiveMigrationHash = "f26930ab32d30d0c4a470005bedbb6e8e1798da5fcb03eff79db4eb60d2c6ea6";
const frozenArchiveMigrationSource = readFileSync(new URL(frozenArchiveMigration, root), "utf8").replace(/\r\n/g, "\n");
const actualFrozenArchiveMigrationHash = createHash("sha256").update(frozenArchiveMigrationSource).digest("hex");
if (actualFrozenArchiveMigrationHash !== frozenArchiveMigrationHash) {
  issues.push(`${frozenArchiveMigration} is applied production history and must remain content-immutable.`);
}

const perItemCatalogTable = /(?:archive|catalog|index|manifest).*?(?:entry|item|record|asset|file)|(?:entry|item|record|asset|file).*?(?:archive|catalog|index|manifest)/i;
for (const relative of filesUnder("migrations", [".sql"]).filter((file) => file !== frozenArchiveMigration)) {
  const source = readFileSync(new URL(relative, root), "utf8");
  for (const match of source.matchAll(/\bcreate\s+table(?:\s+if\s+not\s+exists)?\s+([a-z0-9_]+)/gi)) {
    if (perItemCatalogTable.test(match[1])) {
      issues.push(`${relative} creates per-item catalog table ${match[1]} in D1; keep bulk manifests local or in R2.`);
    }
  }
}

const retiredArchiveTables = new Set([
  "creative_archive_catalogs",
  "creative_archive_sync_batches",
  "creative_archive_entries",
  "creative_archive_materializations",
]);
for (const relative of filesUnder("worker", [".ts"])) {
  const source = readFileSync(new URL(relative, root), "utf8");
  for (const match of source.matchAll(/\b(?:insert(?:\s+or\s+\w+)?\s+into|replace\s+into|update|delete\s+from)\s+([a-z0-9_]+)/gi)) {
    if (retiredArchiveTables.has(match[1].toLowerCase())) {
      issues.push(`${relative} mutates retired row-based archive table ${match[1]}; the applied schema must remain inert.`);
    }
  }
}

const retiredArchiveSyncMarkers = [
  "archiveCatalogBatches",
  "/archive-index/syncs",
  'kind === "archive-sync"',
  "ARCHIVE_SYNC_SCHEMA_VERSION",
  "ARCHIVE_SYNC_BATCH_LIMIT",
];
const archiveRuntimeFiles = ["runner", "worker", "local-host", "shared/contracts", "src"]
  .flatMap((directory) => filesUnder(directory, [".js", ".mjs", ".ts", ".tsx"]));
for (const relative of archiveRuntimeFiles) {
  const source = readFileSync(new URL(relative, root), "utf8");
  for (const marker of retiredArchiveSyncMarkers) {
    if (source.includes(marker)) issues.push(`${relative} restores retired autonomous archive sync marker ${marker}.`);
  }
}

if (!runner.includes("MIN_IDLE_POLL_INTERVAL_MS = 60_000")) issues.push("Runner idle polling must stay at one minute or slower.");
if (!runner.includes('resolveRunnerPollInterval("https://runner.cs.angelotoborg.com", 5_000)')) issues.push("The runner must self-test the remote polling floor.");
if (!runner.includes("/api/creative-studio/runner/work/claim")) issues.push("Runner must use the consolidated work-claim request.");
if (!runtime.includes("REMOTE_HTTP_POLL_INTERVAL_MS = 60_000")) issues.push("The remote HTTP adapter must refresh no faster than once per minute.");
if (!runtime.includes('hostname !== "127.0.0.1" && hostname !== "localhost"')) issues.push("Fast HTTP polling must remain restricted to localhost.");
if (!provider.includes('document.visibilityState === "visible"')) issues.push("Background tabs must not poll the Worker.");
if (!adapter.includes("CREATIVE_STUDIO_ROUTES.snapshot")) issues.push("Browser reads must use the consolidated snapshot route.");
if (!jobs.includes("enqueueJob(env, job.id, 60)")) issues.push("AFDFW Queue reconciliation must wait at least 60 seconds.");
if (workerEntry.includes("reconcileLoveLoops")) issues.push("Love Loop must reuse Local Runner claims instead of the scheduled Worker trigger.");
if (workerEntry.includes("ensureAutomaticStoryRefresh") || workerEntry.includes("claimStoryPlan")) {
  issues.push("Story Bank planning must reuse Local Runner claims instead of the scheduled Worker trigger.");
}
if (issues.length) {
  process.stderr.write(`${issues.map((issue) => `- ${issue}`).join("\n")}\n`);
  process.exit(1);
}

process.stdout.write("Creative Studio Cloudflare guard passed: 0 configured Worker routes, Queue consumers, cron triggers, D1 bindings, R2 bindings, or service bindings.\n");
