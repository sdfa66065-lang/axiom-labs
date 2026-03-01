import fs from "node:fs"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"

const DB_DIR = path.resolve(process.cwd(), "data")
const DB_PATH = path.join(DB_DIR, "observations.db")

const CREATE_TABLE_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS metric_definitions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_as TEXT NOT NULL,
    url TEXT NOT NULL,
    every_seconds INTEGER NOT NULL,
    extract_json TEXT,
    transform_json TEXT,
    enabled INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE TABLE IF NOT EXISTS observations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    metric_id INTEGER NOT NULL,
    ts TEXT NOT NULL,
    value_num REAL,
    value_json TEXT,
    raw_json TEXT,
    status TEXT NOT NULL,
    error TEXT,
    FOREIGN KEY (metric_id) REFERENCES metric_definitions(id)
  )`,
  `CREATE TABLE IF NOT EXISTS function_definitions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    version TEXT NOT NULL,
    config_json TEXT,
    enabled INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE TABLE IF NOT EXISTS function_scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    function_id INTEGER NOT NULL,
    ts TEXT NOT NULL,
    score_value REAL NOT NULL,
    details_json TEXT,
    inputs_json TEXT,
    FOREIGN KEY (function_id) REFERENCES function_definitions(id)
  )`,
]

function ensureDbDir() {
  fs.mkdirSync(DB_DIR, { recursive: true })
}

export function initDb() {
  ensureDbDir()

  const db = new DatabaseSync(DB_PATH)
  db.exec("PRAGMA journal_mode = WAL")

  for (const statement of CREATE_TABLE_STATEMENTS) {
    db.exec(statement)
  }

  return db
}

export function getDbPath() {
  return DB_PATH
}
