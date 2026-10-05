'use client';

// Thin Recharts wrappers for the revenue dashboard. Each component
// takes already-aggregated data from the server and renders a
// single, calm chart. Currencies are NEVER merged.

import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Legend,
  Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';

const COLOURS = {
  confirmed: '#0F7A3C',   // --success
  pending:   '#8A6410',   // --warning
  reversed:  '#B4262D',   // --danger
  accent:    '#2457C5',   // --accent
  axis:      '#8A8E93',   // --admin-text-subtle
  grid:      '#E6E6E2',   // --admin-border
};

function fmtMoney(minor: number, currency: string): string {
  const sym = currency === 'GBP' ? '£' : currency === 'USD' ? '$' : currency === 'EUR' ? '€' : '';
  const n = minor / 100;
  return `${sym}${n.toLocaleString('en-GB', { maximumFractionDigits: 0 })}`;
}

export function RevenueOverTimeChart({
  data,
  currency,
}: {
  data: Array<{ bucket: string; confirmed_minor: number; pending_minor: number; reversed_minor: number }>;
  currency: string;
}) {
  const rows = data.map((d) => ({
    month: d.bucket,
    confirmed: d.confirmed_minor / 100,
    pending: d.pending_minor / 100,
    reversed: Math.abs(d.reversed_minor) / 100,
  }));
  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={rows} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="g-conf" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor={COLOURS.confirmed} stopOpacity={0.3} />
            <stop offset="100%" stopColor={COLOURS.confirmed} stopOpacity={0} />
          </linearGradient>
          <linearGradient id="g-pend" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor={COLOURS.pending} stopOpacity={0.3} />
            <stop offset="100%" stopColor={COLOURS.pending} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={COLOURS.grid} />
        <XAxis dataKey="month" tick={{ fill: COLOURS.axis, fontSize: 11 }} tickLine={false} axisLine={{ stroke: COLOURS.grid }} />
        <YAxis tick={{ fill: COLOURS.axis, fontSize: 11 }} tickLine={false} axisLine={{ stroke: COLOURS.grid }} tickFormatter={(v) => fmtMoney(v * 100, currency)} />
        <Tooltip formatter={(v) => fmtMoney(Number(v) * 100, currency)} contentStyle={{ fontSize: 12, borderRadius: 6, border: '1px solid #E6E6E2' }} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Area type="monotone" dataKey="confirmed" stroke={COLOURS.confirmed} fill="url(#g-conf)" name="Confirmed" strokeWidth={2} />
        <Area type="monotone" dataKey="pending"   stroke={COLOURS.pending}   fill="url(#g-pend)" name="Pending"   strokeWidth={2} />
        <Line type="monotone" dataKey="reversed"  stroke={COLOURS.reversed} name="Reversed" strokeWidth={1.5} dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function StatusMixChart({
  data,
  currency,
}: {
  data: Array<{ bucket: string; confirmed_minor: number; pending_minor: number; reversed_minor: number }>;
  currency: string;
}) {
  const rows = data.map((d) => ({
    month: d.bucket,
    confirmed: d.confirmed_minor / 100,
    pending: d.pending_minor / 100,
    reversed: Math.abs(d.reversed_minor) / 100,
  }));
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={rows} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={COLOURS.grid} />
        <XAxis dataKey="month" tick={{ fill: COLOURS.axis, fontSize: 11 }} tickLine={false} axisLine={{ stroke: COLOURS.grid }} />
        <YAxis tick={{ fill: COLOURS.axis, fontSize: 11 }} tickLine={false} axisLine={{ stroke: COLOURS.grid }} tickFormatter={(v) => fmtMoney(v * 100, currency)} />
        <Tooltip formatter={(v) => fmtMoney(Number(v) * 100, currency)} contentStyle={{ fontSize: 12, borderRadius: 6, border: '1px solid #E6E6E2' }} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="confirmed" stackId="a" fill={COLOURS.confirmed} name="Confirmed" />
        <Bar dataKey="pending"   stackId="a" fill={COLOURS.pending}   name="Pending" />
        <Bar dataKey="reversed"  stackId="b" fill={COLOURS.reversed}  name="Reversed" />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function BreakdownBarChart({
  rows,
  currency,
}: {
  rows: Array<{ label: string; confirmed_minor: number; pending_minor: number }>;
  currency: string;
}) {
  const data = rows.map((r) => ({
    label: r.label,
    confirmed: r.confirmed_minor / 100,
    pending: r.pending_minor / 100,
  }));
  return (
    <ResponsiveContainer width="100%" height={32 + rows.length * 36}>
      <BarChart data={data} layout="vertical" margin={{ top: 8, right: 16, left: 60, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={COLOURS.grid} horizontal={false} />
        <XAxis type="number" tick={{ fill: COLOURS.axis, fontSize: 11 }} tickFormatter={(v) => fmtMoney(v * 100, currency)} axisLine={{ stroke: COLOURS.grid }} />
        <YAxis type="category" dataKey="label" tick={{ fill: COLOURS.axis, fontSize: 11 }} width={100} axisLine={{ stroke: COLOURS.grid }} />
        <Tooltip formatter={(v) => fmtMoney(Number(v) * 100, currency)} contentStyle={{ fontSize: 12, borderRadius: 6, border: '1px solid #E6E6E2' }} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="confirmed" stackId="a" fill={COLOURS.confirmed} name="Confirmed" />
        <Bar dataKey="pending"   stackId="a" fill={COLOURS.pending}   name="Pending" />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function RpkuChart({
  data,
  currency,
}: {
  data: Array<{ bucket: string; users: number; rpku_minor: number }>;
  currency: string;
}) {
  const rows = data.map((d) => ({
    month: d.bucket,
    rpku: d.rpku_minor / 100,
    users: d.users,
  }));
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={rows} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={COLOURS.grid} />
        <XAxis dataKey="month" tick={{ fill: COLOURS.axis, fontSize: 11 }} tickLine={false} axisLine={{ stroke: COLOURS.grid }} />
        <YAxis tick={{ fill: COLOURS.axis, fontSize: 11 }} tickLine={false} axisLine={{ stroke: COLOURS.grid }} tickFormatter={(v) => fmtMoney(v * 100, currency)} />
        <Tooltip
          formatter={(v, name) => (name === 'rpku' ? fmtMoney(Number(v) * 100, currency) : Number(v).toLocaleString())}
          contentStyle={{ fontSize: 12, borderRadius: 6, border: '1px solid #E6E6E2' }}
          labelFormatter={(l) => `${l}`}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Line type="monotone" dataKey="rpku" stroke={COLOURS.accent} name={`Revenue per 1k users (${currency})`} strokeWidth={2} dot={{ r: 3 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}
