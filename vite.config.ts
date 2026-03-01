import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { inspectAttr } from "kimi-plugin-inspect-react"

function supportsNodeSqlite() {
  const [major, minor] = process.versions.node.split(".").map(Number)

  if (!Number.isFinite(major) || !Number.isFinite(minor)) {
    return false
  }

  return major > 22 || (major === 22 && minor >= 5)
}

function dbDevRoutesPlugin() {
  return {
    name: "db-dev-routes",
    async configureServer(server: import("vite").ViteDevServer) {
      if (!supportsNodeSqlite()) {
        server.config.logger.warn(
          `[db-dev-routes] Skipping /api/seed-configs route because node:sqlite is unavailable on Node ${process.versions.node}.`,
        )
        return
      }

      const { initDb } = await import("./db/init-db.mjs")
      const { runMetricByStoreAs, runMetricById } = await import("./db/collector-engine.mjs")
      const db = initDb()

      server.httpServer?.once("close", () => {
        db.close()
      })

      server.middlewares.use("/api/seed-configs", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405
          res.setHeader("Content-Type", "application/json")
          res.end(JSON.stringify({ error: "Method not allowed" }))
          return
        }

        try {
          const insertMetric = db.prepare(`
            INSERT INTO metric_definitions (store_as, url, every_seconds, extract_json, transform_json, enabled)
            VALUES (?, ?, ?, ?, ?, ?)
          `)

          insertMetric.run(
            "last_price_usdt",
            "https://www.okx.com/api/v5/market/ticker?instId=DAI-USDT",
            3600,
            JSON.stringify({ path: "response.data[0].last" }),
            JSON.stringify({ op: "float" }),
            1,
          )

          const metricRow = db.prepare("SELECT last_insert_rowid() AS id").get()

          db.prepare(`
            INSERT INTO function_definitions (name, version, config_json, enabled)
            VALUES (?, ?, ?, ?)
          `).run(
            "risk_score",
            "v1",
            JSON.stringify({ weights: { volatility: 0.7, liquidity: 0.3 } }),
            1,
          )

          const functionRow = db.prepare("SELECT last_insert_rowid() AS id").get()

          res.statusCode = 200
          res.setHeader("Content-Type", "application/json")
          res.end(JSON.stringify({
            ok: true,
            metricId: metricRow.id,
            functionId: functionRow.id,
          }))
        } catch (error) {
          res.statusCode = 500
          res.setHeader("Content-Type", "application/json")
          res.end(JSON.stringify({
            ok: false,
            error: error instanceof Error ? error.message : "Unknown error",
          }))
        }
      })

      server.middlewares.use("/api/run-metric", async (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405
          res.setHeader("Content-Type", "application/json")
          res.end(JSON.stringify({ error: "Method not allowed" }))
          return
        }

        const chunks: Buffer[] = []

        req.on("data", (chunk) => chunks.push(chunk))
        req.on("end", async () => {
          try {
            const payload = chunks.length
              ? JSON.parse(Buffer.concat(chunks).toString("utf8"))
              : {}

            if (!payload.storeAs) {
              res.statusCode = 400
              res.setHeader("Content-Type", "application/json")
              res.end(JSON.stringify({ ok: false, error: "storeAs is required" }))
              return
            }

            const result = await runMetricByStoreAs(db, payload.storeAs)
            res.statusCode = result.ok ? 200 : 500
            res.setHeader("Content-Type", "application/json")
            res.end(JSON.stringify(result))
          } catch (error) {
            res.statusCode = 500
            res.setHeader("Content-Type", "application/json")
            res.end(JSON.stringify({
              ok: false,
              error: error instanceof Error ? error.message : "Unknown error",
            }))
          }
        })
      })

      server.middlewares.use("/api/latest", (req, res) => {
        if (req.method !== "GET") {
          res.statusCode = 405
          res.setHeader("Content-Type", "application/json")
          res.end(JSON.stringify({ error: "Method not allowed" }))
          return
        }

        try {
          const latestMetrics = db.prepare(`
            SELECT
              md.id,
              md.store_as,
              md.enabled,
              o.ts,
              o.value_num,
              o.value_json,
              o.status,
              o.error
            FROM metric_definitions md
            LEFT JOIN observations o ON o.id = (
              SELECT id
              FROM observations
              WHERE metric_id = md.id
              ORDER BY ts DESC, id DESC
              LIMIT 1
            )
            ORDER BY md.store_as COLLATE NOCASE ASC
          `).all()

          const latestFunctionScores = db.prepare(`
            SELECT
              fd.id,
              fd.name,
              fd.version,
              fd.enabled,
              fs.ts,
              fs.score_value,
              fs.details_json,
              fs.inputs_json
            FROM function_definitions fd
            LEFT JOIN function_scores fs ON fs.id = (
              SELECT id
              FROM function_scores
              WHERE function_id = fd.id
              ORDER BY ts DESC, id DESC
              LIMIT 1
            )
            ORDER BY fd.name COLLATE NOCASE ASC, fd.version COLLATE NOCASE ASC
          `).all()

          const responsePayload = {
            metrics: latestMetrics.map((row) => ({
              id: row.id,
              storeAs: row.store_as,
              enabled: Boolean(row.enabled),
              latest: row.ts
                ? {
                    ts: row.ts,
                    valueNum: row.value_num,
                    valueJson: row.value_json ? JSON.parse(row.value_json) : null,
                    status: row.status,
                    error: row.error,
                  }
                : null,
            })),
            functions: latestFunctionScores.map((row) => ({
              id: row.id,
              name: row.name,
              version: row.version,
              enabled: Boolean(row.enabled),
              latest: row.ts
                ? {
                    ts: row.ts,
                    scoreValue: row.score_value,
                    details: row.details_json ? JSON.parse(row.details_json) : null,
                    inputs: row.inputs_json ? JSON.parse(row.inputs_json) : null,
                  }
                : null,
            })),
            timestamps: {
              generatedAt: new Date().toISOString(),
              latestMetricTs: latestMetrics.reduce<string | null>((maxTs, row) => {
                if (!row.ts) {
                  return maxTs
                }

                if (!maxTs || row.ts > maxTs) {
                  return row.ts
                }

                return maxTs
              }, null),
              latestFunctionScoreTs: latestFunctionScores.reduce<string | null>((maxTs, row) => {
                if (!row.ts) {
                  return maxTs
                }

                if (!maxTs || row.ts > maxTs) {
                  return row.ts
                }

                return maxTs
              }, null),
            },
          }

          res.statusCode = 200
          res.setHeader("Content-Type", "application/json")
          res.end(JSON.stringify(responsePayload))
        } catch (error) {
          res.statusCode = 500
          res.setHeader("Content-Type", "application/json")
          res.end(JSON.stringify({
            ok: false,
            error: error instanceof Error ? error.message : "Unknown error",
          }))
        }
      })

      server.middlewares.use("/api", async (req, res, next) => {
        const url = new URL(req.originalUrl ?? req.url ?? "", "http://localhost")
        const pathname = url.pathname

        const metricHistoryMatch = pathname.match(/^\/api\/metrics\/(\d+)\/history$/)
        if (metricHistoryMatch) {
          if (req.method !== "GET") {
            res.statusCode = 405
            res.setHeader("Content-Type", "application/json")
            res.end(JSON.stringify({ error: "Method not allowed" }))
            return
          }

          try {
            const metricId = Number(metricHistoryMatch[1])
            const requestedLimit = Number(url.searchParams.get("limit") ?? "200")
            const limit = Number.isFinite(requestedLimit)
              ? Math.max(1, Math.min(Math.trunc(requestedLimit), 1000))
              : 200

            const rows = db.prepare(`
              SELECT id, metric_id, ts, value_num, value_json, status, error
              FROM observations
              WHERE metric_id = ?
              ORDER BY ts DESC, id DESC
              LIMIT ?
            `).all(metricId, limit)

            res.statusCode = 200
            res.setHeader("Content-Type", "application/json")
            res.end(JSON.stringify({
              metricId,
              history: rows.map((row) => ({
                id: row.id,
                metricId: row.metric_id,
                ts: row.ts,
                valueNum: row.value_num,
                valueJson: row.value_json ? JSON.parse(row.value_json) : null,
                status: row.status,
                error: row.error,
              })),
            }))
            return
          } catch (error) {
            res.statusCode = 500
            res.setHeader("Content-Type", "application/json")
            res.end(JSON.stringify({
              ok: false,
              error: error instanceof Error ? error.message : "Unknown error",
            }))
            return
          }
        }

        const functionScoresMatch = pathname.match(/^\/api\/functions\/(\d+)\/scores$/)
        if (functionScoresMatch) {
          if (req.method !== "GET") {
            res.statusCode = 405
            res.setHeader("Content-Type", "application/json")
            res.end(JSON.stringify({ error: "Method not allowed" }))
            return
          }

          try {
            const functionId = Number(functionScoresMatch[1])
            const requestedLimit = Number(url.searchParams.get("limit") ?? "200")
            const limit = Number.isFinite(requestedLimit)
              ? Math.max(1, Math.min(Math.trunc(requestedLimit), 1000))
              : 200

            const rows = db.prepare(`
              SELECT id, function_id, ts, score_value, details_json, inputs_json
              FROM function_scores
              WHERE function_id = ?
              ORDER BY ts DESC, id DESC
              LIMIT ?
            `).all(functionId, limit)

            res.statusCode = 200
            res.setHeader("Content-Type", "application/json")
            res.end(JSON.stringify({
              functionId,
              scores: rows.map((row) => ({
                id: row.id,
                functionId: row.function_id,
                ts: row.ts,
                scoreValue: row.score_value,
                details: row.details_json ? JSON.parse(row.details_json) : null,
                inputs: row.inputs_json ? JSON.parse(row.inputs_json) : null,
              })),
            }))
            return
          } catch (error) {
            res.statusCode = 500
            res.setHeader("Content-Type", "application/json")
            res.end(JSON.stringify({
              ok: false,
              error: error instanceof Error ? error.message : "Unknown error",
            }))
            return
          }
        }

        const runMetricMatch = pathname.match(/^\/api\/run\/(\d+)$/)
        if (runMetricMatch) {
          if (req.method !== "POST") {
            res.statusCode = 405
            res.setHeader("Content-Type", "application/json")
            res.end(JSON.stringify({ error: "Method not allowed" }))
            return
          }

          try {
            const metricId = Number(runMetricMatch[1])

            if (!Number.isInteger(metricId) || metricId <= 0) {
              res.statusCode = 400
              res.setHeader("Content-Type", "application/json")
              res.end(JSON.stringify({ ok: false, error: "Invalid metric id" }))
              return
            }

            const result = await runMetricById(db, metricId)
            res.statusCode = result.ok ? 200 : 500
            res.setHeader("Content-Type", "application/json")
            res.end(JSON.stringify(result))
            return
          } catch (error) {
            res.statusCode = 500
            res.setHeader("Content-Type", "application/json")
            res.end(JSON.stringify({
              ok: false,
              error: error instanceof Error ? error.message : "Unknown error",
            }))
            return
          }
        }

        next()
      })

    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  base: "./",
  plugins: [inspectAttr(), react(), ...(command === "serve" ? [dbDevRoutesPlugin()] : [])],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}))
