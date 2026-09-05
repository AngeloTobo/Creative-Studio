import { describe, expect, it } from "vitest";
import { retiredCloudDeploymentIssues, retiredCloudExecutionIssues } from "../../scripts/cloud-execution-policy.mjs";

function retiredConfig() {
  return {
    name: "creative-studio",
    env: {
      production: {
        name: "creative-studio",
        workers_dev: false,
        preview_urls: false,
        routes: [],
        vars: {
          CLOUD_EXECUTION_MODE: "retired",
          BACKEND_MODE: "retired",
          LOCAL_HARDWARE_ONLY: "true",
          AFDFW_BASE_URL: "",
        },
        services: [],
        queues: { producers: [], consumers: [] },
        triggers: { crons: [] },
        r2_buckets: [],
        d1_databases: [],
      },
    },
  };
}

describe("retired Cloudflare execution policy", () => {
  it("accepts only an explicit tunnel-only production boundary", () => {
    expect(retiredCloudExecutionIssues(retiredConfig())).toEqual([]);
  });

  it.each([
    ["route", (config: ReturnType<typeof retiredConfig>) => config.env.production.routes.push({ pattern: "cs.example.com" } as never)],
    ["D1 binding", (config: ReturnType<typeof retiredConfig>) => config.env.production.d1_databases.push({ binding: "DB" } as never)],
    ["R2 binding", (config: ReturnType<typeof retiredConfig>) => config.env.production.r2_buckets.push({ binding: "ARTIFACTS" } as never)],
    ["Queue consumer", (config: ReturnType<typeof retiredConfig>) => config.env.production.queues.consumers.push({ queue: "jobs" } as never)],
    ["cron", (config: ReturnType<typeof retiredConfig>) => config.env.production.triggers.crons.push("0 * * * *" as never)],
    ["service binding", (config: ReturnType<typeof retiredConfig>) => config.env.production.services.push({ binding: "AFDFW" } as never)],
  ])("rejects a restored %s", (_label, mutate) => {
    const config = retiredConfig();
    mutate(config);
    expect(retiredCloudExecutionIssues(config)).not.toEqual([]);
  });

  it("rejects preview exposure and unreviewed production settings", () => {
    const config = retiredConfig();
    config.env.production.preview_urls = true;
    Object.assign(config.env.production, { durable_objects: { bindings: [] } });
    expect(retiredCloudExecutionIssues(config)).toEqual(expect.arrayContaining([
      "Retired Cloudflare execution must disable preview URLs.",
      "Retired Cloudflare execution does not permit production setting durable_objects.",
    ]));
  });

  it("cannot redirect retirement to a different Worker name", () => {
    const config = retiredConfig();
    config.env.production.name = "creative-studio-retirement-decoy";
    expect(retiredCloudExecutionIssues(config)).toContain(
      "Cloud retirement must target the existing creative-studio Worker by its exact name.",
    );
  });

  it("accepts a dedicated retirement deployment without inherited local bindings", () => {
    const config = retiredConfig();
    const deployment = {
      $schema: "node_modules/wrangler/config-schema.json",
      account_id: "account",
      main: "worker/index.ts",
      compatibility_date: "2026-08-15",
      ...config.env.production,
    };
    expect(retiredCloudDeploymentIssues(deployment)).toEqual([]);
  });
});
