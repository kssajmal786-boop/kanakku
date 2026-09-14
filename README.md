# CashFlow — Personal Finance App

## Quick Start

**Double-click `start-app.bat`** in the `cashflow-app/` folder.

This starts both servers and opens `http://localhost:3000` in your browser.

---

## ⚠️ IMPORTANT — Never Open index.html Directly

The app uses ES6 modules (`type="module"`). If you double-click `index.html` in File Explorer, it opens with the `file://` protocol, which **blocks module imports** due to browser security policy. The page will appear blank.

**Always use the HTTP server:**
```
http://localhost:3000
```

---

## Manual Start (if start-app.bat doesn't work)

Open **two separate terminals**:

### Terminal 1 — Backend API (port 3001)
```bash
cd cashflow-app/backend
npm install        # first time only
npm run dev
```

### Terminal 2 — Frontend PWA (port 3000)
```bash
cd cashflow-app/frontend
node server.js
```

Then open `http://localhost:3000` in your browser.

---

## Environment Setup

Copy the example env file and fill in your credentials:

```bash
cd cashflow-app/backend
copy .env.example .env
```

Edit `backend/.env`:

| Variable | Where to get it |
|---|---|
| `GOOGLE_CLIENT_ID` | [Google Cloud Console](https://console.cloud.google.com) → APIs & Services → Credentials |
| `GOOGLE_CLIENT_SECRET` | Same as above |
| `GEMINI_API_KEY` | [Google AI Studio](https://aistudio.google.com/app/apikey) |
| `JWT_SECRET` | Run: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `JWT_REFRESH_SECRET` | Same command, run again |
| `COOKIE_SECRET` | Run: `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"` |

**Note:** Gmail sync and AI chat require valid API keys. All local features (manual transactions, reports, PDF generation) work without any API keys.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ FRONTEND (http://localhost:3000)                              │
│ Vanilla JS PWA — No framework                                 │
│                                                               │
│ ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐│
│ │   Dashboard  │  │     Chat     │  │  Transactions / Rpts ││
│ └──────────────┘  └──────────────┘  └──────────────────────┘│
│                                                               │
│         ┌────────────────────────────────────┐               │
│         │  IndexedDB (Dexie.js)              │               │
│         │  ALL transaction data lives here   │               │
│         │  Local-first · Never leaves device │               │
│         └────────────────────────────────────┘               │
└─────────────────────────────────────────────────────────────┘
                           ↑↓ API only (no transaction storage)
┌─────────────────────────────────────────────────────────────┐
│ BACKEND (http://localhost:3001)                               │
│ Node.js + TypeScript + Express — Stateless                    │
│                                                               │
│  /auth/google   → Google OAuth                                │
│  /gmail/sync    → Fetch + parse bank emails                   │
│  /ai/chat       → Gemini (transient, no storage)             │
└─────────────────────────────────────────────────────────────┘
```

### Privacy Model

- **Durable data** (transactions, statements, history) → IndexedDB on your device only
- **Transient processing** → backend receives only what's needed for a single request, never persists it
- This is **not** end-to-end encryption. The AI receives actual transaction context when you ask a question. It does not store it.

---

## Features

| Feature | Status |
|---|---|
| Google OAuth login (Gmail read-only) | ✅ Live |
| Gmail bank/UPI email parser | ✅ Live |
| Manual cash transaction entry | ✅ Live |
| Transaction list with filters | ✅ Live |
| Dashboard with spending summary | ✅ Live |
| Financial health score | ✅ Live |
| Reports (daily/monthly/annual) | ✅ Live |
| Income Statement PDF | ✅ Live |
| Finance Chat (AI) | ✅ Live |
| PWA (installable) | ✅ Live |
| English + Tamil i18n | ✅ Live |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla JS, HTML, CSS |
| Local storage | IndexedDB via Dexie.js |
| Charts | Chart.js |
| PDF | jsPDF + jsPDF-AutoTable |
| Backend | Node.js + TypeScript + Express |
| Auth | Google OAuth 2.0 |
| AI | Google Gemini API |

---

## Development Notes

- Amounts are stored in **paise** (integer) to avoid floating-point errors
- ATM withdrawals are `type: 'transfer'`, not `type: 'expense'` — to avoid double-counting cash
- The AI (Gemini) never performs financial calculations — the app computes all numbers deterministically, then Gemini interprets them
- Soft-delete pattern: transactions get a `deletedAt` timestamp, never hard-deleted (unless explicitly requested)
