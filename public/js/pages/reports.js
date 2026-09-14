// ============================================================
// Reports Page — Command Console Theme
// Daily / Monthly / 6-Month / Annual / Custom Reports
// ============================================================

import { t } from '../i18n.js';
import { getReport } from '../services/reportsService.js';
import { formatCurrency } from '../services/currency.js';

let _activeTab = 'monthly';

export async function renderReports(container, options = {}) {
  if (options.tab) {
    _activeTab = options.tab;
  }
  const customRange = options.customRange || null;
  const isCustom = _activeTab === 'custom';

  container.innerHTML = `
    <!-- Tabs -->
    <div class="section animate-fade-in-up" style="margin-bottom:var(--space-3);">
      <div class="scroll-row" id="report-tabs" style="gap:var(--space-2);">
        ${['daily','monthly','6month','annual','custom'].map(tab => `
          <button class="chip ${tab === _activeTab ? 'active' : ''}" data-tab="${tab}">
            ${t(`reports.${tab === '6month' ? 'sixMonth' : tab}`)}
          </button>
        `).join('')}
      </div>
    </div>

    <!-- Custom Range -->
    <div id="custom-range" class="section ${isCustom ? '' : 'hidden'} animate-fade-in-up" style="margin-bottom:var(--space-3);">
      <div class="console-panel" style="padding:var(--space-4);">
        <div class="grid-2" style="gap:var(--space-3);margin-bottom:var(--space-3);">
          <div class="form-group">
            <label class="form-label" data-i18n="reports.from"></label>
            <input id="range-from" type="date" class="form-input" value="${customRange?.from || ''}" />
          </div>
          <div class="form-group">
            <label class="form-label" data-i18n="reports.to"></label>
            <input id="range-to" type="date" class="form-input" value="${customRange?.to || new Date().toISOString().split('T')[0]}" />
          </div>
        </div>
        <button id="btn-custom-gen" class="btn btn-primary btn-full">
          ${t('reports.generate')}
        </button>
      </div>
    </div>

    <!-- Report Content -->
    <div id="report-content">
      <div class="skeleton" style="height:120px;border-radius:var(--radius-lg);margin-bottom:var(--space-3);"></div>
      <div class="skeleton" style="height:220px;border-radius:var(--radius-lg);margin-bottom:var(--space-3);"></div>
      <div class="skeleton" style="height:180px;border-radius:var(--radius-lg);"></div>
    </div>
  `;

  import('../i18n.js').then(({ rerender }) => rerender());
  setupReportHandlers(container);
  await loadReport(container, _activeTab, customRange);
}

async function loadReport(container, type, customRange) {
  const content = container.querySelector('#report-content');
  if (!content) return;
  content.innerHTML = `
    <div style="display:flex;justify-content:center;padding:var(--space-12);">
      <div class="spinner spinner-lg"></div>
    </div>
  `;

  try {
    const data = await getReport(type, customRange);
    renderReportContent(container, data);
  } catch {
    content.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚠️</div><p>${t('errors.generic')}</p></div>`;
  }
}

function renderReportContent(container, data) {
  const content = container.querySelector('#report-content');
  if (!content) return;

  const netPositive = data.netFlow >= 0;
  content.innerHTML = `
    <!-- Summary Cards -->
    <div class="section animate-fade-in-up" style="margin-bottom:var(--space-3);">
      <div class="grid-2" style="gap:var(--space-3);margin-bottom:var(--space-3);">
        <div class="console-panel" style="padding:var(--space-4);">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-2);">
            <span class="console-eyebrow" data-i18n="reports.totalIncome"></span>
            <span style="font-size:1.2rem;">💰</span>
          </div>
          <div class="text-xl font-bold font-mono text-income currency" style="letter-spacing:-0.02em;">
            ${formatCurrency(data.totalIncome, { sign: '+' })}
          </div>
        </div>

        <div class="console-panel" style="padding:var(--space-4);">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-2);">
            <span class="console-eyebrow" data-i18n="reports.totalExpense"></span>
            <span style="font-size:1.2rem;">💸</span>
          </div>
          <div class="text-xl font-bold font-mono text-expense currency" style="letter-spacing:-0.02em;">
            ${formatCurrency(data.totalExpense, { sign: '-' })}
          </div>
        </div>
      </div>

      <!-- Net Flow Banner -->
      <div class="console-panel" style="padding:var(--space-4) var(--space-5);border-left:4px solid ${netPositive ? 'var(--color-flow)' : 'var(--color-danger)'};">
        <div style="display:flex;align-items:center;justify-content:space-between;">
          <div>
            <div class="console-eyebrow" data-i18n="reports.netFlow"></div>
            <div class="text-2xl font-bold font-mono currency" style="margin-top:var(--space-1);color:${netPositive ? 'var(--color-flow)' : 'var(--color-danger)'};">
              ${formatCurrency(data.netFlow, { sign: 'auto' })}
            </div>
          </div>
          <span class="badge ${netPositive ? 'badge-success' : 'badge-danger'}" style="font-size:11px;">
            ${netPositive ? 'Positive Net Flow' : 'Deficit Period'}
          </span>
        </div>
      </div>
    </div>

    <!-- Trend Chart -->
    <div class="section animate-fade-in-up delay-1" style="margin-bottom:var(--space-3);">
      <div class="console-panel">
        <div class="console-panel-header">
          <span class="console-panel-title" data-i18n="reports.trend"></span>
          <span class="console-eyebrow">${data.label || ''}</span>
        </div>
        <div class="chart-container" style="height:200px;position:relative;">
          <canvas id="report-trend-chart"></canvas>
        </div>
      </div>
    </div>

    <!-- Top Categories -->
    <div class="section animate-fade-in-up delay-2" style="margin-bottom:var(--space-3);">
      <div class="console-panel">
        <div class="console-panel-header">
          <span class="console-panel-title" data-i18n="reports.topCategories"></span>
          <span class="console-eyebrow">Category Share</span>
        </div>
        <div>
          ${data.topCategories.length > 0 ? data.topCategories.map((cat, i) => {
            const max = data.topCategories[0].amount;
            const pct = Math.round((cat.amount / max) * 100);
            const colors = ['#0e7c7b','#d97706','#4338ca','#2563eb','#e11d48'];
            const color = colors[i % colors.length];
            return `
              <div style="margin-bottom:var(--space-3);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-1);">
                  <span class="text-sm font-medium" style="display:flex;align-items:center;gap:var(--space-2);">
                    <span style="width:8px;height:8px;border-radius:50%;background:${color};display:inline-block;"></span>
                    ${t(`transactions.categories.${cat.name}`) || cat.name}
                  </span>
                  <span class="text-sm font-semibold font-mono currency">${formatCurrency(cat.amount)}</span>
                </div>
                <div class="progress-track" style="height:6px;background:var(--color-bg-input);">
                  <div class="progress-fill" style="width:${pct}%;background:${color};"></div>
                </div>
              </div>
            `;
          }).join('') : `
            <div class="text-xs text-muted" style="text-align:center;padding:var(--space-4);">No expense records in this period</div>
          `}
        </div>
      </div>
    </div>

    <!-- Income vs Expense Donut -->
    <div class="section animate-fade-in-up delay-2" style="margin-bottom:var(--space-3);">
      <div class="console-panel">
        <div class="console-panel-header">
          <span class="console-panel-title">Income vs Expense Ratio</span>
        </div>
        <div style="display:flex;align-items:center;gap:var(--space-6);">
          <div style="width:120px;height:120px;flex-shrink:0;position:relative;">
            <canvas id="report-split-chart"></canvas>
          </div>
          <div style="flex:1;">
            <div style="display:flex;align-items:center;gap:var(--space-3);margin-bottom:var(--space-3);">
              <div style="width:10px;height:10px;border-radius:3px;background:var(--color-flow);"></div>
              <div>
                <div class="console-eyebrow" data-i18n="reports.totalIncome"></div>
                <div class="font-bold font-mono text-income currency">${formatCurrency(data.totalIncome)}</div>
              </div>
            </div>
            <div style="display:flex;align-items:center;gap:var(--space-3);">
              <div style="width:10px;height:10px;border-radius:3px;background:var(--color-danger);"></div>
              <div>
                <div class="console-eyebrow" data-i18n="reports.totalExpense"></div>
                <div class="font-bold font-mono text-expense currency">${formatCurrency(data.totalExpense)}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Download PDF Statement -->
    <div class="section animate-fade-in-up delay-3" style="margin-bottom:var(--space-8);">
      <button id="btn-download-pdf" class="btn btn-secondary btn-lg btn-full" style="font-weight:var(--weight-semibold);gap:var(--space-2);">
        📄 <span data-i18n="reports.download">Download Statement PDF</span>
      </button>
    </div>
  `;

  import('../i18n.js').then(({ rerender }) => rerender());

  requestAnimationFrame(() => {
    renderReportTrendChart(data.trendData);
    renderSplitChart(data.totalIncome, data.totalExpense);
  });

  container.querySelector('#btn-download-pdf')?.addEventListener('click', async () => {
    const btn = container.querySelector('#btn-download-pdf');
    btn.classList.add('loading');
    btn.disabled = true;
    try {
      const { generateStatement } = await import('../services/pdfService.js');
      await generateStatement(data.startDate || getStartDateForType(_activeTab), data.endDate || new Date().toISOString().substring(0,10), data.label || 'Report Statement');
      import('../app.js').then(m => m.showToast?.('success', 'Statement PDF downloaded!'));
    } catch(err) {
      import('../app.js').then(m => m.showToast?.('error', 'PDF generation failed: ' + err.message));
    } finally {
      btn.classList.remove('loading');
      btn.disabled = false;
    }
  });
}

function renderReportTrendChart(trendData) {
  const canvas = document.getElementById('report-trend-chart');
  if (!canvas || !window.Chart) return;

  const labels  = trendData.map(d => d.label);
  const incomes  = trendData.map(d => d.income || 0);
  const expenses = trendData.map(d => d.expense || 0);

  new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: t('reports.totalIncome'),
          data: incomes,
          borderColor: '#0e7c7b',
          backgroundColor: 'rgba(14,124,123,0.08)',
          fill: true,
          tension: 0.35,
          pointRadius: labels.length > 15 ? 0 : 3,
          borderWidth: 2,
        },
        {
          label: t('reports.totalExpense'),
          data: expenses,
          borderColor: '#dc2626',
          backgroundColor: 'rgba(220,38,38,0.05)',
          fill: true,
          tension: 0.35,
          pointRadius: labels.length > 15 ? 0 : 3,
          borderWidth: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#ffffff',
          titleColor: '#10151f',
          bodyColor: '#667085',
          borderColor: 'rgba(16,21,31,0.1)',
          borderWidth: 1,
          callbacks: { label: ctx => `${ctx.dataset.label}: ${formatCurrency(ctx.raw)}` },
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#667085', font: { family: "'JetBrains Mono', monospace", size: 10 }, maxTicksLimit: 8 } },
        y: {
          grid: { color: 'rgba(16,21,31,0.05)' },
          ticks: {
            color: '#667085',
            font: { family: "'JetBrains Mono', monospace", size: 10 },
            callback: v => formatCurrency(v, { compact: true }),
          },
        },
      },
    },
  });
}

function renderSplitChart(income, expense) {
  const canvas = document.getElementById('report-split-chart');
  if (!canvas || !window.Chart) return;
  new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: ['Income', 'Expense'],
      datasets: [{
        data: [income || 0.01, expense || 0.01],
        backgroundColor: ['#0e7c7b', '#dc2626'],
        borderWidth: 2,
        borderColor: '#ffffff',
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '72%',
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#ffffff',
          titleColor: '#10151f',
          bodyColor: '#667085',
          borderColor: 'rgba(16,21,31,0.1)',
          borderWidth: 1,
          callbacks: { label: ctx => ` ${formatCurrency(ctx.raw)}` },
        },
      },
    },
  });
}

function setupReportHandlers(container) {
  const tabs = container.querySelector('#report-tabs');
  const customRange = container.querySelector('#custom-range');

  tabs?.addEventListener('click', async e => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    tabs.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');

    _activeTab = chip.dataset.tab;
    if (_activeTab === 'custom') {
      customRange?.classList.remove('hidden');
    } else {
      customRange?.classList.add('hidden');
      await loadReport(container, _activeTab);
    }
  });

  container.querySelector('#btn-custom-gen')?.addEventListener('click', async () => {
    const from = container.querySelector('#range-from')?.value;
    const to   = container.querySelector('#range-to')?.value;
    if (!from || !to) return;
    await loadReport(container, 'custom', { from, to });
  });
}

function fmt(n) {
  return formatCurrency(n, { symbol: false });
}

function getStartDateForType(type) {
  const now = new Date();
  switch (type) {
    case 'daily': return now.toISOString().split('T')[0];
    case '6month': return new Date(now.getFullYear(), now.getMonth() - 5, 1).toISOString().split('T')[0];
    case 'annual': return new Date(now.getFullYear(), 0, 1).toISOString().split('T')[0];
    case 'monthly':
    default: return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
  }
}
