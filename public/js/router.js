// ============================================================
// CashFlow Router
// Hash-based SPA router
// ============================================================

import { setState, getState } from './store.js';

const ROUTES = {
  '/dashboard':   'dashboard',
  '/chat':        'chat',
  '/transactions':'transactions',
  '/reports':     'reports',
  '/statements':  'statements',
  '/gmail':       'gmail',
  '/settings':    'settings',
};

let _handlers = {};

/**
 * Navigate to a route
 */
export function navigate(route) {
  window.location.hash = route;
}

/**
 * Register a route handler
 */
export function on(route, fn) { _handlers[route] = fn; }

/**
 * Initialize router - listens to hash changes
 */
export function initRouter() {
  const handle = () => {
    const rawHash   = window.location.hash.slice(1) || '/dashboard';
    const hash      = rawHash.split('?')[0] || '/dashboard';
    const page      = ROUTES[hash] || 'dashboard';
    const handler   = _handlers[hash];

    setState({ currentPage: page });
    updateActiveNav(page);
    showPage(page);
    if (handler) handler();
  };

  window.addEventListener('hashchange', handle);
  handle(); // initial
}

function showPage(page) {
  document.querySelectorAll('.page').forEach(el => el.classList.remove('active'));
  const target = document.getElementById(`page-${page}`);
  if (target) {
    target.classList.add('active');
    target.scrollTop = 0;
  }
}

function updateActiveNav(page) {
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
  });
}
