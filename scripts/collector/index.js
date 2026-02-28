import { initDb } from './db.js';
import { FORMULAS, METRICS } from './metrics.js';

const readOptions = () => {
  const runtime = {
    stablecoinId: process.env.STABLECOIN_ID ?? 'ethena-usde',
  };

  return {
    once: process.argv.includes('--once'),
    runCalc: process.argv.includes('--calc'),
    runtime,
  };
};

const fetchMetric = async (metric, runtime) => {
  const endpoint = metric.resolveEndpoint ? metric.resolveEndpoint(runtime) : metric.endpoint;
  const response = await fetch(endpoint);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} while fetching ${metric.code} from ${endpoint}`);
  }

  const body = await response.json();
  const value = metric.extract(body, metric.code, runtime);

  return {
    metricCode: metric.code,
    dbField: metric.dbField,
    value,
    sourceEndpoint: endpoint,
    collectedAt: new Date().toISOString(),
  };
};

const collectSingleMetric = async ({ metric, runtime, saveMetric }) => {
  try {
    const result = await fetchMetric(metric, runtime);
    saveMetric(result);
    console.log(`[OK] ${result.metricCode}=${result.value} (${result.dbField})`);
  } catch (error) {
    console.error(`[ERR] ${metric.code}:`, error.message);
  }
};

const runCalculations = (latestByDbField) => {
  const entries = Object.entries(FORMULAS).map(([name, calculator]) => {
    const value = calculator(latestByDbField);
    return { name, value };
  });

  console.log('--- Formula outputs (based on latest DB values) ---');
  entries.forEach((item) => {
    console.log(`${item.name}: ${item.value}`);
  });
};

const start = async () => {
  const { once, runCalc, runtime } = readOptions();
  const { dbPath, saveMetric, getLatestByDbField } = initDb();

  console.log(`Collector database: ${dbPath}`);
  console.log(`Runtime stablecoinId: ${runtime.stablecoinId}`);

  if (once) {
    await Promise.all(METRICS.map((metric) => collectSingleMetric({ metric, runtime, saveMetric })));
    if (runCalc) {
      runCalculations(getLatestByDbField());
    }
    return;
  }

  for (const metric of METRICS) {
    await collectSingleMetric({ metric, runtime, saveMetric });

    setInterval(() => {
      collectSingleMetric({ metric, runtime, saveMetric });
    }, metric.intervalMs);
  }

  if (runCalc) {
    setInterval(() => {
      try {
        runCalculations(getLatestByDbField());
      } catch (error) {
        console.error('[ERR] Formula execution failed:', error.message);
      }
    }, 60 * 1000);
  }
};

start().catch((error) => {
  console.error('[FATAL] Collector crashed:', error);
  process.exit(1);
});
