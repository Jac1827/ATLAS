"use client";

import React, { startTransition, useMemo, useState } from "react";
import Papa from "papaparse";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Row = {
  gl: string;
  name: string;
  section: string;
  yAct: number;
  yBud: number;
  annBud: number;
};

type Summary = {
  revenue: number;
  revenueBudget: number;
  expense: number;
  expenseBudget: number;
};

type ChartRow = {
  section: string;
  actual: number;
  budget: number;
};

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const GL_CODE_PATTERN = /^\d{4,}$/;

function money(value: number) {
  return currencyFormatter.format(value || 0);
}

function normalizeCell(value: unknown) {
  return String(value ?? "").trim();
}

function parseAmount(value: unknown) {
  const raw = normalizeCell(value);

  if (!raw) {
    return 0;
  }

  const withoutCurrency = raw.replace(/[$,]/g, "");
  const negative = /^\((.*)\)$/.exec(withoutCurrency);
  const candidate = negative ? `-${negative[1]}` : withoutCurrency;
  const numeric = Number(candidate);

  return Number.isFinite(numeric) ? numeric : 0;
}

function isIncomeSection(section: string) {
  return /income|revenue/i.test(section);
}

function parseCSV(text: string): Row[] {
  const parsed = Papa.parse<string[]>(text, { skipEmptyLines: "greedy" });
  const rows: Row[] = [];
  let section = "";

  for (const rawRow of parsed.data) {
    const row = rawRow.map(normalizeCell);
    const gl = row[0] ?? "";
    const name = row[1] ?? "";

    if (!gl && name) {
      continue;
    }

    if (gl && !name && !GL_CODE_PATTERN.test(gl)) {
      section = gl;
      continue;
    }

    if (!GL_CODE_PATTERN.test(gl)) {
      continue;
    }

    rows.push({
      gl,
      name,
      section: section || "Uncategorized",
      yAct: parseAmount(row[6]),
      yBud: parseAmount(row[7]),
      annBud: parseAmount(row[10]),
    });
  }

  return rows;
}

function summarizeRows(rows: Row[]): Summary {
  return rows.reduce<Summary>(
    (summary, row) => {
      if (isIncomeSection(row.section)) {
        summary.revenue += row.yAct;
        summary.revenueBudget += row.yBud;
        return summary;
      }

      summary.expense += row.yAct;
      summary.expenseBudget += row.yBud;
      return summary;
    },
    {
      revenue: 0,
      revenueBudget: 0,
      expense: 0,
      expenseBudget: 0,
    },
  );
}

function buildChartData(rows: Row[]): ChartRow[] {
  const grouped = new Map<string, ChartRow>();

  for (const row of rows) {
    const section = row.section || "Uncategorized";
    const current = grouped.get(section) ?? { section, actual: 0, budget: 0 };

    current.actual += row.yAct;
    current.budget += row.yBud;
    grouped.set(section, current);
  }

  return Array.from(grouped.values());
}

export default function BudgetDashboard() {
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);

  const handleUpload = async (file?: File | null) => {
    if (!file) {
      return;
    }

    const text = await file.text();
    const parsed = parseCSV(text);

    startTransition(() => {
      setRows(parsed);
      setError(parsed.length ? null : "No GL rows were found in the uploaded CSV.");
    });
  };

  const summary = useMemo(() => summarizeRows(rows), [rows]);
  const chartData = useMemo(() => buildChartData(rows), [rows]);
  const variance = summary.revenue - summary.expense;

  return (
    <div style={{ padding: 20 }}>
      <h1>Budget Accountability Dashboard</h1>

      <input
        accept=".csv,text/csv"
        type="file"
        onChange={(event) => handleUpload(event.target.files?.[0])}
      />

      {error ? <p>{error}</p> : null}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 20, marginTop: 20 }}>
        <div>Revenue: {money(summary.revenue)}</div>
        <div>Revenue Budget: {money(summary.revenueBudget)}</div>
        <div>Expenses: {money(summary.expense)}</div>
        <div>Expense Budget: {money(summary.expenseBudget)}</div>
        <div>NOI: {money(variance)}</div>
      </div>

      <div style={{ height: 320, marginTop: 30 }}>
        {chartData.length ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="section" tickLine={false} axisLine={false} />
              <YAxis tickFormatter={money} />
              <Tooltip formatter={(value: number) => money(value)} />
              <Legend />
              <Bar dataKey="actual" fill="#1d4ed8" name="Actual" />
              <Bar dataKey="budget" fill="#60a5fa" name="Budget" />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <p>Upload a CSV to see section totals.</p>
        )}
      </div>
    </div>
  );
}
