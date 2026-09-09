const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");
require("dotenv").config();

const rootDir = path.resolve(__dirname, "..");

function getDbPath() {
  const configured = process.env.DB_PATH || "data/gaoqiao.sqlite";
  return path.isAbsolute(configured) ? configured : path.join(rootDir, configured);
}

let db;

function openDb() {
  if (!db) {
    const file = getDbPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    db = new DatabaseSync(file);
    db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
    db.transaction = (fn) => {
      return (...args) => {
        db.exec("BEGIN");
        try {
          const result = fn(...args);
          db.exec("COMMIT");
          return result;
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
      };
    };
  }
  return db;
}

function closeDb() {
  if (db) {
    db.close();
    db = undefined;
  }
}

module.exports = {
  rootDir,
  getDbPath,
  openDb,
  closeDb
};
