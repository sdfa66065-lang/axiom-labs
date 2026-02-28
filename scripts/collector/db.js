import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

const DEFAULT_DB_PATH = path.resolve('data', 'metrics.sqlite');

export const initDb = (dbPath = DEFAULT_DB_PATH) => {
  const db = new DatabaseSync(dbPath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS metric_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      metric_code TEXT NOT NULL,
      db_field TEXT NOT NULL,
      value REAL NOT NULL,
      source_endpoint TEXT NOT NULL,
      collected_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS latest_metric_values (
      metric_code TEXT PRIMARY KEY,
      db_field TEXT NOT NULL,
      value REAL NOT NULL,
      source_endpoint TEXT NOT NULL,
      collected_at TEXT NOT NULL
    );
  `);

  const insertSnapshot = db.prepare(`
    INSERT INTO metric_snapshots (metric_code, db_field, value, source_endpoint, collected_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  const upsertLatest = db.prepare(`
    INSERT INTO latest_metric_values (metric_code, db_field, value, source_endpoint, collected_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(metric_code) DO UPDATE SET
      db_field = excluded.db_field,
      value = excluded.value,
      source_endpoint = excluded.source_endpoint,
      collected_at = excluded.collected_at
  `);

  const saveMetric = ({ metricCode, dbField, value, sourceEndpoint, collectedAt }) => {
    insertSnapshot.run(metricCode, dbField, value, sourceEndpoint, collectedAt);
    upsertLatest.run(metricCode, dbField, value, sourceEndpoint, collectedAt);
  };

  const getLatestByDbField = () => {
    const rows = db
      .prepare('SELECT db_field, value FROM latest_metric_values')
      .all();

    return rows.reduce((acc, row) => {
      acc[row.db_field] = row.value;
      return acc;
    }, {});
  };

  return {
    db,
    dbPath,
    saveMetric,
    getLatestByDbField,
  };
};
