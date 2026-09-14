// ============================================================
// Reports Service — REAL local data (replaces reports.mock.js)
// ============================================================
// Maps the UI's report-tab vocabulary (daily/monthly/6month/annual/
// custom) onto deterministic date ranges, then delegates all
// arithmetic to transactionStore.getPeriodSummary. No numbers are
// computed here beyond simple date-range math.
// ============================================================

import { getPeriodSummary, getDailySummary } from './transactionStore.js';
import { getDB } from './db.js';

function toRupees(paise) {
  return Math.round(paise) / 100;
}

function isoDaysAgo(n, from = new Date()) {
  const d = new Date(from);
  d.setDate(d.getDate() - n);
  return d.toISOString().substring(0, 10);
}

function startOfMonth(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().substring(0, 10);
}

function startOfYear(d = new Date()) {
  return new Date(d.getFullYear(), 0, 1).toISOString().substring(0, 10);
}

/**
 * @param {'daily'|'monthly'|'6month'|'annual'|'custom'} type
 * @param {{from?: string, to?: string}} [customRange] required when type === 'custom'
 */
export async function getReport(type, customRange = {}) {
  const today = new Date().toISOString().substring(0, 10);

  let startDate, endDate, label, trendGranularity;

  switch (type) {
    case 'daily': {
      const daily = await getDailySummary(today);
      return shapeReport({
        label: 'Today',
        startDate: today,
        endDate: today,
        totalIncome: toRupees(daily.totalIncome),
        totalExpense: toRupees(daily.totalExpenses),
        netFlow: toRupees(daily.netCashFlow),
        topCategories: daily.topCategories.map((c) => ({ name: c.name, amount: toRupees(c.amount) })),
        trendData: await sevenDayTrend(today),
      });
    }
    case 'monthly':
      startDate = startOfMonth();
      endDate = today;
      label = 'This month';
      trendGranularity = 'day';
      break;
    case '6month':
      startDate = isoDaysAgo(182);
      endDate = today;
      label = 'Last 6 months';
      trendGranularity = 'month';
      break;
    case 'annual':
      startDate = startOfYear();
      endDate = today;
      label = 'This year';
      trendGranularity = 'month';
      break;
    case 'custom':
      if (!customRange.from || !customRange.to) {
        throw new Error('Custom report requires a from/to date');
      }
      startDate = customRange.from;
      endDate = customRange.to;
      label = `${customRange.from} to ${customRange.to}`;
      trendGranularity = 'day';
      break;
    default:
      throw new Error(`Unknown report type: ${type}`);
  }

  const period = await getPeriodSummary(startDate, endDate, label);

  const trendData = trendGranularity === 'month'
    ? bucketByMonth(period.dailyTrend)
    : period.dailyTrend.map((d) => ({
        label: new Date(d.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
        income: toRupees(d.income),
        expense: toRupees(d.expense),
      }));

  return shapeReport({
    label,
    startDate,
    endDate,
    totalIncome: toRupees(period.totalIncome),
    totalExpense: toRupees(period.totalExpenses),
    netFlow: toRupees(period.netCashFlow),
    topCategories: period.topCategories.map((c) => ({ name: c.name, amount: toRupees(c.amount) })),
    trendData,
    largestExpense: period.largestExpense,
    largestIncome:  period.largestIncome,
    paymentMethods: period.paymentMethods,
    transactionCount: period.transactionCount,
    avgDailyExpense: toRupees(period.avgDailyExpense),
  });
}

async function sevenDayTrend(today) {
  const period = await getPeriodSummary(isoDaysAgo(6, new Date(today)), today, 'Last 7 days');
  return period.dailyTrend.map((d) => ({
    label: new Date(d.date).toLocaleDateString('en-IN', { weekday: 'short' }),
    income: toRupees(d.income),
    expense: toRupees(d.expense),
  }));
}

function bucketByMonth(dailyTrend) {
  const months = new Map();
  for (const d of dailyTrend) {
    const dt = new Date(d.date);
    const key = `${dt.getFullYear()}-${dt.getMonth()}`;
    if (!months.has(key)) {
      months.set(key, { label: dt.toLocaleDateString('en-IN', { month: 'short' }), income: 0, expense: 0 });
    }
    const bucket = months.get(key);
    bucket.income += d.income;
    bucket.expense += d.expense;
  }
  return [...months.values()].map((b) => ({
    label: b.label,
    income: toRupees(b.income),
    expense: toRupees(b.expense),
  }));
}

function shapeReport({ label, startDate, endDate, totalIncome, totalExpense, netFlow,
  topCategories, trendData, largestExpense, largestIncome, paymentMethods,
  transactionCount, avgDailyExpense }) {
  return {
    label,
    startDate: startDate || null,
    endDate:   endDate   || null,
    totalIncome,
    totalExpense,
    netFlow,
    topCategories: topCategories.length ? topCategories : [{ name: 'other', amount: 0 }],
    trendData: trendData.length ? trendData : [{ label: 'No data', income: 0, expense: 0 }],
    largestExpense:   largestExpense   || null,
    largestIncome:    largestIncome    || null,
    paymentMethods:   paymentMethods   || [],
    transactionCount: transactionCount || 0,
    avgDailyExpense:  avgDailyExpense  || 0,
  };
}

// ============================================================
// Statements — list of previously generated income statements
// ============================================================
// PDF generation itself (Phase 10/14) isn't wired yet — this reads
// whatever has been saved to the `statements` Dexie store so far.
// Until statement generation exists, this correctly returns an
// empty list (shown as the "no statements yet" empty state), rather
// than fabricating fake entries.
// ============================================================

export async function getStatements() {
  const db = getDB();
  const rows = await db.statements.orderBy('generatedAt').reverse().toArray();
  return rows.map((s) => ({
    id: String(s.id),
    date: s.generatedAt,
    label: s.label || `${s.type} statement`,
    type: s.type,
    startDate: s.startDate,
    endDate: s.endDate,
  }));
}
