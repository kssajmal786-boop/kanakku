// ============================================================
// Financial Health Score Engine
// ============================================================
// Produces a transparent, explainable score from 0–100.
// Methodology is fully documented. Nothing is arbitrary.
//
// Scoring Factors:
//   1. Income vs Expenses ratio       (max 30 pts)
//   2. Spending consistency           (max 20 pts)
//   3. Unusual transactions           (max 15 pts)
//   4. Expense growth trend           (max 15 pts)
//   5. Cash flow streak               (max 10 pts)
//   6. Spending vs historical average (max 10 pts)
//
// Requires at least 7 days of data for a meaningful score.
// ============================================================

import { getPeriodSummary, getAverageDailyExpense } from './transactionStore.js';

// ─── Score calculation ─────────────────────────────────────────

/**
 * Calculate the financial health score.
 *
 * @param {string} [referenceDate] YYYY-MM-DD (defaults to today)
 * @returns {HealthScoreResult}
 */
export async function calculateHealthScore(referenceDate) {
  const today = referenceDate || new Date().toISOString().substring(0, 10);
  const todayDate = new Date(today);

  // Last 30 days
  const d30Start = new Date(todayDate);
  d30Start.setDate(d30Start.getDate() - 29);
  const d30Str = d30Start.toISOString().substring(0, 10);

  // Last 7 days
  const d7Start = new Date(todayDate);
  d7Start.setDate(d7Start.getDate() - 6);
  const d7Str = d7Start.toISOString().substring(0, 10);

  // Previous 30 days (for trend comparison)
  const prev30End = new Date(d30Start);
  prev30End.setDate(prev30End.getDate() - 1);
  const prev30Start = new Date(prev30End);
  prev30Start.setDate(prev30Start.getDate() - 29);

  const [period30, period7, prevPeriod30] = await Promise.all([
    getPeriodSummary(d30Str, today, 'Last 30 days'),
    getPeriodSummary(d7Str, today, 'Last 7 days'),
    getPeriodSummary(
      prev30Start.toISOString().substring(0, 10),
      prev30End.toISOString().substring(0, 10),
      'Previous 30 days'
    ),
  ]);

  const avgDaily30 = await getAverageDailyExpense(30);

  const hasEnoughData = period30.transactionCount >= 3;

  if (!hasEnoughData) {
    return {
      score: null,
      status: 'insufficient_data',
      message: 'Building your financial baseline... Add more transactions or sync Gmail to get your score.',
      factors: [],
      period: '30 days',
      calculatedAt: new Date().toISOString(),
    };
  }

  const factors = [];
  let totalScore = 0;

  // ── Factor 1: Income vs Expenses (30 pts max) ─────────────────
  {
    const ratio = period30.totalExpenses > 0
      ? period30.totalIncome / period30.totalExpenses
      : period30.totalIncome > 0 ? 2 : 0;

    let pts, status, detail;
    if (ratio >= 1.5) {
      pts = 30; status = 'good';
      detail = `Income is ${formatRatio(ratio)}× your expenses — strong surplus`;
    } else if (ratio >= 1.1) {
      pts = 22; status = 'good';
      detail = `Income exceeded expenses by ${pct(ratio - 1)} — positive cash flow`;
    } else if (ratio >= 0.9) {
      pts = 14; status = 'warning';
      detail = 'Income and expenses are roughly balanced';
    } else if (ratio >= 0.7) {
      pts = 6; status = 'warning';
      detail = `Expenses exceeded income by ${pct(1 - ratio)} over the last 30 days`;
    } else {
      pts = 0; status = 'bad';
      detail = 'Expenses significantly exceeded income over the last 30 days';
    }
    totalScore += pts;
    factors.push({ id: 'income_vs_expense', label: 'Income vs Expenses', status, detail, points: pts, maxPoints: 30 });
  }

  // ── Factor 2: Spending consistency (20 pts max) ───────────────
  {
    const dailyAmounts = period30.dailyTrend
      .filter((d) => d.expense > 0)
      .map((d) => d.expense);

    let pts, status, detail;
    if (dailyAmounts.length < 5) {
      pts = 10; status = 'warning';
      detail = 'Not enough spending days to assess consistency';
    } else {
      const mean = dailyAmounts.reduce((a, b) => a + b, 0) / dailyAmounts.length;
      const variance = dailyAmounts.reduce((sum, x) => sum + (x - mean) ** 2, 0) / dailyAmounts.length;
      const cv = mean > 0 ? Math.sqrt(variance) / mean : 0; // Coefficient of variation

      if (cv < 0.3) {
        pts = 20; status = 'good';
        detail = 'Very consistent spending pattern — easy to predict and budget';
      } else if (cv < 0.6) {
        pts = 14; status = 'good';
        detail = 'Reasonably consistent spending pattern';
      } else if (cv < 1.0) {
        pts = 8; status = 'warning';
        detail = 'Spending varies significantly day to day';
      } else {
        pts = 3; status = 'bad';
        detail = 'Highly irregular spending pattern — difficult to budget';
      }
    }
    totalScore += pts;
    factors.push({ id: 'consistency', label: 'Spending Consistency', status, detail, points: pts, maxPoints: 20 });
  }

  // ── Factor 3: Unusual large transactions (15 pts max) ─────────
  {
    const expenses30 = period30.dailyTrend.map((d) => d.expense).filter((a) => a > 0);
    const mean = expenses30.length
      ? expenses30.reduce((a, b) => a + b, 0) / expenses30.length
      : 0;
    const unusualThreshold = mean * 3; // 3× average daily spend
    const unusualDays = expenses30.filter((a) => a > unusualThreshold && unusualThreshold > 0);

    let pts, status, detail;
    if (unusualDays.length === 0) {
      pts = 15; status = 'good';
      detail = 'No unusually large expense days detected';
    } else if (unusualDays.length === 1) {
      pts = 10; status = 'warning';
      detail = `1 day with unusually high spending (3× your average)`;
    } else {
      pts = Math.max(0, 15 - unusualDays.length * 4);
      status = unusualDays.length > 2 ? 'bad' : 'warning';
      detail = `${unusualDays.length} days with unusually high spending`;
    }
    totalScore += pts;
    factors.push({ id: 'unusual_transactions', label: 'Large Unusual Expenses', status, detail, points: pts, maxPoints: 15 });
  }

  // ── Factor 4: Expense growth trend (15 pts max) ───────────────
  {
    const currentExp = period30.totalExpenses;
    const prevExp = prevPeriod30.totalExpenses;

    let pts, status, detail;
    if (prevExp === 0) {
      pts = 10; status = 'warning';
      detail = 'Not enough history to assess spending trend';
    } else {
      const growthRate = (currentExp - prevExp) / prevExp;
      if (growthRate <= -0.1) {
        pts = 15; status = 'good';
        detail = `Spending decreased ${pct(-growthRate)} compared to previous period`;
      } else if (growthRate <= 0.05) {
        pts = 12; status = 'good';
        detail = 'Spending is stable compared to previous period';
      } else if (growthRate <= 0.2) {
        pts = 8; status = 'warning';
        detail = `Spending increased ${pct(growthRate)} vs previous 30 days`;
      } else if (growthRate <= 0.4) {
        pts = 4; status = 'warning';
        detail = `Spending increased ${pct(growthRate)} vs previous 30 days — notable rise`;
      } else {
        pts = 0; status = 'bad';
        detail = `Spending increased ${pct(growthRate)} vs previous 30 days — significant increase`;
      }
    }
    totalScore += pts;
    factors.push({ id: 'expense_trend', label: 'Spending Trend', status, detail, points: pts, maxPoints: 15 });
  }

  // ── Factor 5: Positive cash flow streak (10 pts max) ──────────
  {
    const dailyNets = period7.dailyTrend.map((d) => d.net);
    const positiveDays = dailyNets.filter((n) => n >= 0).length;
    const totalDays = dailyNets.length;

    let pts, status, detail;
    if (totalDays === 0) {
      pts = 5; status = 'warning'; detail = 'No data for last 7 days';
    } else {
      const ratio = positiveDays / totalDays;
      if (ratio >= 0.85) {
        pts = 10; status = 'good';
        detail = `${positiveDays} of ${totalDays} days had positive cash flow this week`;
      } else if (ratio >= 0.6) {
        pts = 7; status = 'good';
        detail = `${positiveDays} of ${totalDays} days had positive cash flow this week`;
      } else if (ratio >= 0.4) {
        pts = 4; status = 'warning';
        detail = `Only ${positiveDays} of ${totalDays} days had positive cash flow this week`;
      } else {
        pts = 1; status = 'bad';
        detail = `Most days this week had more expenses than income`;
      }
    }
    totalScore += pts;
    factors.push({ id: 'cashflow_streak', label: 'Cash Flow (Last 7 Days)', status, detail, points: pts, maxPoints: 10 });
  }

  // ── Factor 6: Today vs historical average (10 pts max) ────────
  {
    const todaySummary = period7.dailyTrend.find((d) => d.date === today);
    const todayExpense = todaySummary?.expense || 0;

    let pts, status, detail;
    if (avgDaily30 === 0 || todayExpense === 0) {
      pts = 8; status = 'good';
      detail = 'No spending data to compare';
    } else {
      const delta = todayExpense / avgDaily30;
      if (delta <= 0.8) {
        pts = 10; status = 'good';
        detail = `Today's spending is ${pct(1 - delta)} below your 30-day average`;
      } else if (delta <= 1.1) {
        pts = 8; status = 'good';
        detail = "Today's spending is close to your usual daily average";
      } else if (delta <= 1.4) {
        pts = 5; status = 'warning';
        detail = `Today's spending is ${pct(delta - 1)} above your 30-day average`;
      } else {
        pts = 2; status = 'warning';
        detail = `Today's spending is ${pct(delta - 1)} above your 30-day average`;
      }
    }
    totalScore += pts;
    factors.push({ id: 'vs_average', label: 'Today vs Your Average', status, detail, points: pts, maxPoints: 10 });
  }

  // ── Final score ────────────────────────────────────────────────
  const score = Math.min(100, Math.max(0, Math.round(totalScore)));
  const status = score >= 80 ? 'excellent' : score >= 65 ? 'good' : score >= 50 ? 'fair' : score >= 35 ? 'needs_attention' : 'poor';

  const statusLabels = {
    excellent: 'Excellent',
    good: 'Good',
    fair: 'Fair',
    needs_attention: 'Needs Attention',
    poor: 'Review Spending',
  };

  return {
    score,
    status,
    statusLabel: statusLabels[status],
    factors,
    period: '30 days',
    dataPoints: period30.transactionCount,
    calculatedAt: new Date().toISOString(),
  };
}

// ─── Helpers ───────────────────────────────────────────────────

function pct(ratio) {
  return `${Math.round(Math.abs(ratio) * 100)}%`;
}

function formatRatio(r) {
  return r.toFixed(1);
}
