'use client';

import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';

interface ChartLine {
  dataKey: string;
  label: string;
  color: string;
  yAxisId?: 'left' | 'right';
  type?: 'line' | 'bar';
}

interface ReportChartProps {
  data: Record<string, unknown>[];
  xKey: string;
  lines: ChartLine[];
  height?: number;
  title?: string;
  formatY?: (value: number) => string;
  formatYRight?: (value: number) => string;
}

function formatXDate(value: string): string {
  if (!value) return '';
  const d = new Date(value + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function ReportChart({
  data,
  xKey,
  lines,
  height = 300,
  title,
  formatY,
  formatYRight,
}: ReportChartProps) {
  const hasRightAxis = lines.some((l) => l.yAxisId === 'right');

  if (data.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
        {title && <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4">{title}</h3>}
        <div className="flex items-center justify-center h-[200px] text-sm text-slate-400">No data available</div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
      {title && <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4">{title}</h3>}
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis
            dataKey={xKey}
            tickFormatter={formatXDate}
            tick={{ fontSize: 11, fill: '#94a3b8' }}
            tickLine={false}
            axisLine={{ stroke: '#e2e8f0' }}
          />
          <YAxis
            yAxisId="left"
            tick={{ fontSize: 11, fill: '#94a3b8' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={formatY}
          />
          {hasRightAxis && (
            <YAxis
              yAxisId="right"
              orientation="right"
              tick={{ fontSize: 11, fill: '#94a3b8' }}
              tickLine={false}
              axisLine={false}
              tickFormatter={formatYRight ?? formatY}
            />
          )}
          <Tooltip
            contentStyle={{
              backgroundColor: '#fff',
              border: '1px solid #e2e8f0',
              borderRadius: '8px',
              fontSize: '12px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
            }}
            labelFormatter={(label) => formatXDate(String(label ?? ''))}
          />
          <Legend
            iconType="circle"
            wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }}
          />
          {lines.map((line) =>
            line.type === 'bar' ? (
              <Bar
                key={line.dataKey}
                dataKey={line.dataKey}
                name={line.label}
                fill={line.color}
                yAxisId={line.yAxisId || 'left'}
                radius={[4, 4, 0, 0]}
                opacity={0.85}
              />
            ) : (
              <Line
                key={line.dataKey}
                dataKey={line.dataKey}
                name={line.label}
                stroke={line.color}
                yAxisId={line.yAxisId || 'left'}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
            )
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
