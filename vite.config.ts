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
          db.prepare(`
            INSERT INTO metric_definitions (store_as, url, every_seconds, extract_json, transform_json, enabled)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(
            "json",
            "https://example.com/metric",
            300,
            JSON.stringify({ path: "$.data.value" }),
            JSON.stringify({ op: "identity" }),
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
