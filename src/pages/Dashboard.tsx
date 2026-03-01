import React, { useEffect, useMemo, useState } from 'react';
import { Shield, Activity, AlertTriangle, ArrowUpRight } from 'lucide-react';

type LatestMetric = {
  id: number;
  storeAs: string;
  enabled: boolean;
  latest: {
    ts: string;
    valueNum: number | null;
    valueJson: unknown;
    status: string;
    error: string | null;
  } | null;
};

type LatestFunction = {
  id: number;
  name: string;
  version: string;
  enabled: boolean;
  latest: {
    ts: string;
    scoreValue: number;
  } | null;
};

type LatestResponse = {
  metrics: LatestMetric[];
  functions: LatestFunction[];
  timestamps: {
    generatedAt: string;
    latestMetricTs: string | null;
    latestFunctionScoreTs: string | null;
  };
};

function toGrade(score: number) {
  if (score >= 85) return { status: 'S-Grade', color: '#10b981' };
  if (score >= 70) return { status: 'Y-Grade', color: '#f59e0b' };
  return { status: 'C-Grade', color: '#ef4444' };
}

function formatTs(ts: string | null | undefined) {
  if (!ts) {
    return 'N/A';
  }

  return new Date(ts).toLocaleString();
}

export default function Dashboard() {
  const [data, setData] = useState<LatestResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch('/api/latest');

        if (!response.ok) {
          throw new Error(`Failed to fetch dashboard data (${response.status})`);
        }

        const payload = (await response.json()) as LatestResponse;

        if (!cancelled) {
          setData(payload);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unknown error');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  const metrics = data?.metrics ?? [];

  const avgMarketHealth = useMemo(() => {
    const values = metrics
      .map((metric) => metric.latest?.valueNum)
      .filter((value): value is number => typeof value === 'number');

    if (!values.length) {
      return null;
    }

    const sum = values.reduce((acc, value) => acc + value, 0);
    return (sum / values.length) * 100;
  }, [metrics]);

  const volatilityIndex = useMemo(() => {
    const values = metrics
      .map((metric) => metric.latest?.valueNum)
      .filter((value): value is number => typeof value === 'number');

    if (!values.length) {
      return null;
    }

    const mean = values.reduce((acc, value) => acc + value, 0) / values.length;
    const variance = values.reduce((acc, value) => acc + (value - mean) ** 2, 0) / values.length;
    return Math.sqrt(variance) * 100;
  }, [metrics]);

  const rankedAssets = useMemo(() => {
    return metrics
      .map((metric) => {
        const baseScore = typeof metric.latest?.valueNum === 'number' ? Math.max(0, Math.min(metric.latest.valueNum * 100, 100)) : 0;
        const score = Number(baseScore.toFixed(1));
        const grade = toGrade(score);

        return {
          id: metric.id,
          name: metric.storeAs.toUpperCase(),
          score,
          status: grade.status,
          color: grade.color,
        };
      })
      .sort((a, b) => b.score - a.score);
  }, [metrics]);

  const highRiskCount = rankedAssets.filter((asset) => asset.score < 70).length;

  return (
    <div className="min-h-screen bg-navy-primary text-white pt-24 px-[7vw] pb-20">
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-between items-end mb-12">
          <div>
            <h1 className="text-4xl font-bold mb-2 text-primary-light">Risk Dashboard</h1>
            <p className="text-secondary-light">Real-time stability monitoring and survival metrics.</p>
          </div>
          <div className="bg-white/5 border border-white/10 px-4 py-2 rounded-lg text-sm font-mono text-accent-coral">
            Last Update: {formatTs(data?.timestamps.latestMetricTs ?? data?.timestamps.generatedAt)}
          </div>
        </div>

        {error ? (
          <div className="mb-8 rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-red-200 text-sm">{error}</div>
        ) : null}

        <div className="grid md:grid-cols-3 gap-6 mb-12">
          <div className="glass-panel p-6 border-l-4 border-emerald-500">
            <div className="flex items-center gap-3 mb-4 text-emerald-500">
              <Shield className="w-5 h-5" />
              <span className="font-semibold uppercase text-xs tracking-wider">Avg Market Health</span>
            </div>
            <div className="text-3xl font-bold">{avgMarketHealth === null ? 'N/A' : `${avgMarketHealth.toFixed(1)}/100`}</div>
          </div>
          <div className="glass-panel p-6 border-l-4 border-amber-500">
            <div className="flex items-center gap-3 mb-4 text-amber-500">
              <Activity className="w-5 h-5" />
              <span className="font-semibold uppercase text-xs tracking-wider">Volitality Index</span>
            </div>
            <div className="text-3xl font-bold">{volatilityIndex === null ? 'N/A' : `${volatilityIndex.toFixed(1)}%`}</div>
          </div>
          <div className="glass-panel p-6 border-l-4 border-red-500">
            <div className="flex items-center gap-3 mb-4 text-red-500">
              <AlertTriangle className="w-5 h-5" />
              <span className="font-semibold uppercase text-xs tracking-wider">High Risk Alerts</span>
            </div>
            <div className="text-3xl font-bold">{highRiskCount} Assets</div>
          </div>
        </div>

        <div className="glass-panel overflow-hidden border border-white/10">
          <div className="p-6 border-b border-white/10 bg-white/5 font-semibold">Stability Ranking</div>
          <div className="divide-y divide-white/10">
            {loading ? (
              <div className="p-6 text-secondary-light text-sm">Loading dashboard data…</div>
            ) : rankedAssets.length ? (
              rankedAssets.map((asset) => (
                <div key={asset.id} className="p-6 flex items-center justify-between hover:bg-white/5 transition-colors">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center font-bold">{asset.name[0]}</div>
                    <div>
                      <div className="font-bold text-lg">{asset.name}</div>
                      <div className="text-xs text-secondary-light">Collateralized Stablecoin</div>
                    </div>
                  </div>

                  <div className="flex items-center gap-12 text-right">
                    <div>
                      <div className="text-xs text-secondary-light uppercase mb-1">Score</div>
                      <div className="text-xl font-mono font-bold" style={{ color: asset.color }}>
                        {asset.score}
                      </div>
                    </div>
                    <div className="hidden md:block">
                      <div className="text-xs text-secondary-light uppercase mb-1">Grade</div>
                      <div className="px-3 py-1 rounded-full bg-white/10 text-xs font-bold uppercase tracking-tighter">{asset.status}</div>
                    </div>
                    <ArrowUpRight className="w-5 h-5 text-white/30" />
                  </div>
                </div>
              ))
            ) : (
              <div className="p-6 text-secondary-light text-sm">No metric data yet. Seed and run collectors to populate the dashboard.</div>
            )}
          </div>
        </div>

        <div className="mt-6 text-xs text-secondary-light">
          Function scores loaded: {data?.functions.length ?? 0}
          {data?.timestamps.latestFunctionScoreTs ? ` • Latest score at ${formatTs(data.timestamps.latestFunctionScoreTs)}` : ''}
        </div>
      </div>
    </div>
  );
}
