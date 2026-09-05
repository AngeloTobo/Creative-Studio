const RETIRED_MODE = "retired";

const allowedProductionKeys = new Set([
  "name",
  "workers_dev",
  "preview_urls",
  "routes",
  "vars",
  "services",
  "queues",
  "triggers",
  "r2_buckets",
  "d1_databases",
]);

const allowedDeploymentKeys = new Set([
  "$schema",
  "name",
  "account_id",
  "main",
  "compatibility_date",
  ...allowedProductionKeys,
]);

const allowedRetirementVars = new Set([
  "CLOUD_EXECUTION_MODE",
  "BACKEND_MODE",
  "LOCAL_HARDWARE_ONLY",
  "AFDFW_BASE_URL",
]);

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireEmptyArray(container, key, label, issues) {
  if (!Array.isArray(container?.[key]) || container[key].length !== 0) {
    issues.push(`Retired Cloudflare execution requires an explicitly empty ${label}.`);
  }
}

function retiredContractIssues(config, production, allowedKeys) {
  const issues = [];

  if (!isRecord(production)) {
    return ["Missing explicit production environment retirement contract."];
  }

  for (const key of Object.keys(production)) {
    if (!allowedKeys.has(key)) {
      issues.push(`Retired Cloudflare execution does not permit production setting ${key}.`);
    }
  }

  if (config.name !== "creative-studio" || production.name !== config.name) {
    issues.push("Cloud retirement must target the existing creative-studio Worker by its exact name.");
  }

  if (!isRecord(production.vars)) {
    issues.push("Retired Cloudflare execution requires an explicit vars contract.");
  } else {
    for (const key of Object.keys(production.vars)) {
      if (!allowedRetirementVars.has(key)) {
        issues.push(`Retired Cloudflare execution does not permit production variable ${key}.`);
      }
    }
    if (production.vars.CLOUD_EXECUTION_MODE !== RETIRED_MODE) {
      issues.push("Production must declare CLOUD_EXECUTION_MODE=retired.");
    }
    if (production.vars.BACKEND_MODE !== RETIRED_MODE) {
      issues.push("The dormant production Worker must keep BACKEND_MODE=retired so accidental API exposure fails closed.");
    }
    if (production.vars.LOCAL_HARDWARE_ONLY !== "true") {
      issues.push("The retired production environment must keep LOCAL_HARDWARE_ONLY=true.");
    }
    if (production.vars.AFDFW_BASE_URL !== "") {
      issues.push("The retired production environment must not configure an AFDFW URL.");
    }
  }

  if (production.workers_dev !== false) {
    issues.push("Retired Cloudflare execution must disable workers.dev.");
  }
  if (production.preview_urls !== false) {
    issues.push("Retired Cloudflare execution must disable preview URLs.");
  }

  requireEmptyArray(production, "routes", "routes list", issues);
  requireEmptyArray(production, "services", "service-bindings list", issues);
  requireEmptyArray(production, "r2_buckets", "R2-bindings list", issues);
  requireEmptyArray(production, "d1_databases", "D1-bindings list", issues);

  if (!isRecord(production.queues)) {
    issues.push("Retired Cloudflare execution requires an explicit empty Queues contract.");
  } else {
    requireEmptyArray(production.queues, "producers", "Queue producers list", issues);
    requireEmptyArray(production.queues, "consumers", "Queue consumers list", issues);
  }

  if (!isRecord(production.triggers)) {
    issues.push("Retired Cloudflare execution requires an explicit empty triggers contract.");
  } else {
    requireEmptyArray(production.triggers, "crons", "cron triggers list", issues);
  }

  return issues;
}

export function retiredCloudExecutionIssues(config) {
  return retiredContractIssues(config, config?.env?.production, allowedProductionKeys);
}

export function retiredCloudDeploymentIssues(config) {
  return retiredContractIssues(config, config, allowedDeploymentKeys);
}

export function cloudExecutionIsRetired(config) {
  return retiredCloudExecutionIssues(config).length === 0;
}
