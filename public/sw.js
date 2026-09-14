const CACHE_NAME = 'cashflow-v12';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/css/design-system.css',
  '/css/components.css',
  '/css/layouts.css',
  '/css/animations.css',
  '/js/app.js',
  '/js/router.js',
  '/js/store.js',
  '/js/i18n.js',
  '/js/authFlow.js',
  '/i18n/en.js',
  '/i18n/ta.js',
  '/js/pages/onboarding.js',
  '/js/pages/dashboard.js',
  '/js/pages/chat.js',
  '/js/pages/transactions.js',
  '/js/pages/reports.js',
  '/js/pages/statements.js',
  '/js/pages/gmail.js',
  '/js/pages/settings.js',
  '/js/services/apiClient.js',
  '/js/services/db.js',
  '/js/services/theme.js',
  '/js/services/currency.js',
  '/js/services/gmailSync.js',
  '/js/services/dashboardService.js',
  '/js/services/transactionStore.js',
  '/js/services/transactionsAdapter.js',
  '/js/services/receiptOcr.js',
  '/js/services/pdfService.js',
  '/js/services/tamilFont.js',
  '/js/services/reportsService.js',
  '/js/services/chatService.js',
  '/js/services/healthScore.js',
];

self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// Network-first strategy for all requests to prevent stale cached UI during development
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then(res => {
        if (res && res.status === 200 && res.type === 'basic') {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
