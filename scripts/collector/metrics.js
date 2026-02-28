const FIVE_MINUTES = 5 * 60 * 1000;
const FIFTEEN_MINUTES = 15 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;
const ONE_DAY = 24 * 60 * 60 * 1000;

const getAtPath = (value, path) => {
  const parts = path.split('.');
  return parts.reduce((acc, part) => {
    if (acc == null) {
      return undefined;
    }

    const arrayMatch = part.match(/(\w+)\[(\d+)\]/);
    if (!arrayMatch) {
      return acc[part];
    }

    const [, field, index] = arrayMatch;
    return acc[field]?.[Number(index)];
  }, value);
};

const toNumber = (value, metricCode) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new Error(`Metric ${metricCode} returned a non-numeric value: ${String(value)}`);
  }
  return numeric;
};

const calculateMaxChainRatio = (chainBalances, metricCode) => {
  if (!chainBalances || typeof chainBalances !== 'object') {
    throw new Error(`Metric ${metricCode} returned an invalid chainBalances object.`);
  }

  const values = Object.values(chainBalances)
    .map((entry) => {
      if (typeof entry === 'number') {
        return entry;
      }

      if (entry && typeof entry === 'object') {
        const fallback = entry.current ?? entry.circulating ?? entry.amount;
        return Number(fallback);
      }

      return Number.NaN;
    })
    .filter((num) => Number.isFinite(num) && num > 0);

  if (values.length === 0) {
    throw new Error(`Metric ${metricCode} has no positive chain balances.`);
  }

  const total = values.reduce((sum, value) => sum + value, 0);
  const max = Math.max(...values);
  return max / total;
};

export const METRICS = [
  {
    code: 'P_DAI',
    endpoint: 'https://www.okx.com/api/v5/market/ticker?instId=DAI-USDT',
    jsonPath: 'data[0].last',
    intervalMs: FIVE_MINUTES,
    dbField: 'last_price_dai',
    extract: (json, metricCode) => toNumber(getAtPath(json, 'data[0].last'), metricCode),
  },
  {
    code: 'P_USDT',
    endpoint: 'https://api.binance.com/api/v3/ticker/price?symbol=USDCUSDT',
    jsonPath: '1 / float(price)',
    intervalMs: FIVE_MINUTES,
    dbField: 'last_price_usdt',
    extract: (json, metricCode) => {
      const quote = toNumber(json.price, metricCode);
      if (quote === 0) {
        throw new Error(`Metric ${metricCode} returned zero, cannot divide by zero.`);
      }
      return 1 / quote;
    },
  },
  {
    code: 'F_RATE',
    endpoint: 'https://fapi.binance.com/fapi/v1/premiumIndex?symbol=ETHUSDT',
    jsonPath: 'lastFundingRate',
    intervalMs: FIFTEEN_MINUTES,
    dbField: 'current_funding_rate',
    extract: (json, metricCode) => toNumber(json.lastFundingRate, metricCode),
  },
  {
    code: 'T_SUPPLY',
    endpoint: 'https://stablecoins.llama.fi/stablecoin/ethena-usde',
    jsonPath: 'circulating.peggedUSD',
    intervalMs: ONE_HOUR,
    dbField: 'total_supply_usde',
    extract: (json, metricCode) => toNumber(getAtPath(json, 'circulating.peggedUSD'), metricCode),
  },
  {
    code: 'CHAIN_DIST',
    endpoint: 'https://stablecoins.llama.fi/stablecoin/{id}',
    jsonPath: 'chainBalances',
    intervalMs: ONE_DAY,
    dbField: 'max_chain_ratio',
    extract: (json, metricCode, { stablecoinId } = {}) => {
      if (!stablecoinId) {
        throw new Error(`Metric ${metricCode} requires stablecoinId in runtime options.`);
      }
      return calculateMaxChainRatio(json.chainBalances, metricCode);
    },
    resolveEndpoint: ({ stablecoinId } = {}) => {
      if (!stablecoinId) {
        throw new Error('CHAIN_DIST metric requires stablecoinId runtime option.');
      }
      return `https://stablecoins.llama.fi/stablecoin/${stablecoinId}`;
    },
  },
];

export const FORMULAS = {
  USD_DEPEG_GAP: ({ last_price_dai, last_price_usdt }) => {
    if (last_price_dai == null || last_price_usdt == null) {
      throw new Error('USD_DEPEG_GAP requires last_price_dai and last_price_usdt.');
    }
    return Math.abs(last_price_dai - last_price_usdt);
  },
  FUNDING_PRESSURE: ({ current_funding_rate, max_chain_ratio }) => {
    if (current_funding_rate == null || max_chain_ratio == null) {
      throw new Error('FUNDING_PRESSURE requires current_funding_rate and max_chain_ratio.');
    }
    return current_funding_rate * max_chain_ratio;
  },
};
