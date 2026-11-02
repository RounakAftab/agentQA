'use client';

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { formatMs, formatSeconds } from '@/lib/loadTestClient';
import styles from './page.module.css';

// Two series on the response-time chart; checked for colour-blind separation. Single-series charts use the first.
const AVG = '#2563EB';
const P95 = '#C2410C';
const GRID = '#E2E8F0';
const TICK = { fontSize: 11, fill: '#94A3B8' };
const LIMIT = '#94A3B8';

function ChartTooltip({ active, payload, label, format }) {
  if (!active || !payload?.length) return null;
  return (
    <div className={styles.tooltip}>
      <div className={styles.tooltipTitle}>{formatSeconds(label)} in · {payload[0].payload.vus} users</div>
      {payload.map((p) => (
        <div key={p.dataKey} className={styles.tooltipRow}>
          <span className={styles.swatch} style={{ background: p.color }} />
          <span>{p.name}</span>
          <strong>{p.value == null ? '–' : format(p.value)}</strong>
        </div>
      ))}
    </div>
  );
}

function Chart({ title, legend, samples, children, format, limit, limitLabel }) {
  return (
    <div className={styles.chart}>
      <div className={styles.chartHead}>
        <span className={styles.chartTitle}>{title}</span>
        {legend && (
          <span className={styles.legend}>
            {legend.map((l) => (
              <span key={l.label}>
                <span className={styles.swatch} style={{ background: l.color }} /> {l.label}
              </span>
            ))}
          </span>
        )}
      </div>
      <ResponsiveContainer width="100%" height={180}>
        <LineChart data={samples} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} tickFormatter={formatSeconds} tick={TICK} axisLine={false} tickLine={false} />
          <YAxis tick={TICK} axisLine={false} tickLine={false} width={48} tickFormatter={(v) => format(v)} />
          <Tooltip content={<ChartTooltip format={format} />} cursor={{ stroke: '#CBD5E1' }} />
          {limit != null && (
            <ReferenceLine y={limit} stroke={LIMIT} strokeDasharray="4 4" label={{ value: limitLabel, position: 'insideTopRight', fontSize: 11, fill: '#64748B' }} />
          )}
          {children}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

const line = (key, name, color) => (
  <Line type="linear" dataKey={key} name={name} stroke={color} strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} connectNulls />
);

// Live and finished runs: response time, throughput and errors over time, each on its own axis.
export default function LoadCharts({ samples, config }) {
  if (samples.length === 0) return null;
  return (
    <>
      <div className={styles.charts}>
        <Chart
          title="Response time"
          legend={[
            { label: 'Average', color: AVG },
            { label: 'p95 so far', color: P95 },
          ]}
          samples={samples}
          format={formatMs}
          limit={config.maxP95Ms}
          limitLabel="p95 limit"
        >
          {line('avgMs', 'Average', AVG)}
          {line('p95Ms', 'p95 so far', P95)}
        </Chart>
        <Chart title="Requests per second" samples={samples} format={(v) => `${Math.round(v)}/s`}>
          {line('rps', 'Requests', AVG)}
        </Chart>
        <Chart title="Failed requests" samples={samples} format={(v) => `${v}%`} limit={config.maxErrorRatePct} limitLabel="limit">
          {line('errorPct', 'Failed', AVG)}
        </Chart>
      </div>
      <details className={styles.dataTable}>
        <summary>Show the numbers as a table</summary>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Time</th>
              <th>Users</th>
              <th>Requests/s</th>
              <th>Average</th>
              <th>p95 so far</th>
              <th>Failed</th>
            </tr>
          </thead>
          <tbody>
            {samples.map((s) => (
              <tr key={s.t}>
                <td>{formatSeconds(s.t)}</td>
                <td>{s.vus}</td>
                <td>{s.rps}</td>
                <td>{formatMs(s.avgMs)}</td>
                <td>{formatMs(s.p95Ms)}</td>
                <td>{s.errorPct == null ? '–' : `${s.errorPct}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </>
  );
}
