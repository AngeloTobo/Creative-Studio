import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { Readable } from "node:stream";
import {
  ARCHIVE_CATALOG_SCHEMA_VERSION,
  MAX_ARCHIVE_MATERIALIZATION_BYTES,
  archiveMediaType,
  archiveSourceStamp,
  loadArchiveCatalog,
  resolveArchiveMaterialization,
} from "./archiveIndex.mjs";

const ARCHIVE_PREFIX = "/api/creative-studio/archive-index";
const RUNNER_PREFIX = "/api/creative-studio/runner/";
const COOKIE_NAME = "cs_pc_session";
const MAX_JSON_BYTES = 32 * 1024;

function clean(value) {
  return String(value ?? "").trim();
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function safeEqual(left, right) {
  const a = Buffer.from(clean(left));
  const b = Buffer.from(clean(right));
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

function json(response, status = 200, headers = {}) {
  const bytes = Buffer.from(`${JSON.stringify(response)}\n`);
  return { status, headers: { "content-type": "application/json; charset=utf-8", "content-length": String(bytes.length), "cache-control": "no-store", ...headers }, bytes };
}

function send(nodeResponse, response) {
  nodeResponse.writeHead(response.status, response.headers);
  nodeResponse.end(response.bytes);
}

function publicError(error) {
  const code = error instanceof Error ? error.message : "local_host_error";
  const status = code.endsWith("_not_found") ? 404
    : code === "approved_login_required" ? 401
      : code.startsWith("invalid_") || code.includes("ineligible") ? 400
        : 503;
  return json({ ok: false, error: code }, status);
}

function parseCookies(value) {
  return new Map(clean(value).split(";").map((part) => {
    const index = part.indexOf("=");
    return index < 0 ? [part.trim(), ""] : [part.slice(0, index).trim(), part.slice(index + 1).trim()];
  }).filter(([name]) => name));
}

function normalizeHost(value) {
  const host = clean(value).toLowerCase();
  if (host.startsWith("[")) return host;
  return host.split(":", 1)[0];
}

function validPublicHostname(value) {
  if (value.length > 253 || !value.includes(".")) return false;
  return value.split(".").every((label) => label.length >= 1 && label.length <= 63
    && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label));
}

function validAccessEmail(value) {
  if (!value || value.length > 254) return false;
  const separator = value.lastIndexOf("@");
  if (separator <= 0 || separator !== value.indexOf("@")) return false;
  const local = value.slice(0, separator);
  const domain = value.slice(separator + 1);
  return local.length <= 64 && !local.startsWith(".") && !local.endsWith(".") && !local.includes("..")
    && /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(local) && validPublicHostname(domain);
}

function requestUrl(value, base) {
  const raw = String(value ?? "/");
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\") || /[\r\n]/.test(raw)) {
    throw new Error("invalid_request_target");
  }
  const parsed = new URL(raw, base);
  if (parsed.origin !== new URL(base).origin) throw new Error("invalid_request_target");
  return parsed;
}

function reviewOnly(entry) {
  const marker = [entry.technicalCategory, entry.workBucket, entry.archiveDisposition, entry.sourceStatus]
    .join(" ").toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  return marker.includes("PARK_UNRESOLVED") || marker.includes("PARKED_ARCHAEOLOGY")
    || marker.includes("99_UNRESOLVED") || marker.includes("REVIEW_REQUIRED")
    || marker.includes("BLOCKED_TECHNICAL");
}

function blockReason(entry, media) {
  if (entry.verificationStatus !== "size-match") return "unavailable";
  if (reviewOnly(entry)) return "review-required";
  if (media.mediaKind !== "image" || !media.mimeType) return "unsupported-media";
  if (!Number.isSafeInteger(entry.size) || entry.size <= 0) return "empty-media";
  if (entry.size > MAX_ARCHIVE_MATERIALIZATION_BYTES) return "media-too-large";
  return null;
}

function publicCatalog(source, createdAt) {
  const id = `archivecatalog_local_${source.sourceFingerprint.slice(0, 20)}`;
  return {
    schemaVersion: ARCHIVE_CATALOG_SCHEMA_VERSION,
    id,
    provider: "angelo-art-index",
    runnerId: "creative-studio-pc-host",
    sourceVersion: source.sourceVersion,
    sourceFingerprint: source.sourceFingerprint,
    status: "active",
    expectedEntryCount: source.expectedEntryCount,
    expectedVerifiedCount: source.expectedVerifiedCount,
    expectedUnavailableCount: source.expectedUnavailableCount,
    receivedEntryCount: source.expectedEntryCount,
    materializableEntryCount: 0,
    createdAt,
    publishedAt: createdAt,
  };
}

export function prepareArchiveCatalog(archiveRoot) {
  const source = loadArchiveCatalog(archiveRoot);
  const createdAt = new Date().toISOString();
  const catalog = publicCatalog(source, createdAt);
  const byId = new Map();
  const entries = source.entries.map((entry) => {
    const media = archiveMediaType(entry.displayName);
    const materializationBlockReason = blockReason(entry, media);
    const id = `archiveentry_${sha256(`${catalog.id}\0${entry.sourceRecordType}\0${entry.sourceRecordId}`).slice(0, 20)}`;
    const result = {
      id,
      catalogId: catalog.id,
      sourceRecordType: entry.sourceRecordType,
      sourceRecordId: entry.sourceRecordId,
      inventoryRecordId: entry.inventoryRecordId,
      displayName: entry.displayName,
      extension: media.extension,
      mediaKind: media.mediaKind,
      mimeType: media.mimeType,
      technicalCategory: entry.technicalCategory,
      workBucket: entry.workBucket,
      archiveDisposition: entry.archiveDisposition,
      observedYear: entry.observedYear,
      size: entry.size,
      sourceStatus: entry.sourceStatus,
      verificationStatus: entry.verificationStatus,
      materializable: materializationBlockReason === null,
      materializationBlockReason,
      sortName: entry.displayName.toLocaleLowerCase(),
    };
    byId.set(id, result);
    return result;
  }).sort((left, right) => left.sortName.localeCompare(right.sortName) || left.id.localeCompare(right.id));
  catalog.materializableEntryCount = entries.filter((entry) => entry.materializable).length;
  return { source, catalog, entries, byId, sourceStamp: source.sourceStamp };
}

function numberParameter(value, fallback, minimum, maximum, error) {
  if (value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) throw new Error(error);
  return parsed;
}

function booleanParameter(value, error) {
  if (value === null) return null;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(error);
}

function archivePage(cache, url) {
  const limit = numberParameter(url.searchParams.get("limit"), 50, 1, 100, "invalid_archive_entry_limit");
  const search = clean(url.searchParams.get("search")).slice(0, 120).toLocaleLowerCase();
  const mediaKind = clean(url.searchParams.get("mediaKind")) || null;
  if (mediaKind && !["image", "audio", "video"].includes(mediaKind)) throw new Error("invalid_archive_media_kind");
  const observedYear = url.searchParams.has("observedYear")
    ? numberParameter(url.searchParams.get("observedYear"), null, 1900, 2100, "invalid_archive_observed_year")
    : null;
  const materializable = booleanParameter(url.searchParams.get("materializable"), "invalid_archive_materializable_filter");
  const filtered = cache.entries.filter((entry) => (!search || entry.displayName.toLocaleLowerCase().includes(search))
    && (!mediaKind || entry.mediaKind === mediaKind)
    && (observedYear === null || entry.observedYear === observedYear)
    && (materializable === null || entry.materializable === materializable));
  let start = 0;
  const cursorCatalogId = clean(url.searchParams.get("cursorCatalogId"));
  const cursorSortName = clean(url.searchParams.get("cursorSortName"));
  const cursorEntryId = clean(url.searchParams.get("cursorEntryId"));
  if (cursorCatalogId || cursorSortName || cursorEntryId) {
    if (cursorCatalogId !== cache.catalog.id || !cursorSortName || !cursorEntryId) throw new Error("invalid_archive_entry_cursor");
    const index = filtered.findIndex((entry) => entry.id === cursorEntryId && entry.sortName === cursorSortName.toLocaleLowerCase());
    if (index < 0) throw new Error("invalid_archive_entry_cursor");
    start = index + 1;
  }
  const entries = filtered.slice(start, start + limit).map(({ sortName, ...entry }) => {
    void sortName;
    return entry;
  });
  const hasMore = start + entries.length < filtered.length;
  const last = entries.at(-1);
  return {
    catalog: cache.catalog,
    entries,
    nextCursor: hasMore && last ? { catalogId: cache.catalog.id, sortName: last.displayName.toLocaleLowerCase(), entryId: last.id } : null,
    hasMore,
    total: filtered.length,
  };
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_JSON_BYTES) throw new Error("invalid_archive_materialization_request");
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new Error("invalid_archive_materialization_request"); }
}

function materialization(cache, entry, input, id, status, error = null, asset = undefined) {
  const now = new Date().toISOString();
  return {
    materialization: {
      schemaVersion: "creative-studio-archive-materialization/1.0",
      id,
      catalogId: cache.catalog.id,
      entryId: entry.id,
      projectId: input.projectId,
      runnerId: "creative-studio-pc-host",
      status,
      trainingEligible: false,
      mediaAssetId: asset?.id ?? null,
      error,
      createdAt: now,
      updatedAt: now,
      startedAt: now,
      completedAt: status === "completed" ? now : null,
    },
    ...(asset ? { asset } : {}),
  };
}

async function proxyRequest(request, response, config, localCookie = "") {
  const incoming = requestUrl(request.url, config.workerOrigin);
  const target = new URL(`${incoming.pathname}${incoming.search}`, config.workerOrigin);
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value !== undefined && ![
      "connection", "content-length", "x-cs-host-token", "x-cs-internal-token",
      "x-cs-source", "x-cs-media-id", "x-cs-archive-provenance",
    ].includes(name.toLowerCase())) {
      headers.set(name, Array.isArray(value) ? value.join(", ") : value);
    }
  }
  headers.set("x-cs-host-token", config.internalToken);
  // Node's fetch transparently decodes compressed upstream bodies but preserves
  // the original encoding/length headers. Keep the loopback hop uncompressed so
  // browsers never receive a decoded body labelled as gzip, Brotli, or Zstandard.
  headers.set("accept-encoding", "identity");
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const upstream = await fetch(target, {
    method: request.method,
    headers,
    body: hasBody ? Readable.toWeb(request) : undefined,
    ...(hasBody ? { duplex: "half" } : {}),
    redirect: "manual",
  });
  const outputHeaders = {};
  upstream.headers.forEach((value, name) => { outputHeaders[name] = value; });
  if (localCookie) outputHeaders["set-cookie"] = localCookie;
  response.writeHead(upstream.status, outputHeaders);
  if (!upstream.body) return response.end();
  Readable.fromWeb(upstream.body).pipe(response);
}

function requestAuthority(request, config) {
  const host = normalizeHost(request.headers.host);
  const local = host === "127.0.0.1" || host === "localhost";
  const remote = host === config.publicHostname;
  if (!local && !remote) throw new Error("invalid_host");
  const parsed = requestUrl(request.url, `http://${host}`);
  const path = parsed.pathname.toLowerCase();
  if (remote) {
    const email = clean(request.headers["cf-access-authenticated-user-email"]).toLowerCase();
    const jwt = clean(request.headers["cf-access-jwt-assertion"]);
    if (!jwt || email !== config.accessEmail) throw new Error("approved_login_required");
    if (path.startsWith(RUNNER_PREFIX)) throw new Error("runner_route_not_found");
  } else if (path.startsWith("/api/creative-studio/") && !path.startsWith(RUNNER_PREFIX)) {
    const cookie = parseCookies(request.headers.cookie).get(COOKIE_NAME);
    if (!safeEqual(cookie, config.sessionSecret)) throw new Error("approved_login_required");
  }
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method ?? "GET") && !path.startsWith(RUNNER_PREFIX)) {
    const site = clean(request.headers["sec-fetch-site"]).toLowerCase();
    if (site !== "same-origin" && site !== "none") throw new Error("invalid_request_origin");
    const origin = clean(request.headers.origin).toLowerCase();
    const expected = local ? `http://${request.headers.host}` : `https://${host}`;
    if (origin !== expected.toLowerCase()) throw new Error("invalid_request_origin");
  }
  return { host, local, remote, path, url: parsed };
}

export function createLocalHostServer(options) {
  const config = {
    workerOrigin: clean(options.workerOrigin).replace(/\/+$/, ""),
    publicHostname: clean(options.publicHostname).toLowerCase(),
    accessEmail: clean(options.accessEmail).toLowerCase(),
    internalToken: clean(options.internalToken),
    sessionSecret: clean(options.sessionSecret),
    archiveRoot: clean(options.archiveRoot),
  };
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(config.workerOrigin) || !config.publicHostname
    || !validPublicHostname(config.publicHostname) || !validAccessEmail(config.accessEmail)
    || config.internalToken.length < 40 || config.sessionSecret.length < 40) throw new Error("invalid_local_host_config");
  let cache = prepareArchiveCatalog(config.archiveRoot);
  const materializations = new Map();
  const pending = new Map();

  function refreshArchive() {
    const stamp = archiveSourceStamp(config.archiveRoot);
    if (stamp !== cache.sourceStamp) cache = prepareArchiveCatalog(config.archiveRoot);
    return cache;
  }

  async function handleArchive(request, url) {
    const current = refreshArchive();
    if (request.method === "GET" && url.pathname === `${ARCHIVE_PREFIX}/status`) {
      return json({ ok: true, activeCatalog: current.catalog, latestSync: current.catalog });
    }
    if (request.method === "GET" && url.pathname === `${ARCHIVE_PREFIX}/entries`) {
      return json({ ok: true, page: archivePage(current, url) });
    }
    const createMatch = request.method === "POST"
      ? url.pathname.match(/^\/api\/creative-studio\/archive-index\/entries\/([a-z0-9_]+)\/materializations$/i)
      : null;
    if (createMatch) {
      const entry = current.byId.get(createMatch[1]);
      if (!entry) throw new Error("archive_entry_not_found");
      if (!entry.materializable) throw new Error(`archive_materialization_${entry.materializationBlockReason ?? "ineligible"}`);
      const input = await readJson(request);
      const projectId = clean(input?.projectId);
      const idempotencyKey = clean(input?.idempotencyKey);
      if (!/^[a-z0-9_]{3,100}$/i.test(projectId) || !/^[a-z0-9_-]{8,180}$/i.test(idempotencyKey) || input?.trainingEligible === true) {
        throw new Error("invalid_archive_materialization_request");
      }
      const operationKey = `${projectId}\0${entry.id}\0${idempotencyKey}`;
      if (materializations.has(operationKey)) return json({ ok: true, ...materializations.get(operationKey) }, 200);
      if (pending.has(operationKey)) return pending.get(operationKey);
      const operation = (async () => {
        const materializationId = `archivemat_${sha256(operationKey).slice(0, 24)}`;
        try {
          const resolved = await resolveArchiveMaterialization(current.source, {
            ...entry,
            sourceVersion: current.catalog.sourceVersion,
            sourceFingerprint: current.catalog.sourceFingerprint,
          });
          const provenance = {
            materializedFromArchive: true,
            provider: "angelo-art-index",
            catalogId: current.catalog.id,
            archiveEntryId: entry.id,
            materializationId,
            sourceVersion: current.catalog.sourceVersion,
            sourceFingerprint: current.catalog.sourceFingerprint,
            sourceRecordType: entry.sourceRecordType,
            sourceRecordId: entry.sourceRecordId,
            inventoryRecordId: entry.inventoryRecordId,
            requestedByOwner: true,
            materializedAt: new Date().toISOString(),
            verification: "size-match",
            parentAssetIds: [],
          };
          const assetId = `media_archive_${sha256(materializationId).slice(0, 24)}`;
          const response = await fetch(`${config.workerOrigin}/api/creative-studio/media`, {
            method: "POST",
            headers: {
              "content-type": resolved.contentType,
              "x-cs-project-id": projectId,
              "x-cs-file-name": encodeURIComponent(resolved.fileName),
              "x-cs-file-size": String(resolved.size),
              "x-cs-training-eligible": "false",
              "x-cs-source": "archive-index",
              "x-cs-media-id": assetId,
              "x-cs-archive-provenance": encodeURIComponent(JSON.stringify(provenance)),
              "x-cs-host-token": config.internalToken,
            },
            body: resolved.bytes,
          });
          const payload = await response.json();
          if (!response.ok || payload?.ok !== true || !payload.asset) throw new Error(payload?.error || "archive_materialization_retention_failed");
          const result = materialization(current, entry, { projectId }, materializationId, "completed", null, payload.asset);
          materializations.set(operationKey, result);
          return json({ ok: true, ...result }, 201);
        } catch (error) {
          const result = materialization(current, entry, { projectId }, materializationId, "failed", error instanceof Error ? error.message : "archive_materialization_failed");
          materializations.set(operationKey, result);
          return json({ ok: true, ...result }, 202);
        } finally {
          pending.delete(operationKey);
        }
      })();
      pending.set(operationKey, operation);
      return operation;
    }
    const getMatch = request.method === "GET"
      ? url.pathname.match(/^\/api\/creative-studio\/archive-index\/materializations\/([a-z0-9_]+)$/i)
      : null;
    if (getMatch) {
      const result = [...materializations.values()].find((candidate) => candidate.materialization.id === getMatch[1]);
      if (!result) throw new Error("archive_materialization_not_found");
      return json({ ok: true, ...result });
    }
    throw new Error("archive_index_route_not_found");
  }

  return createServer(async (request, response) => {
    try {
      const authority = requestAuthority(request, config);
      const url = authority.url;
      const path = authority.path;
      const localCookie = authority.local && !path.startsWith("/api/")
        ? `${COOKIE_NAME}=${config.sessionSecret}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000`
        : "";
      if (path === "/api/creative-studio/host-health") {
        const current = refreshArchive();
        return send(response, json({ ok: true, mode: "self-hosted", authority: "this-pc", cloudflare: "access-and-tunnel-only", archive: { entries: current.catalog.expectedEntryCount, materializable: current.catalog.materializableEntryCount } }));
      }
      if (path.startsWith(ARCHIVE_PREFIX)) return send(response, await handleArchive(request, url));
      await proxyRequest(request, response, config, localCookie);
    } catch (error) {
      send(response, publicError(error));
    }
  });
}

export function newHostSecret() {
  return randomBytes(32).toString("base64url");
}
