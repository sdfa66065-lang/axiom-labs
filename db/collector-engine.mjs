const DEFAULT_TIMEOUT_MS = 5000
const DEFAULT_RETRIES = 2

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function parseJsonConfig(input, fallback = {}) {
  if (!input) {
    return fallback
  }

  try {
    return JSON.parse(input)
  } catch {
    return fallback
  }
}

function tokenizeJsonPath(path) {
  if (!path || typeof path !== "string") {
    return []
  }

  let normalizedPath = path.trim()
  if (normalizedPath.startsWith("response.")) {
    normalizedPath = `$${normalizedPath.slice("response".length)}`
  }

  if (!normalizedPath.startsWith("$")) {
    normalizedPath = `$.${normalizedPath.replace(/^\./, "")}`
  }

  if (!normalizedPath.startsWith("$")) {
    return []
  }

  const tokens = []
  let i = 1

  while (i < normalizedPath.length) {
    if (normalizedPath[i] === ".") {
      i += 1
      let key = ""
      while (i < normalizedPath.length && /[A-Za-z0-9_$]/.test(normalizedPath[i])) {
        key += normalizedPath[i]
        i += 1
      }

      if (!key) {
        return []
      }

      tokens.push({ type: "key", value: key })
      continue
    }

    if (normalizedPath[i] === "[") {
      i += 1
      let content = ""
      while (i < normalizedPath.length && normalizedPath[i] !== "]") {
        content += normalizedPath[i]
        i += 1
      }

      if (normalizedPath[i] !== "]") {
        return []
      }

      i += 1
      const trimmed = content.trim()
      if (/^\d+$/.test(trimmed)) {
        tokens.push({ type: "index", value: Number(trimmed) })
      } else if (
        (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'"))
      ) {
        tokens.push({ type: "key", value: trimmed.slice(1, -1) })
      } else {
        return []
      }

      continue
    }

    return []
  }

  return tokens
}

function extractJsonPath(source, path) {
  const tokens = tokenizeJsonPath(path)
  if (!tokens.length) {
    return source
  }

  let value = source
  for (const token of tokens) {
    if (value == null) {
      return undefined
    }

    if (token.type === "key") {
      value = value[token.value]
      continue
    }

    if (!Array.isArray(value)) {
      return undefined
    }

    value = value[token.value]
  }

  return value
}

function floatTransform(input) {
  if (typeof input === "number") {
    return Number.isFinite(input) ? input : null
  }

  const parsed = Number.parseFloat(String(input))
  return Number.isFinite(parsed) ? parsed : null
}

function safeExprTransform(expression, input) {
  if (expression !== "1/float(x)") {
    throw new Error(`Unsupported expr transform: ${expression}`)
  }

  const value = floatTransform(input)
  if (value == null || value === 0) {
    throw new Error("expr produced invalid value")
  }

  return 1 / value
}

function maxChainRatio(chainBalances) {
  if (!chainBalances || typeof chainBalances !== "object" || Array.isArray(chainBalances)) {
    throw new Error("chainBalances must be an object")
  }

  const values = Object.values(chainBalances)
    .map((entry) => floatTransform(entry))
    .filter((entry) => entry != null)

  if (!values.length) {
    throw new Error("chainBalances has no numeric entries")
  }

  const total = values.reduce((sum, value) => sum + value, 0)
  if (total <= 0) {
    throw new Error("chainBalances total must be positive")
  }

  const largest = Math.max(...values)
  return largest / total
}

function applyTransform(extracted, rawJson, config) {
  const op = config?.op ?? "identity"

  if (op === "identity") {
    return extracted
  }

  if (op === "float") {
    return floatTransform(extracted)
  }

  if (op === "expr") {
    return safeExprTransform(config.expr, extracted)
  }

  if (op === "max_chain_ratio") {
    const field = config.field ?? "chainBalances"
    const chainBalances = typeof extracted === "object" && extracted != null
      ? extracted[field] ?? extracted
      : rawJson?.[field]

    return {
      value_num: maxChainRatio(chainBalances),
      value_json: chainBalances,
    }
  }

  throw new Error(`Unsupported transform op: ${op}`)
}

async function fetchJsonWithRetry(url, options = {}) {
  const timeoutMs = Number(options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const retries = Number(options.retries ?? DEFAULT_RETRIES)

  let lastError = null

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetch(url, { signal: controller.signal })
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const data = await response.json()
      clearTimeout(timeout)
      return data
    } catch (error) {
      clearTimeout(timeout)
      lastError = error

      if (attempt < retries) {
        await sleep(250 * (attempt + 1))
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Fetch failed")
}

export async function runMetricByStoreAs(db, storeAs, options = {}) {
  const metric = db.prepare(`
    SELECT id, store_as, url, extract_json, transform_json, enabled
    FROM metric_definitions
    WHERE store_as = ?
    LIMIT 1
  `).get(storeAs)

  if (!metric) {
    throw new Error(`Metric not found: ${storeAs}`)
  }

  if (!metric.enabled) {
    throw new Error(`Metric is disabled: ${storeAs}`)
  }

  const ts = new Date().toISOString()

  try {
    const rawJson = await fetchJsonWithRetry(metric.url, options)
    const extractConfig = parseJsonConfig(metric.extract_json)
    const transformConfig = parseJsonConfig(metric.transform_json)

    const extracted = extractJsonPath(rawJson, extractConfig.path)
    const transformed = applyTransform(extracted, rawJson, transformConfig)

    const valueNum = typeof transformed === "object" && transformed !== null
      ? floatTransform(transformed.value_num)
      : floatTransform(transformed)

    const valueJson = typeof transformed === "object" && transformed !== null && transformed.value_json !== undefined
      ? transformed.value_json
      : null

    db.prepare(`
      INSERT INTO observations (metric_id, ts, value_num, value_json, raw_json, status, error)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      metric.id,
      ts,
      valueNum,
      valueJson == null ? null : JSON.stringify(valueJson),
      JSON.stringify(rawJson),
      "ok",
      null,
    )

    return {
      ok: true,
      metricId: metric.id,
      status: "ok",
      value_num: valueNum,
      value_json: valueJson,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"

    db.prepare(`
      INSERT INTO observations (metric_id, ts, value_num, value_json, raw_json, status, error)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(metric.id, ts, null, null, null, "error", message)

    return {
      ok: false,
      metricId: metric.id,
      status: "error",
      error: message,
    }
  }
}
