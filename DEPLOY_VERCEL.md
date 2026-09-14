# Complete Guide: Deploying CashFlow on Vercel

This guide walks you step-by-step through deploying your CashFlow application to [Vercel](https://vercel.com).

---

## Architecture Overview on Vercel

```
┌─────────────────────────────────────────────────────────────┐
│                       VERCEL HOSTING                        │
│                                                             │
│  ┌────────────────────────┐    ┌─────────────────────────┐  │
│  │     EDGE CDN           │    │   SERVERLESS FUNCTION   │  │
│  │   (Static Frontend)    │    │      (api/index.ts)     │  │
│  │                        │    │                         │  │
│  │  • HTML / CSS / JS     │    │  • /auth (OAuth / JWT)  │  │
│  │  • IndexedDB (Dexie)   │    │  • /gmail (Bank sync)   │  │
│  │  • Chart.js / jsPDF    │    │  • /ai (Gemini chat)    │  │
│  │  • PWA Service Worker  │    │  • /health & /metrics   │  │
│  └────────────────────────┘    └────────────┬────────────┘  │
└─────────────────────────────────────────────┼───────────────┘
                                              │
                                              ▼
                             ┌────────────────────────────────┐
                             │  CLOUD POSTGRESQL (Free Neon)  │
                             │  • User accounts & metadata    │
                             │  • Encrypted OAuth tokens      │
                             │  • Auto-migrated schema        │
                             └────────────────────────────────┘
```

- **Frontend (Static / PWA)**: Served directly from Vercel's global Edge Network for blazing speed. All transaction data remains strictly local in your browser's IndexedDB.
- **Backend API (Serverless)**: Runs on Vercel Serverless Functions (`api/index.ts`), dual-mounted at `/auth`, `/gmail`, `/ai`, `/health`, and `/api/*`.
- **Database (PostgreSQL)**: Because Vercel serverless containers are stateless and ephemeral, account and OAuth metadata are stored in a cloud PostgreSQL database (free tier on [Neon.tech](https://neon.tech) or [Supabase](https://supabase.com)).

---

## Prerequisites

1. **GitHub Account**: [github.com](https://github.com)
2. **Vercel Account**: [vercel.com](https://vercel.com) (sign up with GitHub)
3. **Free Cloud PostgreSQL**: [neon.tech](https://neon.tech) (creates in 30 seconds)
4. **Google Cloud Console**: For Google OAuth & Gmail sync ([console.cloud.google.com](https://console.cloud.google.com))
5. **Gemini API Key**: For AI chat ([aistudio.google.com](https://aistudio.google.com/app/apikey))

---

## Step 1: Create a Free Cloud Database on Neon

Vercel functions cannot save files to disk permanently, so a cloud PostgreSQL database is needed for account storage.

1. Go to [Neon.tech](https://neon.tech) and sign up for a free account.
2. Click **Create Project**, name it `cashflow-db`, and choose your nearest region.
3. Once created, copy the **Connection string** (it looks like `postgresql://user:pass@ep-xyz.region.neon.tech/neondb?sslmode=require`).
4. Save this URL—you will paste it as `DATABASE_URL` in Vercel. CashFlow automatically creates all required tables on first start!

---

## Step 2: Push Your Code to GitHub

Open PowerShell in the `cashflow-app` folder:

```bash
cd f:\cashflow-app-v7\cashflow-app

# 1. Initialize Git
git init

# 2. Add all files (secrets and build outputs are safely ignored by .gitignore)
git add .

# 3. Commit
git commit -m "Initial commit - CashFlow Vercel ready"

# 4. Rename default branch
git branch -M main

# 5. Link to your GitHub repository and push
git remote add origin https://github.com/<YOUR_GITHUB_USERNAME>/<YOUR_REPOSITORY_NAME>.git
git push -u origin main
```

---

## Step 3: Deploy to Vercel

1. Log in to [Vercel Dashboard](https://vercel.com/dashboard).
2. Click **Add New...** → **Project**.
3. Select your GitHub repository (`cashflow-app`) and click **Import**.
4. In the **Configure Project** screen:
   - **Framework Preset**: Other (automatically detected)
   - **Root Directory**: `./` (leave as default if your repo root is `cashflow-app`)
   - **Build Command**: `npm run build` (detected from `package.json` / `vercel.json`)
   - **Output Directory**: `public` (detected from `vercel.json`)

---

## Step 4: Configure Environment Variables in Vercel

Before clicking Deploy, expand the **Environment Variables** section in Vercel and add the following:

| Variable Name | Value / Description |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Your Neon PostgreSQL connection string (`postgresql://...`) |
| `GOOGLE_CLIENT_ID` | Your Google OAuth Client ID from Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | Your Google OAuth Client Secret |
| `GOOGLE_REDIRECT_URI` | `https://<YOUR_APP_NAME>.vercel.app/auth/callback` *(see Note below)* |
| `ALLOWED_ORIGINS` | `https://<YOUR_APP_NAME>.vercel.app` *(your Vercel domain)* |
| `GEMINI_API_KEY` | Your Gemini API key from AI Studio |
| `GEMINI_MODEL` | `gemini-2.5-flash` |
| `JWT_SECRET` | Random 32+ character string (e.g., `cf_prod_jwt_super_secret_key_random_32char`) |
| `JWT_REFRESH_SECRET` | Another random 32+ character string |
| `COOKIE_SECRET` | Random 16+ character string |
| `COOKIE_SECURE` | `true` *(since Vercel is HTTPS)* |

> [!NOTE]
> When first creating your project, Vercel suggests a domain like `cashflow-app-alpha.vercel.app`. You can enter that domain for `GOOGLE_REDIRECT_URI` and `ALLOWED_ORIGINS`. If your domain changes later, you can easily update these variables in **Project Settings → Environment Variables** and redeploy.

5. Click **Deploy**! Vercel will build the project and output your live production URL in under 60 seconds.

---

## Step 5: Update Google Cloud Console Authorized Redirect URI

For Google Login and Gmail Sync to function on your live site:

1. Open [Google Cloud Console Credentials](https://console.cloud.google.com/apis/credentials).
2. Click on your **OAuth 2.0 Client ID**.
3. Under **Authorized JavaScript origins**, add:
   - `https://<YOUR_APP_NAME>.vercel.app`
4. Under **Authorized redirect URIs**, add:
   - `https://<YOUR_APP_NAME>.vercel.app/auth/callback`
5. Click **Save**.

---

## Alternative: Frontend on Vercel + Backend on Render

If you prefer to keep the backend running 24/7 with zero serverless timeouts and without setting up a PostgreSQL database:

1. **Deploy Backend to Render.com**:
   - Create a free Web Service on [Render.com](https://render.com) pointing to `backend/`.
   - Build Command: `npm install && npm run build`
   - Start Command: `npm start`
   - You get a URL like `https://cashflow-backend.onrender.com`.
2. **Deploy Frontend to Vercel**:
   - In `frontend/index.html` (inside the `<head>` tag), set:
     ```html
     <script>window.CASHFLOW_API_BASE = 'https://cashflow-backend.onrender.com';</script>
     ```
   - Deploy `frontend/` to Vercel as a static site.
   - CashFlow's dynamic API client will automatically direct all requests to your Render backend!

---

## Local Development (Unchanged)

Your local development workflow remains completely unaffected:
- **`start-app.bat`** continues to run locally on ports 3000 & 3001 using the zero-config local relational database.
- You can develop offline and test features locally at any time.
