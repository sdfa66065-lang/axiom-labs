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

const metricRows = [
  {
    storeAs: "last_price_usdt",
    url: "https://www.okx.com/api/v5/market/ticker?instId=DAI-USDT",
    everySeconds: 3600,
    extractJson: { path: "response.data[0].last" },
    transformJson: { op: "float" },
  },
]

const insertedMetricIds = []
for (const metric of metricRows) {
  const result = insertMetric.run(
    metric.storeAs,
    metric.url,
    metric.everySeconds,
    JSON.stringify(metric.extractJson),
    JSON.stringify(metric.transformJson),
    1,
  )

  insertedMetricIds.push(Number(result.lastInsertRowid))
}

insertFunction.run(
  "risk_score",
  "v1",
  JSON.stringify({ weights: { volatility: 0.7, liquidity: 0.3 } }),
  1,
)

const functionRow = db.prepare("SELECT last_insert_rowid() AS id").get()

console.log(`Seeded DB at ${getDbPath()}`)
console.log(`Inserted metric_definitions row ids=${insertedMetricIds.join(",")}`)
console.log(`Inserted function_definitions row id=${functionRow.id}`)

db.close()
