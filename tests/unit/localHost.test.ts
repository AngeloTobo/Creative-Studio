// @vitest-environment node

import { createServer, request as httpRequest, type IncomingMessage, type Server } from "node:http";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadArchiveCatalog } from "../../local-host/archiveIndex.mjs";
import { createLocalHostServer } from "../../local-host/server.mjs";

const INTERNAL_TOKEN = "internal-token-abcdefghijklmnopqrstuvwxyz-1234567890";
const SESSION_SECRET = "session-secret-abcdefghijklmnopqrstuvwxyz-1234567890";
const PUBLIC_HOSTNAME = "cs.example.test";
const ACCESS_EMAIL = "angelo@example.test";
const REPO_ROOT = resolve(import.meta.dirname, "../..");

type CapturedRequest = {
  method: string;
  path: string;
  headers: IncomingMessage["headers"];
  body: Buffer;
};

type RawResponse = {
  status: number;
  headers: IncomingMessage["headers"];
  body: Buffer;
  json: Record<string, unknown>;
};

function csv(rows: string[][]) {
  return `${rows.map((row) => row.map((value) => `"${value.replaceAll('"', '""')}"`).join(",")).join("\r\n")}\r\n`;
}

function makeArchiveFixture() {
  const root = mkdtempSync(join(tmpdir(), "creative-studio-art-index-"));
  const records = join(root, "00_Archive_Records");
  const destination = join(root, "07_Inbox", "Study.png");
  const bytes = Buffer.from("local-art-index-image");
  mkdirSync(records, { recursive: true });
  mkdirSync(join(root, "07_Inbox"), { recursive: true });
  writeFileSync(destination, bytes);
  writeFileSync(join(records, "completion_manifest.csv"), csv([
    ["ActionID", "RecordType", "RecordID", "InventoryRecordID", "RelativeDestination", "ExpectedSizeBytes", "TechnicalCategory", "OriginalWorkBucket", "ArchiveDisposition", "SourceStatus"],
    ["ACT-1", "AUTHORED_ART", "REC-1", "INV-1", "07_Inbox\\Study.png", String(bytes.length), "Image / Render / Vector", "READY", "READY", "VERIFIED"],
  ]));
  writeFileSync(join(records, "completion_state.csv"), csv([
    ["ActionID", "ExpectedSizeBytes", "DestinationSizeBytes", "Status", "VerificationStatus", "SourcePreserved"],
    ["ACT-1", String(bytes.length), String(bytes.length), "VERIFIED", "SIZE_MATCH", "YES"],
  ]));
  return { root, destination, bytes };
}

async function listen(server: Server) {
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test_server_address_missing");
  return address.port;
}

async function close(server: Server | null) {
  if (!server) return;
  await new Promise<void>((resolveClose, reject) => {
    server.close((error) => error ? reject(error) : resolveClose());
  });
}

describe("Creative Studio PC gateway", () => {
  const archive = makeArchiveFixture();
  const captured: CapturedRequest[] = [];
  let worker: Server | null = null;
  let gateway: Server | null = null;
  let gatewayPort = 0;
  let localHost = "";
  let localCookie = "";

  beforeAll(async () => {
    worker = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const capturedRequest = {
        method: request.method ?? "GET",
        path: request.url ?? "/",
        headers: request.headers,
        body: Buffer.concat(chunks),
      };
      captured.push(capturedRequest);
      if (request.url === "/api/creative-studio/media" && request.method === "POST") {
        const body = Buffer.from(JSON.stringify({
          ok: true,
          asset: {
            id: request.headers["x-cs-media-id"],
            projectId: request.headers["x-cs-project-id"],
            source: "archive-index",
          },
        }));
        response.writeHead(201, { "content-type": "application/json", "content-length": String(body.length) });
        response.end(body);
        return;
      }
      const body = request.url?.startsWith("/api/")
        ? Buffer.from(JSON.stringify({ ok: true, path: request.url }))
        : Buffer.from("<!doctype html><title>Creative Studio</title>");
      response.writeHead(200, { "content-type": request.url?.startsWith("/api/") ? "application/json" : "text/html", "content-length": String(body.length) });
      response.end(body);
    });
    const workerPort = await listen(worker);
    gateway = createLocalHostServer({
      workerOrigin: `http://127.0.0.1:${workerPort}`,
      publicHostname: PUBLIC_HOSTNAME,
      accessEmail: ACCESS_EMAIL,
      internalToken: INTERNAL_TOKEN,
      sessionSecret: SESSION_SECRET,
      archiveRoot: archive.root,
    });
    gatewayPort = await listen(gateway);
    localHost = `127.0.0.1:${gatewayPort}`;
    const root = await callGateway("/");
    expect(root.status).toBe(200);
    localCookie = String(root.headers["set-cookie"]?.[0] ?? root.headers["set-cookie"] ?? "").split(";", 1)[0];
    expect(localCookie).toBe(`cs_pc_session=${SESSION_SECRET}`);
  });

  afterAll(async () => {
    await close(gateway);
    await close(worker);
    rmSync(archive.root, { recursive: true, force: true });
  });

  function callGateway(path: string, options: {
    method?: string;
    host?: string;
    headers?: Record<string, string>;
    body?: string;
  } = {}) {
    return new Promise<RawResponse>((resolveRequest, reject) => {
      const request = httpRequest({
        hostname: "127.0.0.1",
        port: gatewayPort,
        method: options.method ?? "GET",
        path,
        headers: { host: options.host ?? localHost, ...options.headers },
      }, (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.once("end", () => {
          const body = Buffer.concat(chunks);
          let parsed: Record<string, unknown> = {};
          try { parsed = JSON.parse(body.toString("utf8")) as Record<string, unknown>; } catch { /* non-JSON root */ }
          resolveRequest({ status: response.statusCode ?? 0, headers: response.headers, body, json: parsed });
        });
      });
      request.once("error", reject);
      if (options.body) request.write(options.body);
      request.end();
    });
  }

  it("gates local APIs with its HttpOnly owner cookie and rejects unknown hosts", async () => {
    const unauthenticated = await callGateway("/api/creative-studio/session");
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.json.error).toBe("approved_login_required");

    const authenticated = await callGateway("/api/creative-studio/session", { headers: { cookie: localCookie } });
    expect(authenticated.status).toBe(200);
    expect(captured.at(-1)?.headers["x-cs-host-token"]).toBe(INTERNAL_TOKEN);

    const unknownHost = await callGateway("/", { host: "not-creative-studio.example" });
    expect(unknownHost.status).toBe(400);
    expect(unknownHost.json.error).toBe("invalid_host");
  });

  it("forces identity encoding on the loopback Worker hop", async () => {
    const response = await callGateway("/", { headers: { "accept-encoding": "gzip, deflate, br, zstd" } });
    expect(response.status).toBe(200);
    expect(response.body.toString("utf8")).toContain("<title>Creative Studio</title>");
    expect(captured.at(-1)?.headers["accept-encoding"]).toBe("identity");
  });

  it("requires the approved Cloudflare Access identity and hides Runner routes remotely", async () => {
    const noAccess = await callGateway("/api/creative-studio/session", { host: PUBLIC_HOSTNAME });
    expect(noAccess.status).toBe(401);

    const wrongIdentity = await callGateway("/api/creative-studio/session", {
      host: PUBLIC_HOSTNAME,
      headers: { "cf-access-authenticated-user-email": "someone@example.test", "cf-access-jwt-assertion": "signed-access-jwt" },
    });
    expect(wrongIdentity.status).toBe(401);

    const approvedHeaders = { "cf-access-authenticated-user-email": ACCESS_EMAIL, "cf-access-jwt-assertion": "signed-access-jwt" };
    const approved = await callGateway("/api/creative-studio/session", { host: PUBLIC_HOSTNAME, headers: approvedHeaders });
    expect(approved.status).toBe(200);

    const beforeRunner = captured.length;
    const runner = await callGateway("/api/creative-studio/runner/work/claim", { host: PUBLIC_HOSTNAME, headers: approvedHeaders });
    expect(runner.status).toBe(404);
    expect(runner.json.error).toBe("runner_route_not_found");
    expect(captured).toHaveLength(beforeRunner);

    const mixedCaseRunner = await callGateway("/api/creative-studio/RUNNER/jobs/job_remote/complete", {
      method: "POST",
      host: PUBLIC_HOSTNAME,
      headers: {
        ...approvedHeaders,
        "content-type": "application/octet-stream",
        "content-length": "1",
        origin: `https://${PUBLIC_HOSTNAME}`,
        "sec-fetch-site": "same-origin",
      },
      body: "x",
    });
    expect(mixedCaseRunner.status).toBe(404);
    expect(mixedCaseRunner.json.error).toBe("runner_route_not_found");
    expect(captured).toHaveLength(beforeRunner);
  });

  it("applies the local cookie boundary to mixed-case API routes", async () => {
    const before = captured.length;
    const response = await callGateway("/API/creative-studio/media/media_private/content");
    expect(response.status).toBe(401);
    expect(response.json.error).toBe("approved_login_required");
    expect(captured).toHaveLength(before);
  });

  it("fails closed for unsafe owner requests without an exact same-origin signal", async () => {
    const body = "{}";
    const baseHeaders = { cookie: localCookie, "content-type": "application/json", "content-length": String(body.length) };
    const missingOrigin = await callGateway("/api/creative-studio/test-mutation", { method: "POST", headers: baseHeaders, body });
    expect(missingOrigin.status).toBe(400);
    expect(missingOrigin.json.error).toBe("invalid_request_origin");

    const crossSite = await callGateway("/api/creative-studio/test-mutation", {
      method: "POST",
      headers: { ...baseHeaders, origin: "https://attacker.example", "sec-fetch-site": "cross-site" },
      body,
    });
    expect(crossSite.status).toBe(400);

    const sameOrigin = await callGateway("/api/creative-studio/test-mutation", {
      method: "POST",
      headers: { ...baseHeaders, origin: `http://${localHost}`, "sec-fetch-site": "same-origin" },
      body,
    });
    expect(sameOrigin.status).toBe(200);
  });

  it("rejects absolute-form proxy targets before the internal token can leave the PC worker origin", async () => {
    const before = captured.length;
    const response = await callGateway("http://attacker.example/steal-host-token", { headers: { cookie: localCookie } });
    expect(response.status).toBe(400);
    expect(response.json.error).toBe("invalid_request_target");
    expect(captured).toHaveLength(before);
  });

  it("lists the Art Index from disk and materializes once per idempotency key", async () => {
    const fileBefore = statSync(archive.destination);
    const bytesBefore = readFileSync(archive.destination);
    const entries = await callGateway("/api/creative-studio/archive-index/entries?materializable=true", {
      headers: { cookie: localCookie },
    });
    expect(entries.status).toBe(200);
    const page = entries.json.page as { entries: Array<{ id: string; displayName: string; materializable: boolean }> };
    expect(page.entries).toEqual([expect.objectContaining({ displayName: "Study.png", materializable: true })]);

    const requestBody = JSON.stringify({ projectId: "project_local", idempotencyKey: "use-art-once", trainingEligible: false });
    const headers = {
      cookie: localCookie,
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(requestBody)),
      origin: `http://${localHost}`,
      "sec-fetch-site": "same-origin",
    };
    const mediaBefore = captured.filter((request) => request.path === "/api/creative-studio/media").length;
    const first = await callGateway(`/api/creative-studio/archive-index/entries/${page.entries[0].id}/materializations`, {
      method: "POST",
      headers,
      body: requestBody,
    });
    expect(first.status).toBe(201);
    expect((first.json.materialization as { status: string }).status).toBe("completed");
    const second = await callGateway(`/api/creative-studio/archive-index/entries/${page.entries[0].id}/materializations`, {
      method: "POST",
      headers,
      body: requestBody,
    });
    expect(second.status).toBe(200);
    expect(second.json).toEqual(expect.objectContaining({ materialization: first.json.materialization, asset: first.json.asset }));

    const mediaRequests = captured.filter((request) => request.path === "/api/creative-studio/media");
    expect(mediaRequests).toHaveLength(mediaBefore + 1);
    expect(mediaRequests.at(-1)?.body).toEqual(archive.bytes);
    expect(mediaRequests.at(-1)?.headers["x-cs-source"]).toBe("archive-index");
    expect(mediaRequests.at(-1)?.headers["x-cs-training-eligible"]).toBe("false");
    expect(captured.some((request) => request.path.includes("archive-index/sync"))).toBe(false);
    expect(readFileSync(archive.destination)).toEqual(bytesBefore);
    expect(statSync(archive.destination).mtimeMs).toBe(fileBefore.mtimeMs);
  });
});

describe("local Art Index architecture", () => {
  it("requires an absolute archive root", () => {
    expect(() => loadArchiveCatalog(".")).toThrow("archive_index_root_invalid");
  });

  it("rejects malformed public hostnames during gateway setup", () => {
    const archive = makeArchiveFixture();
    try {
      expect(() => createLocalHostServer({
        workerOrigin: "http://127.0.0.1:8788",
        publicHostname: "not a hostname",
        accessEmail: ACCESS_EMAIL,
        internalToken: INTERNAL_TOKEN,
        sessionSecret: SESSION_SECRET,
        archiveRoot: archive.root,
      })).toThrow("invalid_local_host_config");
    } finally {
      rmSync(archive.root, { recursive: true, force: true });
    }
  });

  it("requires one syntactically valid pinned Access email", () => {
    const archive = makeArchiveFixture();
    try {
      const options = {
        workerOrigin: "http://127.0.0.1:8788",
        publicHostname: PUBLIC_HOSTNAME,
        internalToken: INTERNAL_TOKEN,
        sessionSecret: SESSION_SECRET,
        archiveRoot: archive.root,
      };
      expect(() => createLocalHostServer({ ...options, accessEmail: "" })).toThrow("invalid_local_host_config");
      expect(() => createLocalHostServer({ ...options, accessEmail: "not-an-email" })).toThrow("invalid_local_host_config");
      expect(() => createLocalHostServer({ ...options, accessEmail: "two@@example.test" })).toThrow("invalid_local_host_config");
      const valid = createLocalHostServer({ ...options, accessEmail: ACCESS_EMAIL });
      valid.close();
    } finally {
      rmSync(archive.root, { recursive: true, force: true });
    }
  });

  it("contains no row-per-art cloud sync or batching implementation", () => {
    const source = `${readFileSync(join(REPO_ROOT, "local-host", "archiveIndex.mjs"), "utf8")}\n${readFileSync(join(REPO_ROOT, "local-host", "server.mjs"), "utf8")}`;
    expect(source).not.toContain("archiveCatalogBatches");
    expect(source).not.toContain("ARCHIVE_SYNC_BATCH_LIMIT");
    expect(source).not.toContain("/archive-index/syncs");
  });
});

describe("PC host process ownership", () => {
  it("does not delete another live host process's lock when a duplicate start is rejected", () => {
    const runtimeRoot = mkdtempSync(join(tmpdir(), "creative-studio-host-runtime-"));
    const hostRoot = join(runtimeRoot, "Creative Studio Host");
    const lockPath = join(hostRoot, "host-instance.lock");
    const lock = `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`;
    mkdirSync(hostRoot, { recursive: true });
    writeFileSync(lockPath, lock);
    try {
      const result = spawnSync(process.execPath, [join(REPO_ROOT, "scripts", "start-pc-host.mjs")], {
        cwd: REPO_ROOT,
        env: { ...process.env, LOCALAPPDATA: runtimeRoot },
        encoding: "utf8",
        windowsHide: true,
      });
      expect(result.status).toBe(1);
      expect(`${result.stdout}${result.stderr}`).toContain("Creative Studio PC Host is already running");
      expect(readFileSync(lockPath, "utf8")).toBe(lock);
    } finally {
      rmSync(runtimeRoot, { recursive: true, force: true });
    }
  });
});
