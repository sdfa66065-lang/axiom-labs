import { initDb } from "../db/init-db.mjs"
import { runFunctionByName } from "../db/function-engine.mjs"

const functionName = process.argv[2]
const functionVersion = process.argv[3]

if (!functionName) {
  console.error("Usage: node scripts/run-function.mjs <FUNCTION_NAME> [VERSION]")
  process.exit(1)
}

const db = initDb()

try {
  const result = runFunctionByName(db, functionName, { version: functionVersion })
  console.log(JSON.stringify(result, null, 2))
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
} finally {
  db.close()
}
