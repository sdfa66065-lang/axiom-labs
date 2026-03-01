import { initDb } from "../db/init-db.mjs"
import { runFunctionByName } from "../db/function-engine.mjs"

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
  JSON.stringify({ op: "float" }),
  1,
).lastInsertRowid)

const functionInsert = db.prepare(`
  INSERT INTO function_definitions (name, version, config_json, enabled)
  VALUES (?, ?, ?, ?)
`)

functionInsert.run(
  "D3_PEG",
  "v1",
  JSON.stringify({
    inputs: {
      P: { metric_store_as: "num" },
    },
    intermediates: {
      diff: {
        op: "abs_diff_from",
        input: "P",
        target: 1,
      },
    },
    rules: [
      { if: { lte: { var: "diff", value: 0.0001 } }, score: 20 },
      { elif: { lte: { var: "diff", value: 0.001 } }, score: 15 },
      { else: { score: 0 } },
    ],
  }),
  1,
)

const observationInsert = db.prepare(`
  INSERT INTO observations (metric_id, ts, value_num, value_json, raw_json, status, error)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`)

observationInsert.run(
  metricId,
  new Date().toISOString(),
  0.9999,
  null,
  JSON.stringify({ upstream: { value: "0.9999" } }),
  "ok",
  null,
)

const result = runFunctionByName(db, "D3_PEG")
console.log("Function evaluation result:", result)

const scoreRow = db.prepare(`
  SELECT score_value, details_json, inputs_json
  FROM function_scores
  ORDER BY id DESC
  LIMIT 1
`).get()

const details = JSON.parse(scoreRow.details_json)

if (scoreRow.score_value !== 20) {
  throw new Error(`Expected score_value=20, got ${scoreRow.score_value}`)
}

if (details.diff !== 0.0001) {
  throw new Error(`Expected diff=0.0001, got ${details.diff}`)
}

console.log("Acceptance check passed:", {
  score_value: scoreRow.score_value,
  diff: details.diff,
  P: details.P,
})

db.close()
