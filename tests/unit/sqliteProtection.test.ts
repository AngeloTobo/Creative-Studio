// @vitest-environment node

import { DatabaseSync } from "node:sqlite";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runProtectedLocalD1Migrations, verifyPinnedWranglerD1Binding } from "../../local-host/sqliteProtection.mjs";

const FIRST_MIGRATION = "0001_base.sql";
const SECOND_MIGRATION = "0002_note_status.sql";

function fixture({ pending = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "creative-studio-sqlite-protection-"));
  const hostRoot = join(root, "Creative Studio Host");
  const stateRoot = join(hostRoot, "state-test");
  const databaseDirectory = join(stateRoot, "v3", "d1", "miniflare-D1DatabaseObject");
  const databasePath = join(databaseDirectory, "authoritative.sqlite");
  const migrationsRoot = join(root, "migrations");
  const recoveryRoot = join(hostRoot, "database-recovery");
  const expectedDatabaseRelativePath = "v3/d1/miniflare-D1DatabaseObject/authoritative.sqlite";
  mkdirSync(databaseDirectory, { recursive: true });
  mkdirSync(migrationsRoot, { recursive: true });
  writeFileSync(join(migrationsRoot, FIRST_MIGRATION), `
    create table notes (
      id integer primary key,
      body text not null
    );
    create table parents (id integer primary key);
    create table children (
      id integer primary key,
      parent_id integer not null references parents(id)
    );
  `);
  if (pending) {
    writeFileSync(join(migrationsRoot, SECOND_MIGRATION), "alter table notes add column status text not null default 'draft';\n");
  }
  const database = new DatabaseSync(databasePath, { enableForeignKeyConstraints: false });
  try {
    database.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA wal_autocheckpoint=0;
      create table d1_migrations (
        id integer primary key,
        name text not null,
        applied_at timestamp not null default current_timestamp
      );
      ${readFileSync(join(migrationsRoot, FIRST_MIGRATION), "utf8")}
      insert into d1_migrations (id, name) values (1, '${FIRST_MIGRATION}');
      insert into notes (id, body) values (1, 'original');
      insert into parents (id) values (1);
    `);
  } finally {
    database.close();
  }
  return { root, hostRoot, stateRoot, databasePath, migrationsRoot, recoveryRoot, expectedDatabaseRelativePath };
}

function openDatabase(path: string, foreignKeys = true) {
  return new DatabaseSync(path, { enableForeignKeyConstraints: foreignKeys });
}

function applySecondMigration(databasePath: string, migrationsRoot: string) {
  const database = openDatabase(databasePath);
  try {
    database.exec(readFileSync(join(migrationsRoot, SECOND_MIGRATION), "utf8"));
    database.prepare("insert into d1_migrations (id, name) values (2, ?)").run(SECOND_MIGRATION);
  } finally {
    database.close();
  }
}

function checkpointDirectory(recoveryRoot: string) {
  const names = readdirSync(recoveryRoot).filter((name) => name.startsWith("checkpoint-"));
  expect(names).toHaveLength(1);
  return join(recoveryRoot, names[0]);
}

function installHotWalSnapshot(test: ReturnType<typeof fixture>) {
  const snapshot = join(test.root, "hot-wal-snapshot");
  mkdirSync(snapshot);
  const database = openDatabase(test.databasePath, false);
  try {
    database.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; insert into notes (id, body) values (2, 'committed in wal')");
    expect(existsSync(`${test.databasePath}-wal`)).toBe(true);
    expect(statSync(`${test.databasePath}-wal`).size).toBeGreaterThan(0);
    copyFileSync(test.databasePath, join(snapshot, "database.sqlite"));
    copyFileSync(`${test.databasePath}-wal`, join(snapshot, "database.sqlite-wal"));
    copyFileSync(`${test.databasePath}-shm`, join(snapshot, "database.sqlite-shm"));
  } finally {
    database.close();
  }
  copyFileSync(join(snapshot, "database.sqlite"), test.databasePath);
  copyFileSync(join(snapshot, "database.sqlite-wal"), `${test.databasePath}-wal`);
  copyFileSync(join(snapshot, "database.sqlite-shm"), `${test.databasePath}-shm`);
}

describe("pinned local D1 migration protection", () => {
  it("skips Wrangler entirely when the exact migration set is already applied", async () => {
    const test = fixture({ pending: false });
    let applied = false;
    try {
      const result = await runProtectedLocalD1Migrations({
        ...test,
        applyMigrations: () => { applied = true; },
      });
      expect(result.status).toBe("up-to-date");
      expect(applied).toBe(false);
      expect(existsSync(test.recoveryRoot)).toBe(false);
    } finally {
      rmSync(test.root, { recursive: true, force: true });
    }
  });

  it("retains a verified pre-migration SQLite backup and post-migration evidence", async () => {
    const test = fixture();
    try {
      const result = await runProtectedLocalD1Migrations({
        ...test,
        applyMigrations: () => applySecondMigration(test.databasePath, test.migrationsRoot),
      });
      expect(result).toEqual(expect.objectContaining({
        status: "migrated",
        migrationsApplied: [SECOND_MIGRATION],
      }));
      const directory = checkpointDirectory(test.recoveryRoot);
      const evidence = JSON.parse(readFileSync(join(directory, "checkpoint.json"), "utf8")) as {
        source: { logical: { sha256: string } };
        backup: {
          logical: { sha256: string };
          integrity: string;
          foreignKeyViolations: number;
          sqliteCheckpoint: { standalone: boolean; busy: number; logFrames: number };
        };
      };
      expect(evidence.backup.logical.sha256).toBe(evidence.source.logical.sha256);
      expect(evidence.backup).toEqual(expect.objectContaining({ integrity: "ok", foreignKeyViolations: 0 }));
      expect(evidence.backup.sqliteCheckpoint).toEqual(expect.objectContaining({ standalone: true, busy: 0, logFrames: 0 }));
      expect(existsSync(join(directory, "database.sqlite"))).toBe(true);
      expect(existsSync(join(directory, "migration-started.json"))).toBe(true);
      expect(existsSync(join(directory, "migration-succeeded.json"))).toBe(true);
      expect(existsSync(join(directory, "migration-restored.json"))).toBe(false);
      const database = openDatabase(test.databasePath);
      try {
        const columns = database.prepare("pragma table_info('notes')").all() as Array<{ name: string }>;
        expect(columns.map((column) => column.name)).toContain("status");
      } finally {
        database.close();
      }
    } finally {
      rmSync(test.root, { recursive: true, force: true });
    }
  });

  it("automatically restores and verifies the exact checkpoint when migration execution throws", async () => {
    const test = fixture();
    let attempts = 0;
    try {
      await expect(runProtectedLocalD1Migrations({
        ...test,
        applyMigrations: () => {
          attempts += 1;
          const database = openDatabase(test.databasePath);
          try { database.exec("insert into notes (id, body) values (2, 'partial migration write')"); }
          finally { database.close(); }
          throw new Error("simulated migration failure");
        },
      })).rejects.toThrow("was restored and verified");
      const database = openDatabase(test.databasePath);
      try {
        expect(database.prepare("select id, body from notes order by id").all()).toEqual([{ id: 1, body: "original" }]);
        expect(database.prepare("select name from d1_migrations order by id").all()).toEqual([{ name: FIRST_MIGRATION }]);
      } finally {
        database.close();
      }
      const directory = checkpointDirectory(test.recoveryRoot);
      expect(existsSync(join(directory, "migration-restored.json"))).toBe(true);
      expect(existsSync(join(directory, "migration-succeeded.json"))).toBe(false);

      await expect(runProtectedLocalD1Migrations({
        ...test,
        applyMigrations: () => { attempts += 1; },
      })).rejects.toThrow("exact local migration plan already failed and was restored");
      expect(attempts).toBe(1);

      writeFileSync(join(test.migrationsRoot, SECOND_MIGRATION), "alter table notes add column status text not null default 'draft';\n-- corrected bytes\n");
      const retry = await runProtectedLocalD1Migrations({
        ...test,
        applyMigrations: () => {
          attempts += 1;
          applySecondMigration(test.databasePath, test.migrationsRoot);
        },
      });
      expect(retry.status).toBe("migrated");
      expect(attempts).toBe(2);
    } finally {
      rmSync(test.root, { recursive: true, force: true });
    }
  });

  it("restores a hot WAL snapshot without allowing failed WAL frames to replay", async () => {
    const test = fixture();
    try {
      installHotWalSnapshot(test);
      await expect(runProtectedLocalD1Migrations({
        ...test,
        applyMigrations: () => {
          applySecondMigration(test.databasePath, test.migrationsRoot);
          const database = openDatabase(test.databasePath, false);
          try { database.exec("PRAGMA wal_autocheckpoint=0; insert into notes (id, body) values (3, 'failed wal frame')"); }
          finally { database.close(); }
          throw new Error("simulated failure over hot WAL");
        },
      })).rejects.toThrow("was restored and verified");
      expect(!existsSync(`${test.databasePath}-wal`) || statSync(`${test.databasePath}-wal`).size === 0).toBe(true);
      for (let reopen = 0; reopen < 2; reopen += 1) {
        const database = new DatabaseSync(test.databasePath, { readOnly: true, enableForeignKeyConstraints: false });
        try {
          expect(database.prepare("select id, body from notes order by id").all()).toEqual([
            { id: 1, body: "original" },
            { id: 2, body: "committed in wal" },
          ]);
        } finally {
          database.close();
        }
      }
    } finally {
      rmSync(test.root, { recursive: true, force: true });
    }
  });

  it("restores an interrupted started checkpoint before retrying its migration once", async () => {
    const test = fixture();
    const messages: string[] = [];
    let applications = 0;
    try {
      await runProtectedLocalD1Migrations({
        ...test,
        applyMigrations: () => {
          applications += 1;
          applySecondMigration(test.databasePath, test.migrationsRoot);
        },
      });
      const interruptedDirectory = checkpointDirectory(test.recoveryRoot);
      rmSync(join(interruptedDirectory, "migration-succeeded.json"));

      const recovered = await runProtectedLocalD1Migrations({
        ...test,
        log: (message: string) => messages.push(message),
        applyMigrations: () => {
          applications += 1;
          applySecondMigration(test.databasePath, test.migrationsRoot);
        },
      });
      expect(recovered.status).toBe("migrated");
      expect(applications).toBe(2);
      expect(messages).toContain("An interrupted local migration was detected; restoring its verified checkpoint before startup.");
      const restored = JSON.parse(readFileSync(join(interruptedDirectory, "migration-restored.json"), "utf8")) as { reason: string };
      expect(restored.reason).toBe("interrupted-startup");
      const database = openDatabase(test.databasePath);
      try {
        expect(database.prepare("select name from d1_migrations order by id").all()).toEqual([
          { name: FIRST_MIGRATION },
          { name: SECOND_MIGRATION },
        ]);
      } finally {
        database.close();
      }
    } finally {
      rmSync(test.root, { recursive: true, force: true });
    }
  });

  it("restores instead of starting when post-migration foreign-key integrity fails", async () => {
    const test = fixture();
    try {
      await expect(runProtectedLocalD1Migrations({
        ...test,
        applyMigrations: () => {
          applySecondMigration(test.databasePath, test.migrationsRoot);
          const database = openDatabase(test.databasePath, false);
          try { database.exec("PRAGMA foreign_keys=OFF; insert into children (id, parent_id) values (1, 999)"); }
          finally { database.close(); }
        },
      })).rejects.toThrow("was restored and verified");
      const database = openDatabase(test.databasePath);
      try {
        expect(database.prepare("select count(*) as count from children").get()).toEqual({ count: 0 });
        expect(database.prepare("select name from d1_migrations order by id").all()).toEqual([{ name: FIRST_MIGRATION }]);
      } finally {
        database.close();
      }
      expect(existsSync(join(checkpointDirectory(test.recoveryRoot), "migration-restored.json"))).toBe(true);
    } finally {
      rmSync(test.root, { recursive: true, force: true });
    }
  });

  it("fails before invoking migration when more than one authoritative SQLite file exists", async () => {
    const test = fixture();
    let applied = false;
    try {
      const second = openDatabase(join(test.stateRoot, "v3", "d1", "second.sqlite"));
      second.close();
      await expect(runProtectedLocalD1Migrations({
        ...test,
        applyMigrations: () => { applied = true; },
      })).rejects.toThrow("exactly one non-metadata pinned local D1 database");
      expect(applied).toBe(false);
    } finally {
      rmSync(test.root, { recursive: true, force: true });
    }
  });

  it("refuses before migration when the sole database is not at the receipt-pinned path", async () => {
    const test = fixture();
    let applied = false;
    try {
      await expect(runProtectedLocalD1Migrations({
        ...test,
        expectedDatabaseRelativePath: "v3/d1/miniflare-D1DatabaseObject/not-authoritative.sqlite",
        applyMigrations: () => { applied = true; },
      })).rejects.toThrow("exact path pinned by the migration receipt");
      expect(applied).toBe(false);
      expect(existsSync(test.recoveryRoot)).toBe(false);
    } finally {
      rmSync(test.root, { recursive: true, force: true });
    }
  });

  it("pins the local Wrangler D1 binding tuple used to derive Miniflare identity", () => {
    const test = fixture({ pending: false });
    const configPath = join(test.root, "wrangler.jsonc");
    try {
      writeFileSync(configPath, JSON.stringify({
        name: "creative-studio",
        d1_databases: [{
          binding: "DB",
          database_name: "creative-studio",
          database_id: "00000000-0000-0000-0000-000000000000",
          migrations_dir: "migrations",
        }],
      }));
      expect(verifyPinnedWranglerD1Binding(configPath)).toEqual(expect.objectContaining({
        binding: "DB",
        databaseName: "creative-studio",
      }));
      writeFileSync(configPath, readFileSync(configPath, "utf8").replace('"binding":"DB"', '"binding":"OTHER"'));
      expect(() => verifyPinnedWranglerD1Binding(configPath)).toThrow("binding tuple drifted");
    } finally {
      rmSync(test.root, { recursive: true, force: true });
    }
  });
});
