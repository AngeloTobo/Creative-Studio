import { backup, DatabaseSync } from "node:sqlite";

const major = Number.parseInt(process.versions.node.split(".", 1)[0], 10);
if (!Number.isSafeInteger(major) || major < 24 || typeof backup !== "function") {
  throw new Error("Creative Studio PC Host requires Node.js 24 or newer with node:sqlite backup support.");
}

const database = new DatabaseSync(":memory:");
database.close();
