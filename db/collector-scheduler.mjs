import { runMetricByStoreAs } from "./collector-engine.mjs"

const EVERY_SECOND_CRON = "* * * * * *"

function nowMs() {
  return Date.now()
}

async function loadCron() {
  try {
    const module = await import("node-cron")
    return module.default
  } catch {
    const fallback = await import("../server/node_modules/node-cron/dist/esm/node-cron.js")
    return fallback.default
  }
}

export async function startMetricScheduler(db, options = {}) {
  const logger = options.logger ?? console
  const cron = await loadCron()
  const enabledMetrics = db.prepare(`
    SELECT store_as, every_seconds
    FROM metric_definitions
    WHERE enabled = 1
  `).all()

  const tasks = []

  for (const metric of enabledMetrics) {
    const everySeconds = Number(metric.every_seconds)

    if (!Number.isFinite(everySeconds) || everySeconds <= 0) {
      logger.warn(`[collector-scheduler] Skipping ${metric.store_as}: invalid every_seconds=${metric.every_seconds}`)
      continue
    }

    let isRunning = false
    let lastRunAtMs = 0

    const task = cron.schedule(EVERY_SECOND_CRON, async () => {
      const currentTimeMs = nowMs()
      if (lastRunAtMs !== 0 && currentTimeMs - lastRunAtMs < everySeconds * 1000) {
        return
      }

      if (isRunning) {
        logger.warn(`[collector-scheduler] Skipping ${metric.store_as}: previous run still in progress`)
        return
      }

      isRunning = true
      lastRunAtMs = currentTimeMs
      const startedAt = currentTimeMs
      logger.info(`[collector-scheduler] START store_as=${metric.store_as}`)

      try {
        const result = await runMetricByStoreAs(db, metric.store_as)
        const durationMs = nowMs() - startedAt

        if (result.ok) {
          logger.info(`[collector-scheduler] END store_as=${metric.store_as} status=ok duration_ms=${durationMs}`)
        } else {
          logger.error(
            `[collector-scheduler] END store_as=${metric.store_as} status=error duration_ms=${durationMs} error=${result.error ?? "unknown"}`,
          )
        }
      } catch (error) {
        const durationMs = nowMs() - startedAt
        const message = error instanceof Error ? error.message : "Unknown error"

        logger.error(
          `[collector-scheduler] END store_as=${metric.store_as} status=error duration_ms=${durationMs} error=${message}`,
        )
      } finally {
        isRunning = false
      }
    })

    tasks.push(task)
    logger.info(
      `[collector-scheduler] Scheduled store_as=${metric.store_as} every_seconds=${everySeconds} cron="${EVERY_SECOND_CRON}"`,
    )
  }

  return {
    stop() {
      for (const task of tasks) {
        task.stop()
      }
    },
  }
}
