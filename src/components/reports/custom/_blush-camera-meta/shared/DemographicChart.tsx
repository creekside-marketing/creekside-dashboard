'use client';

/**
 * DemographicChart — Reusable chart for age/gender, device, and placement breakdowns.
 *
 * Renders different chart types based on the `type` prop:
 * - 'age-gender': Grouped horizontal BarChart with male/female series
 * - 'device': PieChart donut
 * - 'placement': PieChart donut
 *
 * CANNOT: Fetch data — receives pre-aggregated data via props.
 * CANNOT: Handle drill-down or click interactions.
 * CANNOT: Combine multiple chart types in a single instance.
 */

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { REPORT_COLORS } from './report-colors';

// ── Types ────────────────────────────────────────────────────────────────

type DemographicType = 'age-gender' | 'device' | 'placement';

interface AgeGenderRow {
  ageRange: string;
  male: number;
  female: number;
}

interface DonutSlice {
  name: string;
  value: number;
}

interface DemographicChartProps {
  data: AgeGenderRow[] | DonutSlice[];
  type: DemographicType;
  title?: string;
  height?: number;
}

// ── Donut color palette ──────────────────────────────────────────────────

const DONUT_COLORS = [
  REPORT_COLORS.spend,
  REPORT_COLORS.efficiency,
  REPORT_COLORS.revenue,
  '#F59E0B', // amber
  '#EC4899', // pink
  '#06B6D4', // cyan
  '#F97316', // orange
  '#14B8A6', // teal
];

// ── Age-gender bar colors ────────────────────────────────────────────────

const GENDER_COLORS = {
  male: REPORT_COLORS.spend,
  female: REPORT_COLORS.efficiency,
};

// ── Component ────────────────────────────────────────────────────────────

export default function DemographicChart({
  data,
  type,
  title,
  height = 280,
}: DemographicChartProps) {
  const isEmpty = !data || data.length === 0;

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
      {title && (
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4">
          {title}
        </h3>
      )}

      {isEmpty ? (
        <div
          className="flex items-center justify-center text-sm text-slate-400"
          style={{ height }}
        >
          No data available
        </div>
      ) : type === 'age-gender' ? (
        <AgeGenderChart data={data as AgeGenderRow[]} height={height} />
      ) : (
        <DonutChart data={data as DonutSlice[]} height={height} />
      )}
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────

function AgeGenderChart({ data, height }: { data: AgeGenderRow[]; height: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
        <XAxis
          type="number"
          tick={{ fontSize: 11, fill: '#94a3b8' }}
          tickLine={false}
          axisLine={{ stroke: '#e2e8f0' }}
        />
        <YAxis
          dataKey="ageRange"
          type="category"
          tick={{ fontSize: 11, fill: '#94a3b8' }}
          tickLine={false}
          axisLine={false}
          width={60}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: '8px',
            fontSize: '12px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
          }}
        />
        <Legend
          iconType="circle"
          wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }}
        />
        <Bar
          dataKey="male"
          name="Male"
          fill={GENDER_COLORS.male}
          radius={[0, 4, 4, 0]}
          barSize={12}
        />
        <Bar
          dataKey="female"
          name="Female"
          fill={GENDER_COLORS.female}
          radius={[0, 4, 4, 0]}
          barSize={12}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Donut label renderer ─────────────────────────────────────────────────

interface CustomLabelProps {
  cx: number;
  cy: number;
  midAngle: number;
  innerRadius: number;
  outerRadius: number;
  percent: number;
  name: string;
}

const RADIAN = Math.PI / 180;

function renderCustomLabel({ cx, cy, midAngle, outerRadius, percent, name }: CustomLabelProps) {
  if (percent < 0.05) return null;
  const radius = outerRadius + 20;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);

  return (
    <text
      x={x}
      y={y}
      fill="#475569"
      textAnchor={x > cx ? 'start' : 'end'}
      dominantBaseline="central"
      fontSize={11}
    >
      {name} ({(percent * 100).toFixed(0)}%)
    </text>
  );
}

function DonutChart({ data, height }: { data: DonutSlice[]; height: number }) {
  const outerRadius = Math.min(height * 0.38, 100);
  const innerRadius = outerRadius * 0.55;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="50%"
          innerRadius={innerRadius}
          outerRadius={outerRadius}
          paddingAngle={2}
          label={renderCustomLabel as never}
          isAnimationActive={false}
        >
          {data.map((_, i) => (
            <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{
            backgroundColor: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: '8px',
            fontSize: '12px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
          }}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
