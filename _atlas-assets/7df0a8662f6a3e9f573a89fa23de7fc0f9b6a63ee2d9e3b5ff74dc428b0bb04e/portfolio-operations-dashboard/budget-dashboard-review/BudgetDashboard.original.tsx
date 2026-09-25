"use client";

import React, { useState, useMemo } from "react";
import Papa from "papaparse";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

type Row = {
  gl: string;
  name: string;
  section: string;
  yAct: number;
  yBud: number;
  annBud: number;
};

function money(v: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(v || 0);
}

function parseCSV(text: string): Row[] {
  const parsed = Papa.parse<any[]>(text, { skipEmptyLines: true });
  const rows: Row[] = [];

  let section = "";

  parsed.data.forEach((r) => {
    if (!r[0] && r[1]) return;

    if (r[0] && !r[1] && isNaN(Number(r[0]))) {
      section = r[0];
      return;
    }

    if (/^\d{4}/.test(r[0])) {
      rows.push({
        gl: r[0],
        name: r[1],
        section,
        yAct: Number(r[6]) || 0,
        yBud: Number(r[7]) || 0,
        annBud: Number(r[10]) || 0,
      });
    }
  });

  return rows;
}

export default function BudgetDashboard() {
  const [rows, setRows] = useState<Row[]>([]);

  const handleUpload = async (file: File) => {
    const text = await file.text();
    const parsed = parseCSV(text);
    setRows(parsed);
  };

  const summary = useMemo(() => {
    const income = rows.filter((r) => r.section.includes("Income"));
    const expense = rows.filter((r) => !r.section.includes("Income"));

    const sum = (arr: Row[], key: keyof Row) =>
      arr.reduce((s, r) => s + (r[key] as number), 0);

    return {
      revenue: sum(income, "yAct"),
      revenueBudget: sum(income, "yBud"),
      expense: sum(expense, "yAct"),
      expenseBudget: sum(expense, "yBud"),
    };
  }, [rows]);

  const chartData = useMemo(() => {
    const grouped: any = {};

    rows.forEach((r) => {
      if (!grouped[r.section]) {
        grouped[r.section] = { section: r.section, actual: 0, budget: 0 };
      }
      grouped[r.section].actual += r.yAct;
      grouped[r.section].budget += r.yBud;
    });

    return Object.values(grouped);
  }, [rows]);

  return (
    <div style={{ padding: 20 }}>
      <h1>Budget Accountability Dashboard</h1>

      <input type="file" onChange={(e) => handleUpload(e.target.files![0])} />

      <div style={{ display: "flex", gap: 20, marginTop: 20 }}>
        <div>Revenue: {money(summary.revenue)}</div>
        <div>Expenses: {money(summary.expense)}</div>
        <div>NOI: {money(summary.revenue - summary.expense)}</div>
      </div>

      <div style={{ height: 300, marginTop: 30 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData}>
            <XAxis dataKey="section" />
            <YAxis />
            <Tooltip />
            <Bar dataKey="actual" />
            <Bar dataKey="budget" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
