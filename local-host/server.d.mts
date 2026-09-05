import type { Server } from "node:http";

export interface LocalHostServerOptions {
  workerOrigin: string;
  publicHostname: string;
  accessEmail: string;
  internalToken: string;
  sessionSecret: string;
  archiveRoot: string;
}

export interface PreparedArchiveCatalog {
  source: unknown;
  catalog: Record<string, unknown>;
  entries: Array<Record<string, unknown>>;
  byId: Map<string, Record<string, unknown>>;
  sourceStamp: string;
}

export function createLocalHostServer(options: LocalHostServerOptions): Server;
export function prepareArchiveCatalog(archiveRoot: string): PreparedArchiveCatalog;
export function newHostSecret(): string;
