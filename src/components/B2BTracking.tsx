"use client";

import { useEffect, useState } from "react";

interface B2BMetrics {
  ad_spend: number;
  intros_booked: number;
  intros_shown: number;
  sales_calls_booked: number;
  sales_calls_shown: number;
  closes: number;
  cash_collected: number;
  intro_show_rate: number;
  cost_per_intro: number;
  cost_per_close: number;
}

interface Props {
  startDate: string;
  endDate: string;
}

function fmt(n: number, prefix = "", decimals = 0) {
  if (n === 0) return `${prefix}0`;
  return `${prefix}${n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}

function pct(n: number) {
  return `${(n * 100).toFixed(1)}%`;
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-5 flex flex-col gap-1">
      <span className="text-xs font-medium text-[var(--muted)] uppercase tracking-wide">{label}</span>
      <span className="text-3xl font-bold text-[var(--foreground)]">{value}</span>
      {sub && <span className="text-xs text-[var(--muted)]">{sub}</span>}
    </div>
  );
}

export default function B2BTracking({ startDate, endDate }: Props) {
  const [data, setData] = useState<B2BMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/b2b-metrics?start_date=${startDate}&end_date=${endDate}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) throw new Error(d.error);
        setData(d);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [startDate, endDate]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 text-[var(--muted)]">
        Loading B2B metrics…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-48 text-red-500 text-sm">
        {error}
      </div>
    );
  }

  if (!data) return null;

  const introsShowRate = data.intros_booked > 0
    ? data.intros_shown / data.intros_booked
    : 0;
  const salesShowRate = data.sales_calls_booked > 0
    ? data.sales_calls_shown / data.sales_calls_booked
    : 0;
  const closeRate = data.sales_calls_shown > 0
    ? data.closes / data.sales_calls_shown
    : 0;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-[var(--foreground)]">B2B Tracking</h2>
        <p className="text-sm text-[var(--muted)] mt-0.5">
          {startDate} — {endDate}
        </p>
      </div>

      {/* Pipeline funnel */}
      <section>
        <h3 className="text-sm font-semibold text-[var(--muted)] uppercase tracking-wide mb-3">
          Pipeline
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          <StatCard
            label="Intros Booked"
            value={fmt(data.intros_booked)}
          />
          <StatCard
            label="Intros Shown"
            value={fmt(data.intros_shown)}
            sub={`${pct(introsShowRate)} show rate`}
          />
          <StatCard
            label="Sales Calls Booked"
            value={fmt(data.sales_calls_booked)}
          />
          <StatCard
            label="Sales Calls Shown"
            value={fmt(data.sales_calls_shown)}
            sub={`${pct(salesShowRate)} show rate`}
          />
          <StatCard
            label="Closes"
            value={fmt(data.closes)}
            sub={`${pct(closeRate)} close rate`}
          />
          <StatCard
            label="Cash Collected"
            value={fmt(data.cash_collected, "$")}
          />
        </div>
      </section>

      {/* Ad spend + efficiency */}
      <section>
        <h3 className="text-sm font-semibold text-[var(--muted)] uppercase tracking-wide mb-3">
          Spend &amp; Efficiency
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <StatCard
            label="Ad Spend"
            value={fmt(data.ad_spend, "$")}
          />
          <StatCard
            label="Cost per Intro"
            value={data.intros_booked > 0 ? fmt(data.cost_per_intro, "$", 2) : "—"}
          />
          <StatCard
            label="Cost per Close"
            value={data.closes > 0 ? fmt(data.cost_per_close, "$", 2) : "—"}
          />
        </div>
      </section>
    </div>
  );
}
