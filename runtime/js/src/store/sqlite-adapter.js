// Node >= 22 uses built-in node:sqlite; older versions require better-sqlite3.
// Exports: openDatabase(dbPath) → db instance with better-sqlite3-compatible API.

const nodeMajor = Number(process.versions.node.split(".")[0]);

let openDatabase;

if (nodeMajor >= 22) {
  const { DatabaseSync } = require("node:sqlite");

  openDatabase = function openDatabase(dbPath) {
    const db = new DatabaseSync(dbPath);
    db.pragma = function pragma(statement) {
      return db.exec(`PRAGMA ${statement};`);
    };
    return db;
  };
} else {
  let BetterSqlite3;
  try {
    BetterSqlite3 = require("better-sqlite3");
  } catch (loadErr) {
    const msg = [
      "Failed to load better-sqlite3 (native module).",
      `Node ${process.version} does not include built-in node:sqlite (requires >= 22).`,
      "Fix: upgrade to Node >= 22, or run 'npm rebuild better-sqlite3'.",
      `Original error: ${(loadErr && loadErr.message) || String(loadErr)}`,
    ].join("\n  ");

    openDatabase = function openDatabase() {
      throw new Error(msg);
    };
  }

  if (BetterSqlite3) {
    openDatabase = function openDatabase(dbPath) {
      return new BetterSqlite3(dbPath);
    };
  }
}

module.exports = { openDatabase };
