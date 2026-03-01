import { initDb, getDbPath } from "../db/init-db.mjs"

const db = initDb()

const insertMetric = db.prepare(`
  INSERT INTO metric_definitions (store_as, url, every_seconds, extract_json, transform_json, enabled)
  VALUES (?, ?, ?, ?, ?, ?)
`)

const insertFunction = db.prepare(`
  INSERT INTO function_definitions (name, version, config_json, enabled)
  VALUES (?, ?, ?, ?)
`)

insertMetric.run(
  "json",
  "https://example.com/metric",
  300,
  JSON.stringify({ path: "$.data.value" }),
  JSON.stringify({ op: "identity" }),
  1,
)

const metricRow = db.prepare("SELECT last_insert_rowid() AS id").get()

insertFunction.run(
  "risk_score",
  "v1",
  JSON.stringify({ weights: { volatility: 0.7, liquidity: 0.3 } }),
  1,
)

const functionRow = db.prepare("SELECT last_insert_rowid() AS id").get()

console.log(`Seeded DB at ${getDbPath()}`)
console.log(`Inserted metric_definitions row id=${metricRow.id}`)
console.log(`Inserted function_definitions row id=${functionRow.id}`)

db.close()
