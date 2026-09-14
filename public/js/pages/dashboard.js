// ============================================================
// Dashboard Page — Command Console
// ============================================================

import { t, getLang } from '../i18n.js';
import { getState } from '../store.js';
import { getDashboardData } from '../services/dashboardService.js';
import { formatCurrency } from '../services/currency.js';
import { navigate } from '../router.js';

export async function renderDashboard(container) {
  container.innerHTML = skeletonHTML();

  let data;
  try {
    data = await getDashboardData();
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚠️</div><p data-i18n="errors.network">Could not load dashboard data.</p></div>`;
    return;
  }

  try {
    const lang = getLang();
    const greeting = getGreeting();
    const insight  = data?.dailyInsight?.[lang] || data?.dailyInsight?.en || 'Keep tracking your expenses to build insights.';

  container.innerHTML = `
    <!-- Greeting -->
    <div class="section animate-fade-in-up">
      <div class="flex flex-between items-center">
        <div>
          <p class="text-sm text-muted">${greeting},</p>
          <h1 class="text-xl font-bold" id="dash-user-name">—</h1>
        </div>
        <button class="btn btn-icon btn-secondary" id="btn-notif" aria-label="View alerts" onclick="document.getElementById('console-alerts')?.scrollIntoView({behavior:'smooth'})">
          ${iconBell()}
        </button>
      </div>
    </div>

    <!-- Stat Grid -->
    <div class="section console-stat-grid animate-fade-in-up delay-1">
      ${statCard({
        eyebrow: t('dashboard.todayIncome'),
        icon: '💰', iconBg: 'rgba(14,124,123,0.10)',
        value: formatCurrency(data.todayIncome, { sign: '+' }),
        valueClass: 'text-income',
        sub: `${data.todayTransactionCount} txn${data.todayTransactionCount !== 1 ? 's' : ''} today`,
        dotColor: 'var(--color-flow)',
      })}
      ${statCard({
        eyebrow: t('dashboard.todayExpense'),
        icon: '💸', iconBg: 'rgba(220,38,38,0.10)',
        value: formatCurrency(data.todayExpense, { sign: '-' }),
        valueClass: 'text-expense',
        sub: data.topCategoryToday ? `Top: ${t(`transactions.categories.${data.topCategoryToday}`)}` : 'No spend yet',
        dotColor: 'var(--color-danger)',
      })}
      ${statCard({
        eyebrow: t('dashboard.netCashFlow'),
        icon: '⚖️', iconBg: 'rgba(16,21,31,0.06)',
        value: formatCurrency(data.netCashFlow, { sign: 'auto' }),
        valueClass: data.netCashFlow >= 0 ? 'text-income' : 'text-expense',
        sub: data.netCashFlow >= 0 ? 'Positive today' : 'Spending more than earning',
        dotColor: data.netCashFlow >= 0 ? 'var(--color-flow)' : 'var(--color-danger)',
      })}
      ${statCard({
        eyebrow: t('dashboard.financialScore'),
        icon: '🧭', iconBg: 'rgba(67,56,202,0.10)',
        value: `${data.financialScore}<span style="font-size:0.9rem;color:var(--color-text-muted);">/100</span>`,
        valueClass: '',
        sub: scoreLabel(data.financialScore),
        dotColor: 'var(--color-intel)',
      })}
    </div>

    <!-- Main grid: Radar (left) + Climate/Intelligence (right) -->
    <div class="section console-grid-main animate-fade-in-up delay-2">

      <!-- Cash Flow Radar -->
      <div class="console-panel">
        <div class="console-panel-header">
          <span class="console-panel-title">${t('dashboard.spendingTrend')}</span>
          <span class="console-eyebrow">Last 7 days</span>
        </div>
        <div class="chart-container" style="height:180px;position:relative;">
          <canvas id="dash-trend-chart"></canvas>
        </div>
        <div class="radar-footer">
          <div class="radar-footer-item">
            <span class="console-eyebrow">Today In</span>
            <div class="radar-footer-value text-income currency">${formatCurrency(data.todayIncome)}</div>
          </div>
          <div class="radar-footer-item">
            <span class="console-eyebrow">Today Out</span>
            <div class="radar-footer-value text-expense currency">${formatCurrency(data.todayExpense)}</div>
          </div>
          <div class="radar-footer-item">
            <span class="console-eyebrow">Net</span>
            <div class="radar-footer-value currency" style="color:${data.netCashFlow >= 0 ? 'var(--color-flow)' : 'var(--color-danger)'}">${formatCurrency(data.netCashFlow, { sign: 'auto' })}</div>
          </div>
          <div class="radar-footer-item">
            <span class="console-eyebrow">Avg / Day</span>
            <div class="radar-footer-value currency">${formatCurrency(data.weekAvgDailyExpense)}</div>
          </div>
          <div class="radar-footer-item">
            <span class="console-eyebrow">This Week</span>
            <div class="radar-footer-value">${data.weekTransactionCount} txns</div>
          </div>
          <div class="radar-footer-item">
            <span class="console-eyebrow">Top Category</span>
            <div class="radar-footer-value" style="text-transform:capitalize;">${data.topCategoryToday ? t(`transactions.categories.${data.topCategoryToday}`) : '—'}</div>
          </div>
        </div>
      </div>

      <!-- Right column -->
      <div style="display:flex;flex-direction:column;gap:var(--space-3);">

        <!-- Spending Climate -->
        <div class="console-panel">
          <div class="console-panel-header">
            <span class="console-panel-title">${t('dashboard.spendingByCategory')}</span>
          </div>
          ${data.spendingByCategory.length ? data.spendingByCategory.map(cat => `
            <div class="climate-row">
              <div class="climate-row-top">
                <span class="text-xs" style="color:var(--color-text-secondary);text-transform:capitalize;">${t(`transactions.categories.${cat.name}`)}</span>
                <span class="text-xs font-medium currency">${formatCurrency(cat.amount)}</span>
              </div>
              <div class="climate-track">
                <div class="climate-fill" style="width:${cat.percentage}%;background:${catColor(cat.name)};"></div>
              </div>
            </div>
          `).join('') : `<p class="text-xs text-muted">No spending recorded today yet.</p>`}
        </div>

        <!-- Financial Intelligence -->
        <div class="console-panel">
          <div class="console-panel-header">
            <span class="console-panel-title">Financial Intelligence</span>
            <span class="console-eyebrow" style="color:var(--color-intel);">AI</span>
          </div>
          <div class="console-eyebrow">Situation Score</div>
          <div class="intel-score-row">
            <span class="intel-score-num">${data.financialScore}</span>
            <span class="intel-score-max">/ 100</span>
          </div>
          <div class="intel-track">
            <div class="intel-fill" style="width:${data.financialScore}%;"></div>
          </div>
          <p class="intel-note">✨ ${insight}</p>
        </div>

      </div>
    </div>

    <!-- Active Alerts (from real health-score factors) -->
    <div class="section animate-fade-in-up delay-3" id="console-alerts">
      <div class="console-panel">
        <div class="console-panel-header">
          <span class="console-panel-title">Financial Signals</span>
          <span class="console-eyebrow">${data.healthFactors.length} tracked</span>
        </div>
        ${data.healthFactors.length ? data.healthFactors.map(alertRowHTML).join('') : `
          <p class="text-xs text-muted">Keep recording transactions to build up your financial signals.</p>
        `}
      </div>
    </div>

    <!-- Recent Transactions -->
    <div class="section animate-fade-in-up delay-4">
      <div class="section-header">
        <span class="section-title" data-i18n="dashboard.recentTransactions"></span>
        <button class="section-link btn btn-ghost" style="padding:var(--space-1) var(--space-2);" onclick="window.location.hash='/transactions'" data-i18n="dashboard.seeAll"></button>
      </div>
      <div style="display:flex;flex-direction:column;gap:var(--space-1);">
        ${data.recentTransactions.length ? data.recentTransactions.map(txn => transactionItemHTML(txn)).join('') : `
          <div class="empty-state" style="padding:var(--space-6) 0;">
            <div class="empty-state-icon">📭</div>
            <p class="text-sm text-muted">No transactions yet. Add one to get started.</p>
          </div>
        `}
      </div>
    </div>
  `;

  // Load username
  import('../store.js').then(({ getState }) => {
    const user = getState('user');
    const el   = document.getElementById('dash-user-name');
    if (el && user) el.textContent = user.name || 'Friend';
  });

  // Re-apply i18n
  import('../i18n.js').then(({ rerender }) => rerender());

  // Charts
  requestAnimationFrame(() => {
    renderTrendChart(data.spendingTrend);
  });
  } catch (err) {
    console.error('Error rendering dashboard:', err);
    container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚠️</div><p>Something went wrong loading the dashboard. Please try refreshing.</p></div>`;
  }
}

// Auto-refresh dashboard when transactions are modified (e.g. Gmail sync)
if (typeof window !== 'undefined' && !window._dashboardTxnListenerAttached) {
  window._dashboardTxnListenerAttached = true;
  window.addEventListener('cashflow:transactions-updated', () => {
    const mainContent = document.getElementById('main-content');
    const hash = window.location.hash;
    if (mainContent && (!hash || hash === '#' || hash === '#/' || hash === '#/dashboard')) {
      renderDashboard(mainContent).catch(() => {});
    }
  });
}

// ── Template Helpers ─────────────────────────────────────────

function statCard({ eyebrow, icon, iconBg, value, valueClass, sub, dotColor }) {
  return `
    <div class="console-stat-card">
      <div class="console-stat-head">
        <span class="console-eyebrow">${eyebrow}</span>
        <div class="console-stat-icon" style="background:${iconBg};">
          <span style="font-size:0.95rem;">${icon}</span>
        </div>
      </div>
      <div class="console-stat-value currency ${valueClass}">${value}</div>
      <div class="console-stat-sub">
        <span style="width:6px;height:6px;border-radius:50%;background:${dotColor};display:inline-block;"></span>
        ${sub}
      </div>
    </div>
  `;
}

function alertRowHTML(factor) {
  const pillClass = factor.status === 'bad' ? 'critical' : factor.status === 'warning' ? 'warning' : 'good';
  const pillLabel = factor.status === 'bad' ? 'Critical' : factor.status === 'warning' ? 'Watch' : 'On Track';
  const icon = factor.status === 'bad' ? '⚠️' : factor.status === 'warning' ? '⏳' : '✓';
  const iconBg = factor.status === 'bad' ? 'rgba(220,38,38,0.10)' : factor.status === 'warning' ? 'rgba(217,119,6,0.10)' : 'rgba(14,124,123,0.10)';

  return `
    <div class="alert-row">
      <div class="alert-icon" style="background:${iconBg};">${icon}</div>
      <div class="alert-body">
        <div class="alert-title-row">
          <span class="alert-title">${factor.label}</span>
          <span class="status-pill ${pillClass}">${pillLabel}</span>
        </div>
        <div class="alert-detail">${factor.detail}</div>
      </div>
    </div>
  `;
}

function scoreLabel(score) {
  if (score >= 80) return 'Strong';
  if (score >= 60) return 'Stable';
  if (score >= 40) return 'Needs attention';
  return 'Building baseline';
}

function renderTrendChart(trend) {
  const canvas = document.getElementById('dash-trend-chart');
  if (!canvas || !window.Chart) return;

  new Chart(canvas, {
    type: 'bar',
    data: {
      labels: trend.map(d => d.day),
      datasets: [{
        data: trend.map(d => d.amount),
        backgroundColor: 'rgba(14, 124, 123, 0.55)',
        borderColor: 'rgba(14, 124, 123, 1)',
        borderWidth: 0,
        borderRadius: 6,
        borderSkipped: false,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => formatCurrency(ctx.raw, { decimals: 0 }) } } },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#667085', font: { size: 11 } } },
        y: { grid: { color: 'rgba(16,21,31,0.06)' }, ticks: { color: '#667085', font: { size: 11 }, callback: v => formatCurrency(v, { compact: true }) } },
      },
    },
  });
}

function transactionItemHTML(txn) {
  const isIncome = txn.type === 'income';
  const dateStr  = relativeDate(txn.date);
  return `
    <div class="transaction-item ripple-container" data-id="${txn.id}">
      <div class="transaction-icon cat-${txn.category}">${txn.icon}</div>
      <div class="transaction-info">
        <div class="transaction-merchant">${txn.merchant}</div>
        <div class="transaction-meta">
          <span>${dateStr}</span>
          <span>·</span>
          <span>${t(`transactions.paymentMethods.${txn.paymentMethod}`)}</span>
          <span class="badge badge-${txn.source === 'gmail' ? 'info' : txn.source === 'receipt' ? 'warning' : 'neutral'}" style="font-size:9px;padding:1px 6px;">${txn.source}</span>
        </div>
      </div>
      <div class="transaction-amount ${isIncome ? 'amount-positive' : 'amount-negative'}">
        ${formatCurrency(txn.amount, { sign: isIncome ? '+' : '-' })}
      </div>
    </div>
  `;
}

function skeletonHTML() {
  return `
    <div class="section">
      <div class="skeleton" style="height:32px;width:60%;margin-bottom:var(--space-2);"></div>
    </div>
    <div class="section console-stat-grid">
      <div class="skeleton" style="height:100px;border-radius:var(--radius-xl);"></div>
      <div class="skeleton" style="height:100px;border-radius:var(--radius-xl);"></div>
      <div class="skeleton" style="height:100px;border-radius:var(--radius-xl);"></div>
      <div class="skeleton" style="height:100px;border-radius:var(--radius-xl);"></div>
    </div>
    <div class="section skeleton" style="height:320px;border-radius:var(--radius-xl);"></div>
    <div class="section skeleton" style="height:200px;border-radius:var(--radius-xl);"></div>
  `;
}

function catColor(name) {
  const map = { food:'#d97706', transport:'#2563eb', shopping:'#db2777', health:'#0e7c7b', bills:'#4338ca', grocery:'#059669', other:'#667085' };
  return map[name] || '#0e7c7b';
}

function formatAmount(n) {
  return formatCurrency(n, { symbol: false });
}

function relativeDate(iso) {
  const now   = new Date();
  const date  = new Date(iso);
  const diff  = Math.floor((now - date) / 1000);
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return t('datetime.yesterday');
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return t('dashboard.greeting_morning');
  if (h < 17) return t('dashboard.greeting_afternoon');
  return t('dashboard.greeting_evening');
}

function iconBell() {
  return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`;
}
