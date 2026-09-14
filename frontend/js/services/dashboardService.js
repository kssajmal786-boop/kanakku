// ============================================================
// Dashboard Service — REAL local data (replaces dashboard.mock.js)
// ============================================================
// Composes today's summary, the 7-day trend, category breakdown,
// health score, and recent transactions from IndexedDB. Nothing
// here is invented — every number traces back to transactionStore.
// ============================================================

import { getDailySummary, getPeriodSummary, getRecentTransactions } from './transactionStore.js';
import { calculateHealthScore } from './healthScore.js';

const ICONS = {
  food: '🍔', transport: '🚗', shopping: '🛍️', health: '💊',
  bills: '📱', grocery: '🛒', income: '💼', atm: '🏧',
  transfer: '🔄', other: '💰',
};

/** Amounts are stored in paise; UI displays rupees. */
function toRupees(paise) {
  return Math.round(paise) / 100;
}

export async function getDashboardData() {
  const today = new Date().toISOString().substring(0, 10);

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
  const sevenDaysAgoStr = sevenDaysAgo.toISOString().substring(0, 10);

  const [daily, week, score, recent] = await Promise.all([
    getDailySummary(today),
    getPeriodSummary(sevenDaysAgoStr, today, 'Last 7 days'),
    calculateHealthScore(today),
    getRecentTransactions(6),
  ]);

  const spendingTrend = week.dailyTrend.map((d) => ({
    day: new Date(d.date).toLocaleDateString('en-IN', { weekday: 'short' }),
    amount: toRupees(d.expense),
  }));

  const spendingByCategory = daily.topCategories.map((c) => ({
    name: c.name,
    amount: toRupees(c.amount),
    percentage: c.percentage,
  }));

  const recentTransactions = recent.map(mapTxnForUI);

  return {
    todayIncome: toRupees(daily.totalIncome),
    todayExpense: toRupees(daily.totalExpenses),
    netCashFlow: toRupees(daily.netCashFlow),
    financialScore: score.score ?? 0,
    scoreChange: 0, // requires a second historical score sample — see note below
    healthFactors: score.factors || [], // real, from healthScore.js — powers the Alerts panel
    weekTransactionCount: week.transactionCount,
    weekAvgDailyExpense: toRupees(week.avgDailyExpense),
    todayTransactionCount: daily.transactionCount,
    topCategoryToday: daily.topCategories[0]?.name || null,
    dailyInsight: buildDailyInsight(daily, score),
    spendingTrend,
    spendingByCategory,
    recentTransactions,
  };
}

/**
 * NOTE on scoreChange: showing "vs last week" requires storing a
 * historical score snapshot (the health score is calculated fresh
 * every time, it isn't persisted). Left at 0 for now rather than
 * inventing a number — wire this up once statements/score history
 * is persisted to the `statements` or a new `scoreHistory` Dexie store.
 */

function buildDailyInsight(daily, score) {
  const en = daily.transactionCount === 0
    ? 'No transactions recorded yet today.'
    : score.factors?.length
      ? score.factors[0].detail
      : `You've recorded ${daily.transactionCount} transaction${daily.transactionCount !== 1 ? 's' : ''} today.`;

  const ta = daily.transactionCount === 0
    ? 'இன்று இதுவரை எந்த பரிவர்த்தனையும் பதிவு செய்யப்படவில்லை.'
    : `இன்று நீங்கள் ${daily.transactionCount} பரிவர்த்தனைகளை பதிவு செய்துள்ளீர்கள்.`;

  return { en, ta };
}

function mapTxnForUI(t) {
  return {
    id: t.id,
    category: t.category,
    icon: ICONS[t.category] || '💰',
    merchant: t.merchant || t.description || 'Transaction',
    date: t.date,
    amount: toRupees(t.amount),
    type: t.type,
    paymentMethod: t.paymentMethod,
    source: t.source,
  };
}

export function refreshDashboard() {
  window.dispatchEvent(new CustomEvent('cashflow:transactions-updated'));
}

export { mapTxnForUI, ICONS, toRupees };
