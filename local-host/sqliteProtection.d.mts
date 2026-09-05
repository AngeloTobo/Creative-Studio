export interface PinnedD1Database {
  path: string;
  relativePath: string;
}

export interface PinnedD1Verification {
  verifier: { engine: string; nodeVersion: string; sqliteVersion: string };
  integrity: "ok";
  foreignKeyViolations: 0;
  pageCount: number;
  pageSize: number;
  schemaVersion: number;
  userVersion: number;
  journalMode: string;
  logical?: { sha256: string; tables: number; rows: number };
  mainFileBytes: number;
  mainFileSha256: string;
}

export function discoverPinnedD1Database(stateRoot: string): PinnedD1Database;

export function verifyPinnedWranglerD1Binding(configPath: string, databaseName?: string): {
  binding: string;
  databaseName: string;
  databaseId: string;
  migrationsDirectory: string;
};

export function verifyPinnedD1Database(
  databasePath: string,
  options?: { fingerprint?: boolean },
): PinnedD1Verification;

export function runProtectedLocalD1Migrations(options: {
  stateRoot: string;
  hostRoot: string;
  recoveryRoot: string;
  migrationsRoot: string;
  expectedDatabaseRelativePath: string;
  applyMigrations: () => void | Promise<void>;
  protectPath?: (path: string) => void;
  log?: (message: string) => void;
  now?: () => Date;
}): Promise<{
  status: "up-to-date" | "migrated";
  database: PinnedD1Database & { verification: PinnedD1Verification };
  pending?: never[];
  checkpointId?: string;
  checkpointDirectory?: string;
  migrationsApplied?: string[];
}>;
