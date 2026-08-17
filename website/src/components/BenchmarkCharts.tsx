import React from 'react';
import { Chart } from 'react-charts';
import type { AxisOptions } from 'react-charts';

// Measured 2026-08-17 on macOS (Darwin 25.6), Node v26.7.0, against a real
// vault (381 notes, 84 folders, 3.2 MB) over stdio in read-only mode.
// Scripts: benchmarks/bench-v1-client.mjs and bench-v2-client.mjs in the repo.
type Stat = { median: number; p95: number; n: number };
type Pairing = {
  name: string;
  detail: string;
  coldStart: Stat;
  tools: Record<string, Stat>;
};

const PAIRINGS: Pairing[] = [
  {
    name: 'v1 server',
    detail: 'today’s npm release + a current client (SDK 1.30.0)',
    coldStart: { median: 107.3, p95: 155.5, n: 8 },
    tools: {
      'tools/list': { median: 0.15, p95: 0.28, n: 50 },
      get_vault_stats: { median: 12.13, p95: 13.95, n: 50 },
      read_note: { median: 0.46, p95: 0.84, n: 50 },
      list_directory: { median: 0.45, p95: 0.66, n: 50 },
      search_notes: { median: 85.53, p95: 107.44, n: 20 },
    },
  },
  {
    name: 'v2 server, current client',
    detail: 'the v2 build serving the same client every app uses today',
    coldStart: { median: 109.8, p95: 116.8, n: 8 },
    tools: {
      'tools/list': { median: 0.14, p95: 0.28, n: 50 },
      get_vault_stats: { median: 11.4, p95: 12.2, n: 50 },
      read_note: { median: 0.43, p95: 0.58, n: 50 },
      list_directory: { median: 0.43, p95: 0.49, n: 50 },
      search_notes: { median: 84.33, p95: 86.4, n: 20 },
    },
  },
  {
    name: 'v2 server, v2 client',
    detail: 'both sides on the new SDK (2.0.0), default settings',
    coldStart: { median: 105.8, p95: 107.8, n: 8 },
    tools: {
      'tools/list': { median: 0.17, p95: 0.34, n: 50 },
      get_vault_stats: { median: 11.66, p95: 12.33, n: 50 },
      read_note: { median: 0.45, p95: 0.65, n: 50 },
      list_directory: { median: 0.46, p95: 0.64, n: 50 },
      search_notes: { median: 85.62, p95: 88.15, n: 20 },
    },
  },
];

// Validated for CVD separation and 3:1 contrast on the #171717 card surface.
const COLORS = ['#0891b2', '#8b5cf6', '#d97706'];
const TOOLS = Object.keys(PAIRINGS[0].tools);

type Datum = { pairing: string; value: number };

function BarChart({ title, unit, values }: { title: string; unit: string; values: Datum[] }) {
  const data = React.useMemo(
    () =>
      values.map((v) => ({
        label: v.pairing,
        data: [{ primary: ' ', secondary: v.value }],
      })),
    [values],
  );

  const primaryAxis = React.useMemo<AxisOptions<{ primary: string; secondary: number }>>(
    () => ({
      getValue: (d) => d.primary,
      position: 'left',
      scaleType: 'band',
      show: false,
    }),
    [],
  );

  const secondaryAxes = React.useMemo<AxisOptions<{ primary: string; secondary: number }>[]>(
    () => [
      {
        getValue: (d) => d.secondary,
        position: 'bottom',
        scaleType: 'linear',
        min: 0,
        hardMin: 0,
        formatters: {
          scale: (v: number) => (v == null ? '' : `${v}`),
        },
      },
    ],
    [],
  );

  return (
    <figure className="bench-chart rounded-xl border border-border bg-card p-4">
      <figcaption className="mb-1 text-sm font-semibold text-foreground">
        {title} <span className="font-normal text-muted-foreground">· {unit}</span>
      </figcaption>
      <div className="bench-chart-reveal h-32" aria-hidden="true">
        <Chart
          options={{
            data,
            primaryAxis,
            secondaryAxes,
            defaultColors: COLORS,
            dark: true,
            tooltip: { show: true },
          }}
        />
      </div>
      <dl className="mt-2 grid grid-cols-3 gap-2 text-xs text-muted-foreground">
        {values.map((v, i) => (
          <div key={v.pairing} className="flex items-center gap-1.5">
            <span
              className="inline-block h-2 w-2 flex-shrink-0 rounded-sm"
              style={{ backgroundColor: COLORS[i] }}
              aria-hidden="true"
            />
            <span className="tabular-nums text-foreground">{v.value} ms</span>
          </div>
        ))}
      </dl>
    </figure>
  );
}

export default function BenchmarkCharts() {
  return (
    <div className="bench-charts space-y-8">
      <BarChart
        title="Cold start"
        unit="spawn to first response, median ms, lower is better"
        values={PAIRINGS.map((p) => ({ pairing: p.name, value: p.coldStart.median }))}
      />

      <div>
        <h3 className="mb-3 text-base font-semibold text-foreground">
          Per request, warm connection <span className="font-normal text-muted-foreground">· median ms</span>
        </h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {TOOLS.map((tool) => (
            <BarChart
              key={tool}
              title={tool}
              unit="ms"
              values={PAIRINGS.map((p) => ({ pairing: p.name, value: p.tools[tool].median }))}
            />
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
        {PAIRINGS.map((p, i) => (
          <span key={p.name} className="flex items-center gap-2">
            <span
              className="inline-block h-2.5 w-2.5 flex-shrink-0 rounded-sm"
              style={{ backgroundColor: COLORS[i] }}
              aria-hidden="true"
            />
            <span>
              <strong className="font-semibold text-foreground">{p.name}</strong>: {p.detail}
            </span>
          </span>
        ))}
      </div>

      <details className="rounded-xl border border-border bg-card px-4 py-3">
        <summary className="cursor-pointer text-sm font-semibold text-foreground">
          Full numbers (median and p95, in ms)
        </summary>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[540px] text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-4 font-semibold">metric</th>
                {PAIRINGS.map((p) => (
                  <th key={p.name} className="py-2 pr-4 font-semibold">
                    {p.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="tabular-nums text-muted-foreground">
              <tr className="border-b border-border/60">
                <td className="py-2 pr-4 text-foreground">cold start (n=8)</td>
                {PAIRINGS.map((p) => (
                  <td key={p.name} className="py-2 pr-4">
                    {p.coldStart.median} · p95 {p.coldStart.p95}
                  </td>
                ))}
              </tr>
              {TOOLS.map((tool) => (
                <tr key={tool} className="border-b border-border/60 last:border-b-0">
                  <td className="py-2 pr-4 text-foreground">
                    {tool} (n={PAIRINGS[0].tools[tool].n})
                  </td>
                  {PAIRINGS.map((p) => (
                    <td key={p.name} className="py-2 pr-4">
                      {p.tools[tool].median} · p95 {p.tools[tool].p95}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
