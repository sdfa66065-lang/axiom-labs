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

function toFiniteNumber(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null
  }

  const parsed = Number.parseFloat(String(value))
  return Number.isFinite(parsed) ? parsed : null
}

function resolveLatestObservationValue(db, storeAs) {
  const row = db.prepare(`
    SELECT o.value_num AS value_num
    FROM observations o
    JOIN metric_definitions m ON m.id = o.metric_id
    WHERE m.store_as = ?
      AND o.status = 'ok'
    ORDER BY o.ts DESC, o.id DESC
    LIMIT 1
  `).get(storeAs)

  if (!row) {
    throw new Error(`No successful observations found for store_as=${storeAs}`)
  }

  const numeric = toFiniteNumber(row.value_num)
  if (numeric == null) {
    throw new Error(`Latest observation is not numeric for store_as=${storeAs}`)
  }

  return numeric
}

function computeIntermediate(name, intermediateConfig, values) {
  if (intermediateConfig?.op === "abs_diff_from") {
    const inputName = intermediateConfig.input
    const inputValue = values[inputName]
    const target = toFiniteNumber(intermediateConfig.target)

    if (inputValue == null) {
      throw new Error(`Intermediate ${name} references unknown input ${inputName}`)
    }

    if (target == null) {
      throw new Error(`Intermediate ${name} has invalid target`)
    }

    return Number(Math.abs(inputValue - target).toFixed(10))
  }

  throw new Error(`Unsupported intermediate op: ${intermediateConfig?.op}`)
}

function matchesCondition(condition, values) {
  if (condition?.lte) {
    const subject = values[condition.lte.var]
    const threshold = toFiniteNumber(condition.lte.value)
    return subject != null && threshold != null && subject <= threshold
  }

  throw new Error("Unsupported condition")
}

function evaluateRules(rules, values) {
  for (const rule of rules ?? []) {
    if (rule.if) {
      if (matchesCondition(rule.if, values)) {
        return rule.score
      }
      continue
    }

    if (rule.elif) {
      if (matchesCondition(rule.elif, values)) {
        return rule.score
      }
      continue
    }

    if (rule.else) {
      return rule.else.score
    }
  }

  throw new Error("No matching rule found")
}

export function runFunctionByName(db, name) {
  const fn = db.prepare(`
    SELECT id, name, version, config_json, enabled
    FROM function_definitions
    WHERE name = ?
    LIMIT 1
  `).get(name)

  if (!fn) {
    throw new Error(`Function not found: ${name}`)
  }

  if (!fn.enabled) {
    throw new Error(`Function is disabled: ${name}`)
  }

  const config = parseJsonConfig(fn.config_json)
  const inputConfig = config.inputs ?? {}
  const inputs = {}

  for (const [inputName, definition] of Object.entries(inputConfig)) {
    const storeAs = definition?.metric_store_as
    if (!storeAs) {
      throw new Error(`Input ${inputName} is missing metric_store_as`)
    }

    inputs[inputName] = resolveLatestObservationValue(db, storeAs)
  }

  const intermediates = {}
  for (const [intermediateName, definition] of Object.entries(config.intermediates ?? {})) {
    intermediates[intermediateName] = computeIntermediate(intermediateName, definition, {
      ...inputs,
      ...intermediates,
    })
  }

  const scoreValue = toFiniteNumber(evaluateRules(config.rules ?? [], {
    ...inputs,
    ...intermediates,
  }))

  if (scoreValue == null) {
    throw new Error("Computed score is not numeric")
  }

  const details = { ...intermediates, ...inputs }
  const ts = new Date().toISOString()

  db.prepare(`
    INSERT INTO function_scores (function_id, ts, score_value, details_json, inputs_json)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    fn.id,
    ts,
    scoreValue,
    JSON.stringify(details),
    JSON.stringify(inputs),
  )

  return {
    ok: true,
    functionId: fn.id,
    functionName: fn.name,
    version: fn.version,
    score_value: scoreValue,
    details_json: details,
    inputs_json: inputs,
  }
}
