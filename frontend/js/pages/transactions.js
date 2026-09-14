// ============================================================
// Transactions Page — Command Console Theme
// Full CRUD (Add, Edit, Delete, Detail, Multi-Filter)
// ============================================================

import { t } from '../i18n.js';
import {
  getTransactions,
  addTransaction,
  updateTransaction,
  deleteTransaction,
} from '../services/transactionsAdapter.js';
import { formatCurrency, getCurrencySymbol } from '../services/currency.js';

// ── State ──────────────────────────────────────────────────
let _filters  = { type: 'all', paymentMethod: 'all', category: 'all', query: '' };
let _container = null;

// ── Categories keyed by type ───────────────────────────────
const EXPENSE_CATS = ['food','transport','shopping','health','bills','education','entertainment','personal','grocery','other'];
const INCOME_CATS  = ['salary','business','freelance','agriculture','investment','gift','other'];

const CAT_ICONS = {
  food:'🍔', transport:'🚗', shopping:'🛍️', health:'💊', bills:'📱',
  education:'📚', entertainment:'🎬', personal:'💆', grocery:'🛒',
  salary:'💼', business:'🏢', freelance:'💻', agriculture:'🌾',
  investment:'📈', gift:'🎁', transfer:'🔄', atm:'🏧', income:'💰', other:'💸',
};

const METHOD_ICONS = {
  upi:'📲', card:'💳', cash:'💵', netBanking:'🏦', atm:'🏧', transfer:'🔄', bank:'🏦',
};

// ── Main Render ────────────────────────────────────────────

export async function renderTransactions(container) {
  _container = container;

  container.innerHTML = `
    <!-- Search -->
    <div class="section animate-fade-in-up" style="margin-bottom:var(--space-3);">
      <div class="search-bar" id="txn-search-bar">
        ${iconSearch()}
        <input type="search" id="txn-search" placeholder="${t('app.search')}" aria-label="Search transactions" autocomplete="off"/>
      </div>
    </div>

    <!-- Filter Chips -->
    <div class="scroll-row section animate-fade-in-up delay-1" style="padding-bottom:var(--space-2);margin-bottom:var(--space-2);" id="filter-row">
      ${['all','income','expense','upi','card','cash','atm','transfer','netBanking'].map(f => `
        <button class="chip ${(_filters.type === f || _filters.paymentMethod === f || (f==='all' && _filters.type==='all' && _filters.paymentMethod==='all')) ? 'active' : ''}" data-filter="${f}">
          ${t(`transactions.filter${capitalize(f)}`)}
        </button>
      `).join('')}
    </div>

    <!-- Header row with live counter and Add button -->
    <div class="section flex flex-between items-center animate-fade-in-up delay-1" style="margin-bottom:var(--space-3);">
      <div style="display:flex;align-items:center;gap:var(--space-2);">
        <span class="section-title" data-i18n="transactions.title"></span>
        <span id="txn-count-badge" class="badge badge-neutral" style="font-family:var(--font-mono);font-size:10px;">0</span>
      </div>
      <button id="btn-add-txn" class="btn btn-primary" style="padding:var(--space-2) var(--space-4);font-size:var(--text-sm);gap:var(--space-2);font-weight:var(--weight-semibold);">
        + <span data-i18n="app.add"></span>
      </button>
    </div>

    <!-- List -->
    <div id="txn-list" class="animate-fade-in-up delay-2" style="display:flex;flex-direction:column;gap:var(--space-3);">
      ${skeletonCards()}
    </div>
  `;

  await loadTransactions();
  setupHandlers();
  import('../i18n.js').then(({ rerender }) => rerender());
}

// ── Load & Render List ─────────────────────────────────────

async function loadTransactions() {
  const list = await getTransactions(_filters);
  const badge = _container?.querySelector('#txn-count-badge');
  if (badge) badge.textContent = `${list.length} txns`;
  renderTxnList(list);
}

function renderTxnList(list) {
  const el = _container?.querySelector('#txn-list');
  if (!el) return;

  if (!list || list.length === 0) {
    el.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📭</div>
        <div class="empty-state-title" data-i18n="transactions.noResults"></div>
        <div class="empty-state-desc" data-i18n="transactions.noResultsDesc"></div>
        <button class="btn btn-primary" style="margin-top:var(--space-4);" id="btn-empty-add">
          + Add First Transaction
        </button>
      </div>
    `;
    el.querySelector('#btn-empty-add')?.addEventListener('click', () => showAddEditModal());
    import('../i18n.js').then(({ rerender }) => rerender());
    return;
  }

  // Group by date
  const groups = groupByDate(list);
  el.innerHTML = groups.map(([dateLabel, txns]) => `
    <div class="section" style="margin-bottom:var(--space-2);">
      <div class="txn-date-label">${dateLabel}</div>
      <div class="txn-group-card">
        ${txns.map((txn, i) => `
          <div class="transaction-item ripple-container" data-id="${txn.id}"
               style="${i > 0 ? 'border-top:1px solid var(--color-border-subtle);' : ''}">
            <div class="transaction-icon cat-${txn.category}">${CAT_ICONS[txn.category] || '💸'}</div>
            <div class="transaction-info">
              <div class="transaction-merchant">${escapeHtml(txn.merchant)}</div>
              <div class="transaction-meta">
                <span>${t(`transactions.categories.${txn.category}`) || txn.category}</span>
                <span>·</span>
                <span>${METHOD_ICONS[txn.paymentMethod] || ''} ${t(`transactions.paymentMethods.${txn.paymentMethod}`) || txn.paymentMethod}</span>
                <span class="badge badge-${txn.source === 'gmail' ? 'info' : txn.source === 'receipt' ? 'warning' : 'neutral'}"
                      style="font-size:9px;padding:1px 6px;">${txn.source === 'gmail' && txn.tags?.includes('gemini-extracted') ? 'Gmail (AI)' : (t(`transactions.sources.${txn.source}`) || txn.source)}</span>
                ${txn.confidence != null && txn.confidence < 0.5 ? '<span class="badge badge-warning" style="font-size:9px;padding:1px 6px;">Review</span>' : ''}
              </div>
            </div>
            <div style="text-align:right;flex-shrink:0;">
              <div class="transaction-amount currency font-mono ${txn.type === 'income' ? 'amount-positive' : 'amount-negative'}" style="font-size:var(--text-sm);font-weight:var(--weight-semibold);">
                ${formatCurrency(txn.amount, { sign: txn.type === 'income' ? '+' : '-' })}
              </div>
              <div class="text-xs text-muted" style="margin-top:2px;font-family:var(--font-mono);font-size:11px;">${formatTime(txn.date)}</div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `).join('');
}

// ── Event Handlers ─────────────────────────────────────────

function setupHandlers() {
  // Search
  let _debounce;
  _container?.querySelector('#txn-search')?.addEventListener('input', e => {
    clearTimeout(_debounce);
    _debounce = setTimeout(async () => {
      _filters.query = e.target.value;
      await loadTransactions();
    }, 250);
  });

  // Filter chips
  _container?.querySelector('#filter-row')?.addEventListener('click', async e => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    const f = chip.dataset.filter;

    _filters.type          = 'all';
    _filters.paymentMethod = 'all';

    if (f === 'income' || f === 'expense') _filters.type = f;
    else if (f !== 'all') _filters.paymentMethod = f;

    _container.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    await loadTransactions();
  });

  // Add button
  _container?.querySelector('#btn-add-txn')?.addEventListener('click', () => showAddEditModal());

  // Transaction item → detail
  _container?.querySelector('#txn-list')?.addEventListener('click', e => {
    const item = e.target.closest('.transaction-item');
    if (item) showDetailModal(item.dataset.id);
  });
}

// ── Add / Edit Modal ───────────────────────────────────────

function showAddEditModal(existingTxn = null) {
  const isEdit   = !!existingTxn;
  const defType  = existingTxn?.type || 'expense';
  const defDate  = existingTxn
    ? new Date(existingTxn.date).toISOString().split('T')[0]
    : new Date().toISOString().split('T')[0];
  const defTime  = existingTxn
    ? new Date(existingTxn.date).toTimeString().slice(0, 5)
    : new Date().toTimeString().slice(0, 5);

  const cats = defType === 'income' ? INCOME_CATS : EXPENSE_CATS;

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal" style="border-radius:var(--radius-2xl) var(--radius-2xl) 0 0;">
      <div class="modal-handle"></div>
      <div class="modal-header">
        <h3 class="modal-title">${isEdit ? t('transactions.editTitle') : t('transactions.addNew')}</h3>
        <button class="btn btn-icon btn-ghost" id="btn-modal-close" aria-label="${t('app.close')}">${iconClose()}</button>
      </div>
      <div class="modal-body">
        <form id="txn-form" style="display:flex;flex-direction:column;gap:var(--space-4);" novalidate>

          <!-- Type Toggle -->
          <div class="tabs" id="type-tabs" role="tablist">
            <div class="tab-item ${defType==='expense'?'active':''}" data-type="expense" role="tab" tabindex="0">💸 ${t('transactions.types.expense')}</div>
            <div class="tab-item ${defType==='income'?'active':''}"  data-type="income"  role="tab" tabindex="0">💰 ${t('transactions.types.income')}</div>
          </div>

          <!-- Amount — large prominent input -->
          <div class="form-group">
            <label class="form-label" style="font-size:var(--text-xs);letter-spacing:0.05em;color:var(--color-text-secondary);">AMOUNT (${getCurrencySymbol()})</label>
            <div class="input-wrapper" style="position:relative;">
              <span class="input-icon-left" style="font-weight:800;font-size:1.4rem;color:var(--color-brand-primary);">${getCurrencySymbol()}</span>
              <input id="txn-amount" class="form-input has-icon-left" type="number"
                     min="0.01" step="0.01" inputmode="decimal"
                     placeholder="0.00" value="${existingTxn?.amount || ''}"
                     required
                     style="font-size:var(--text-2xl);font-weight:var(--weight-bold);font-family:var(--font-mono);height:60px;letter-spacing:-0.02em;"/>
            </div>
          </div>

          <!-- Description -->
          <div class="form-group">
            <label class="form-label" data-i18n="transactions.merchant"></label>
            <input id="txn-merchant" class="form-input" type="text"
                   placeholder="${t('transactions.merchantPlaceholder')}"
                   value="${escapeHtml(existingTxn?.merchant || '')}"
                   autocomplete="off" />
          </div>

          <!-- Category -->
          <div class="form-group">
            <label class="form-label" data-i18n="transactions.category"></label>
            <div class="category-grid" id="cat-grid">
              ${cats.map(c => `
                <button type="button" class="cat-chip ${existingTxn?.category === c ? 'active' : ''}" data-cat="${c}">
                  <span>${CAT_ICONS[c] || '💸'}</span>
                  <span style="font-size:10px;">${t(`transactions.categories.${c}`)}</span>
                </button>
              `).join('')}
            </div>
            <input type="hidden" id="txn-category" value="${existingTxn?.category || cats[0]}" />
          </div>

          <!-- Payment Method -->
          <div class="form-group">
            <label class="form-label" data-i18n="transactions.paymentMethod"></label>
            <div class="method-grid" id="method-grid">
              ${['cash','upi','card','netBanking','bank','atm'].map(m => `
                <button type="button" class="method-chip ${(existingTxn?.paymentMethod||'cash') === m ? 'active' : ''}" data-method="${m}">
                  ${METHOD_ICONS[m]} ${t(`transactions.paymentMethods.${m}`)}
                </button>
              `).join('')}
            </div>
            <input type="hidden" id="txn-method" value="${existingTxn?.paymentMethod || 'cash'}" />
          </div>

          <!-- Date + Time -->
          <div class="grid-2" style="gap:var(--space-3);">
            <div class="form-group">
              <label class="form-label" data-i18n="transactions.date"></label>
              <input id="txn-date" class="form-input" type="date" value="${defDate}" required />
            </div>
            <div class="form-group">
              <label class="form-label" data-i18n="transactions.time"></label>
              <input id="txn-time" class="form-input" type="time" value="${defTime}" />
            </div>
          </div>

          <!-- Note -->
          <div class="form-group">
            <label class="form-label" data-i18n="transactions.note"></label>
            <input id="txn-note" class="form-input" type="text"
                   placeholder="${t('transactions.notePlaceholder')}"
                   value="${escapeHtml(existingTxn?.note || '')}" />
          </div>

          <!-- Error message -->
          <div id="form-error" class="form-error hidden"></div>

          <!-- Submit -->
          <button type="submit" id="btn-submit" class="btn btn-primary btn-lg btn-full" style="margin-top:var(--space-2);">
            ${isEdit ? t('app.save') : '+ ' + t('transactions.addNew')}
          </button>

        </form>
      </div>
    </div>
  `;

  document.body.appendChild(backdrop);
  requestAnimationFrame(() => backdrop.classList.add('open'));

  // Focus amount
  setTimeout(() => backdrop.querySelector('#txn-amount')?.focus(), 350);

  // ── Close
  const close = () => {
    backdrop.classList.remove('open');
    setTimeout(() => backdrop.remove(), 400);
  };
  backdrop.querySelector('#btn-modal-close').addEventListener('click', close);
  backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });

  // ── Type tabs
  let selectedType = defType;
  backdrop.querySelectorAll('#type-tabs .tab-item').forEach(tab => {
    const activate = () => {
      backdrop.querySelectorAll('#type-tabs .tab-item').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      selectedType = tab.dataset.type;
      const newCats = selectedType === 'income' ? INCOME_CATS : EXPENSE_CATS;
      const grid = backdrop.querySelector('#cat-grid');
      const firstCat = newCats[0];
      backdrop.querySelector('#txn-category').value = firstCat;
      grid.innerHTML = newCats.map(c => `
        <button type="button" class="cat-chip ${c === firstCat ? 'active' : ''}" data-cat="${c}">
          <span>${CAT_ICONS[c] || '💸'}</span>
          <span style="font-size:10px;">${t(`transactions.categories.${c}`)}</span>
        </button>
      `).join('');
      setupCatGrid(backdrop);
    };
    tab.addEventListener('click', activate);
    tab.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') activate(); });
  });

  // ── Category chips
  setupCatGrid(backdrop);

  // ── Method chips
  backdrop.querySelector('#method-grid').addEventListener('click', e => {
    const chip = e.target.closest('.method-chip');
    if (!chip) return;
    backdrop.querySelectorAll('.method-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    backdrop.querySelector('#txn-method').value = chip.dataset.method;
  });

  // ── Submit
  backdrop.querySelector('#txn-form').addEventListener('submit', async e => {
    e.preventDefault();
    const errorEl = backdrop.querySelector('#form-error');
    errorEl.classList.add('hidden');

    const amountVal = parseFloat(backdrop.querySelector('#txn-amount').value);
    if (!amountVal || amountVal <= 0) {
      errorEl.textContent = 'Please enter a valid amount.';
      errorEl.classList.remove('hidden');
      backdrop.querySelector('#txn-amount').focus();
      return;
    }

    const dateVal = backdrop.querySelector('#txn-date').value;
    const timeVal = backdrop.querySelector('#txn-time').value || '00:00';
    if (!dateVal) {
      errorEl.textContent = 'Please select a date.';
      errorEl.classList.remove('hidden');
      return;
    }

    const btn = backdrop.querySelector('#btn-submit');
    btn.classList.add('loading');
    btn.disabled = true;

    const payload = {
      merchant:      backdrop.querySelector('#txn-merchant').value.trim() || (selectedType === 'expense' ? 'Expense' : 'Income'),
      amount:        amountVal,
      type:          selectedType,
      category:      backdrop.querySelector('#txn-category').value,
      paymentMethod: backdrop.querySelector('#txn-method').value,
      date:          `${dateVal}T${timeVal}`,
      note:          backdrop.querySelector('#txn-note').value.trim(),
    };

    try {
      if (isEdit) {
        await updateTransaction(existingTxn.id, payload);
        showToast('success', t('notifications.transactionAdded'));
      } else {
        await addTransaction(payload);
        showToast('success', t('notifications.transactionAdded'));
      }
      close();
      await loadTransactions();
    } catch (err) {
      errorEl.textContent = err.message || t('errors.generic');
      errorEl.classList.remove('hidden');
    } finally {
      btn.classList.remove('loading');
      btn.disabled = false;
    }
  });
}

function setupCatGrid(backdrop) {
  backdrop.querySelector('#cat-grid')?.addEventListener('click', e => {
    const chip = e.target.closest('.cat-chip');
    if (!chip) return;
    backdrop.querySelectorAll('.cat-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    backdrop.querySelector('#txn-category').value = chip.dataset.cat;
  });
}

// ── Detail / Delete Modal ──────────────────────────────────

async function showDetailModal(id) {
  const all  = await getTransactions({});
  const txn  = all.find(t => t.id === id);
  if (!txn) return;

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal" style="border-radius:var(--radius-2xl) var(--radius-2xl) 0 0;">
      <div class="modal-handle"></div>
      <div class="modal-header">
        <h3 class="modal-title">Transaction Detail</h3>
        <button class="btn btn-icon btn-ghost" id="detail-close">${iconClose()}</button>
      </div>
      <div class="modal-body" style="display:flex;flex-direction:column;gap:var(--space-4);">

        <!-- Amount hero -->
        <div class="console-panel" style="text-align:center;padding:var(--space-6) var(--space-4);">
          <div style="font-size:2.8rem;margin-bottom:var(--space-2);">${CAT_ICONS[txn.category] || '💸'}</div>
          <div class="text-3xl font-bold font-mono currency ${txn.type === 'income' ? 'amount-positive text-income' : 'amount-negative text-expense'}">
            ${formatCurrency(txn.amount, { sign: txn.type === 'income' ? '+' : '-' })}
          </div>
          <div class="text-sm font-semibold" style="margin-top:var(--space-2);color:var(--color-text-primary);">
            ${escapeHtml(txn.merchant)}
          </div>
        </div>

        <!-- Detail rows -->
        <div class="console-panel" style="padding:var(--space-4);display:flex;flex-direction:column;gap:var(--space-3);">
          ${detailRow('📅', 'Date', formatDateTime(txn.date))}
          ${detailRow('🏷️', 'Category', t(`transactions.categories.${txn.category}`) || txn.category)}
          ${detailRow(METHOD_ICONS[txn.paymentMethod] || '💳', 'Payment', t(`transactions.paymentMethods.${txn.paymentMethod}`) || txn.paymentMethod)}
          ${detailRow('📌', 'Source', txn.source === 'gmail' && txn.tags?.includes('gemini-extracted') ? 'Gmail (Gemini AI)' : (t(`transactions.sources.${txn.source}`) || txn.source))}
          ${txn.metadata?.bankName ? detailRow('🏦', 'Bank', escapeHtml(txn.metadata.bankName)) : ''}
          ${txn.reference ? detailRow('🔢', 'Reference', escapeHtml(txn.reference)) : ''}
          ${txn.confidence != null && txn.confidence < 0.5 ? detailRow('⚠️', 'Status', '<span class="badge badge-warning" style="font-size:10px;">Needs Review</span>') : ''}
          ${txn.note ? detailRow('📝', 'Note', escapeHtml(txn.note)) : ''}
        </div>

        <!-- Actions -->
        ${txn.source === 'manual' || txn.source === 'receipt' ? `
          <div style="display:flex;gap:var(--space-3);margin-top:var(--space-2);">
            <button id="btn-detail-edit" class="btn btn-secondary btn-full">✏️ ${t('app.edit')}</button>
            <button id="btn-detail-delete" class="btn btn-full" style="background:rgba(220,38,38,0.1);color:var(--color-danger);border:1px solid rgba(220,38,38,0.3);">
              🗑️ ${t('app.delete')}
            </button>
          </div>
        ` : `
          <div class="insight-card" style="text-align:center;margin-top:var(--space-2);">
            <span class="text-xs text-muted">Gmail-sourced transactions cannot be edited here.<br>They are synchronized automatically from your email alerts.</span>
          </div>
        `}
      </div>
    </div>
  `;

  document.body.appendChild(backdrop);
  requestAnimationFrame(() => backdrop.classList.add('open'));

  const close = () => {
    backdrop.classList.remove('open');
    setTimeout(() => backdrop.remove(), 400);
  };

  backdrop.querySelector('#detail-close').addEventListener('click', close);
  backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });

  backdrop.querySelector('#btn-detail-edit')?.addEventListener('click', () => {
    close();
    setTimeout(() => showAddEditModal(txn), 200);
  });

  backdrop.querySelector('#btn-detail-delete')?.addEventListener('click', () => {
    close();
    setTimeout(() => showDeleteConfirm(txn.id), 200);
  });
}

function detailRow(icon, label, value) {
  return `
    <div style="display:flex;align-items:center;gap:var(--space-3);">
      <span style="font-size:1.1rem;width:24px;text-align:center;flex-shrink:0;">${icon}</span>
      <span class="text-xs text-muted" style="width:76px;flex-shrink:0;">${label}</span>
      <span class="text-sm font-medium" style="flex:1;">${value}</span>
    </div>
  `;
}

// ── Delete Confirm ─────────────────────────────────────────

function showDeleteConfirm(id) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal" style="border-radius:var(--radius-2xl);max-width:340px;margin:auto;">
      <div class="modal-body" style="padding:var(--space-6);text-align:center;">
        <div style="font-size:3rem;margin-bottom:var(--space-4);">🗑️</div>
        <h3 class="modal-title" style="margin-bottom:var(--space-2);">${t('transactions.deleteConfirm')}</h3>
        <p class="text-sm text-muted" style="margin-bottom:var(--space-6);">${t('transactions.deleteConfirmDesc')}</p>
        <div style="display:flex;gap:var(--space-3);">
          <button id="btn-del-cancel" class="btn btn-secondary btn-full">${t('app.cancel')}</button>
          <button id="btn-del-confirm" class="btn btn-danger btn-full">${t('app.delete')}</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(backdrop);
  requestAnimationFrame(() => backdrop.classList.add('open'));

  const close = () => {
    backdrop.classList.remove('open');
    setTimeout(() => backdrop.remove(), 400);
  };

  backdrop.querySelector('#btn-del-cancel').addEventListener('click', close);

  backdrop.querySelector('#btn-del-confirm').addEventListener('click', async () => {
    const btn = backdrop.querySelector('#btn-del-confirm');
    btn.classList.add('loading');
    btn.disabled = true;
    try {
      await deleteTransaction(id);
      close();
      await loadTransactions();
      showToast('success', 'Transaction deleted');
    } catch {
      showToast('error', t('errors.generic'));
    } finally {
      btn.classList.remove('loading');
      btn.disabled = false;
    }
  });
}

// ── Helpers ───────────────────────────────────────────────

function groupByDate(list) {
  const map = new Map();
  list.forEach(txn => {
    const d     = new Date(txn.date);
    const label = isToday(d) ? t('datetime.today') : isYesterday(d) ? t('datetime.yesterday') : formatDate(d);
    if (!map.has(label)) map.set(label, []);
    map.get(label).push(txn);
  });
  return [...map.entries()];
}

function isToday(d)     { const n = new Date(); return d.toDateString() === n.toDateString(); }
function isYesterday(d) { const n = new Date(); n.setDate(n.getDate() - 1); return d.toDateString() === n.toDateString(); }
function formatDate(d)  { return d.toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' }); }
function formatTime(iso){ return new Date(iso).toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' }); }
function formatDateTime(iso){ const d = new Date(iso); return `${formatDate(d)} • ${formatTime(iso)}`; }
function capitalize(s)  { return s.charAt(0).toUpperCase() + s.slice(1); }
function escapeHtml(s)  { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function skeletonCards() {
  return [1,2,3].map(() => `<div class="skeleton" style="height:72px;border-radius:var(--radius-lg);margin-bottom:var(--space-2);"></div>`).join('');
}

function showToast(type, message) {
  import('../app.js').then(m => m.showToast?.(type, message)).catch(() => {});
}

// ── Icons ─────────────────────────────────────────────────

function iconSearch() {
  return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--color-text-muted);flex-shrink:0;"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`;
}

function iconClose() {
  return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
}
