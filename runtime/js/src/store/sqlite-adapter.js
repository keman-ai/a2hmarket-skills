// Node >= 22 用内置 node:sqlite，否则用 better-sqlite3。
// 对外统一暴露 openDatabase(dbPath) → db 实例，API 兼容 better-sqlite3。

const nodeMajor = Number(process.versions.node.split(".")[0]);

let openDatabase;

if (nodeMajor >= 22) {
  // node:sqlite 的 DatabaseSync 构造与 better-sqlite3 几乎一致，
  // 唯一区别：没有 db.pragma()，需要用 db.exec("PRAGMA ...")
  const { DatabaseSync } = require("node:sqlite");

  openDatabase = function openDatabase(dbPath) {
    const db = new DatabaseSync(dbPath);
    // 补一个 pragma() 方法，让调用方可以统一用 db.pragma("key = value")
    db.pragma = function pragma(statement) {
      return db.exec(`PRAGMA ${statement};`);
    };
    return db;
  };
} else {
  const BetterSqlite3 = require("better-sqlite3");

  openDatabase = function openDatabase(dbPath) {
    return new BetterSqlite3(dbPath);
  };
}

module.exports = { openDatabase };
