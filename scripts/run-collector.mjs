import { initDb } from "../db/init-db.mjs"
import { runMetricByStoreAs } from "../db/collector-engine.mjs"

const storeAs = process.argv[2]

if (!storeAs) {
  console.error("Usage: node scripts/run-collector.mjs <STORE_AS>")
  process.exit(1)
}

const db = initDb()

try {
  const result = await runMetricByStoreAs(db, storeAs, { timeoutMs: 5000, retries: 2 })
  console.log(JSON.stringify(result, null, 2))
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
} finally {
  db.close()
}
