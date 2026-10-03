import { WEEKDAY_SHORT } from '../lib/dates';
import type { DayCounts } from '../lib/progress';

const ORDER = ['done', 'help', 'not_done', 'pending'] as const;

export function WeekChart({ days, today }: { days: DayCounts[]; today: string }) {
  const max = Math.max(1, ...days.map((d) => d.done + d.help + d.not_done + d.pending));
  const W = 336, H = 180, top = 12, base = 150, slot = W / 7, bar = 26;
  const summary = days.map((d, i) =>
    `${WEEKDAY_SHORT[i]}: ${d.done} done, ${d.help} needed help, ${d.not_done} not done, ${d.pending} not yet`).join('. ');

  return (
    <svg className="week-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary}>
      <line x1="0" x2={W} y1={base} y2={base} className="chart-axis" />
      {days.map((d, i) => {
        const x = slot * i + (slot - bar) / 2;
        let y = base;
        const future = d.date > today;
        return (
          <g key={d.date}>
            {ORDER.map((k) => {
              if (!d[k]) return null;
              const h = ((base - top) * d[k]) / max;
              y -= h;
              return <rect key={k} x={x} y={y} width={bar} height={Math.max(h - 2, 1)} rx="5" className={`bar-${k}`} />;
            })}
            <text x={x + bar / 2} y={base + 20} textAnchor="middle"
              className={d.date === today ? 'chart-label chart-today' : future ? 'chart-label chart-future' : 'chart-label'}>
              {WEEKDAY_SHORT[i]}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
