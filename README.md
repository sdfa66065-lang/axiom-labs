# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

## Metric collector (scheduled API ingestion + DB persistence)

This repository now includes a Node-based collector under `scripts/collector` that:

- pulls the requested metrics from OKX, Binance, and DefiLlama,
- runs on per-metric schedules (5m / 15m / 1h / 1d),
- stores every sample in SQLite (`data/metrics.sqlite`),
- keeps a latest-values table for real-time calculations,
- supports formula execution from the latest DB state.

### Mappings implemented

| Metric | Endpoint | JSON extraction | Frequency | DB field |
|---|---|---|---|---|
| `P_DAI` | `https://www.okx.com/api/v5/market/ticker?instId=DAI-USDT` | `data[0].last` | 5 min | `last_price_dai` |
| `P_USDT` | `https://api.binance.com/api/v3/ticker/price?symbol=USDCUSDT` | `1 / price` | 5 min | `last_price_usdt` |
| `F_RATE` | `https://fapi.binance.com/fapi/v1/premiumIndex?symbol=ETHUSDT` | `lastFundingRate` | 15 min | `current_funding_rate` |
| `T_SUPPLY` | `https://stablecoins.llama.fi/stablecoin/ethena-usde` | `circulating.peggedUSD` | 1 hour | `total_supply_usde` |
| `CHAIN_DIST` | `https://stablecoins.llama.fi/stablecoin/{id}` | max ratio from `chainBalances` | 1 day | `max_chain_ratio` |

### Commands

- `npm run collect:start`
  - Starts long-running collection with intervals.
- `npm run collect:once`
  - Runs one ingestion round for all metrics.
- `npm run collect:calc`
  - Runs one ingestion round and then computes formula outputs from latest DB values.

### Optional runtime config

- `STABLECOIN_ID`
  - Used for `CHAIN_DIST` endpoint path replacement.
  - Default: `ethena-usde`.
  - Example: `STABLECOIN_ID=usdc npm run collect:once`.
