import { initDb } from "../db/init-db.mjs"

const db = initDb()

const metricInsert = db.prepare(`
  INSERT INTO metric_definitions (store_as, url, every_seconds, extract_json, transform_json, enabled)
  VALUES (?, ?, ?, ?, ?, ?)
`)

const metricId = Number(metricInsert.run(
  "num",
  "https://example.com/test-metric",
  60,
  JSON.stringify({ path: "$.price" }),
  JSON.stringify({ op: "parseFloat" }),
  1,
).lastInsertRowid)

const observationInsert = db.prepare(`
  INSERT INTO observations (metric_id, ts, value_num, value_json, raw_json, status, error)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`)

observationInsert.run(
  metricId,
  new Date().toISOString(),
  42.5,
  JSON.stringify({ value: 42.5 }),
  JSON.stringify({ upstream: { value: "42.5" } }),
  "ok",
  null,
)

const observation = db.prepare(`
  SELECT id, metric_id, status, value_num
  FROM observations
  WHERE metric_id = ?
  ORDER BY id DESC
  LIMIT 1
`).get(metricId)

console.log("Latest observation:", observation)

db.close()
