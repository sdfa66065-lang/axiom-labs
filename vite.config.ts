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
      const { runMetricByStoreAs } = await import("./db/collector-engine.mjs")
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
