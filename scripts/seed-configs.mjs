import fs from "node:fs"
import path from "node:path"
import yaml from "js-yaml"
import { initDb, getDbPath } from "../db/init-db.mjs"

const db = initDb()
const configDir = path.resolve(process.cwd(), "server", "config")

function loadYamlConfig(filename) {
  const filePath = path.join(configDir, filename)
  const fileContent = fs.readFileSync(filePath, "utf8")
  return yaml.load(fileContent)
}

const metricsConfig = loadYamlConfig("metrics.yaml")
const functionsConfig = loadYamlConfig("functions.yaml")

const insertMetric = db.prepare(`
  INSERT INTO metric_definitions (store_as, url, every_seconds, extract_json, transform_json, enabled)
  VALUES (?, ?, ?, ?, ?, ?)
`)

const updateMetric = db.prepare(`
  UPDATE metric_definitions
  SET store_as = ?, every_seconds = ?, extract_json = ?, transform_json = ?, enabled = ?
  WHERE id = ?
`)

const selectMetricByUrl = db.prepare(`
  SELECT id FROM metric_definitions WHERE url = ? LIMIT 1
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
const updateFunction = db.prepare(`
  UPDATE function_definitions
  SET config_json = ?, enabled = ?
  WHERE id = ?
`)

const selectFunction = db.prepare(`
  SELECT id FROM function_definitions WHERE name = ? AND version = ? LIMIT 1
`)

const metricKeys = []
for (const metric of metricsConfig.metrics ?? []) {
  const existingMetric = selectMetricByUrl.get(metric.url)

  if (existingMetric) {
    updateMetric.run(
      metric.store_as,
      metric.every_seconds,
      JSON.stringify(metric.extract_json ?? null),
      JSON.stringify(metric.transform_json ?? null),
      metric.enabled === false ? 0 : 1,
      existingMetric.id,
    )
  } else {
    insertMetric.run(
      metric.store_as,
      metric.url,
      metric.every_seconds,
      JSON.stringify(metric.extract_json ?? null),
      JSON.stringify(metric.transform_json ?? null),
      metric.enabled === false ? 0 : 1,
    )
  }

  metricKeys.push(metric.key)
}

const functionKeys = []
for (const fn of functionsConfig.functions ?? []) {
  const existingFunction = selectFunction.get(fn.name, fn.version)

  if (existingFunction) {
    updateFunction.run(
      JSON.stringify(fn.config ?? {}),
      fn.enabled === false ? 0 : 1,
      existingFunction.id,
    )
  } else {
    insertFunction.run(
      fn.name,
      fn.version,
      JSON.stringify(fn.config ?? {}),
      fn.enabled === false ? 0 : 1,
    )
  }

  functionKeys.push(`${fn.name}@${fn.version}`)
}

console.log(`Seeded DB at ${getDbPath()}`)
console.log(`Inserted metric_definitions row ids=${insertedMetricIds.join(",")}`)
console.log(`Inserted function_definitions row id=${functionRow.id}`)

db.close()
