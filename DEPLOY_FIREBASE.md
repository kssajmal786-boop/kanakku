# Deploying CashFlow Backend on Firebase App Hosting

This guide explains how to host your CashFlow backend on **Firebase App Hosting** using automatic GitHub CI/CD.

---

## Why Firebase App Hosting for the Backend?

- **Powered by Google Cloud Run**: Runs your Express Node.js application in managed server containers.
- **High Timeout Limits**: 300+ second execution time, ensuring Gmail synchronization and AI batch extractions never time out.
- **Automatic CI/CD**: Automatically builds and redeploys every time you push code to GitHub (`main` branch).
- **Free Quotas**: Generous monthly free tier (2 million invocations, CPU/RAM allowances, and free SSL certificate).

---

## Step 1: Open Firebase App Hosting

1. Open the **[Firebase Console](https://console.firebase.google.com/)**.
2. Select your Firebase project (or click **Add project** to create one).
3. In the left navigation sidebar, navigate to **Build** → **App Hosting**.
4. Click **Get started**.

---

## Step 2: Connect Your GitHub Repository

1. When prompted, click **Connect GitHub**.
2. Grant Firebase access to your GitHub account (`kssajmal786-boop`).
3. Select your repository: **`kssajmal786-boop/kanakku`**.
4. Click **Next**.

---

## Step 3: Configure Deployment Settings

In the **Deployment settings** section:

| Field | Value |
|---|---|
| **Backend ID** | `kanakku-backend` (or any unique name) |
| **Root directory** | `backend` *(⚠️ Important: Type `backend` so it builds the server)* |
| **Live branch** | `main` |

---

## Step 4: Add Environment Variables in Firebase

In the **Environment** section (or under **Settings → Environment** after setup), add the following variables:

| Variable Name | Value / Description |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Your Neon PostgreSQL connection string (`postgresql://...`) |
| `GOOGLE_CLIENT_ID` | Your Google OAuth Client ID |
| `GOOGLE_CLIENT_SECRET` | Your Google OAuth Client Secret |
| `GOOGLE_REDIRECT_URI` | `https://<YOUR_APP_NAME>.vercel.app/auth/callback` *(or your frontend callback URL)* |
| `ALLOWED_ORIGINS` | `*` *(or your frontend URL e.g. `https://<YOUR_APP_NAME>.vercel.app`)* |
| `GEMINI_API_KEY` | Your Gemini API Key from Google AI Studio |
| `GEMINI_MODEL` | `gemini-2.5-flash` |
| `JWT_SECRET` | 32+ character random string |
| `JWT_REFRESH_SECRET` | 32+ character random string |
| `COOKIE_SECRET` | 16+ character random string |
| `COOKIE_SECURE` | `true` |

---

## Step 5: Finish and Deploy

1. Click **Finish and Deploy**.
2. Firebase will launch a Cloud Build to compile your TypeScript backend and deploy it to Cloud Run.
3. Once the rollout finishes (usually 1–2 minutes), Firebase will give you a live HTTPS URL:
   ```
   https://kanakku-backend-<hash>-<region>.run.app
   ```
   or
   ```
   https://<backend-id>.<project-id>.<region>.hosted.app
   ```

---

## Step 6: Verify Backend Health

Visit your live URL followed by `/health` in your browser:
```
https://<YOUR_FIREBASE_BACKEND_URL>/health
```

You should receive a JSON response:
```json
{
  "status": "ok",
  "timestamp": "...",
  "uptime": 12.34
}
```

---

## Step 7: Connecting Your Frontend (on Vercel)

Once your Firebase backend is live:
1. In your frontend repository / Vercel project, set `window.CASHFLOW_API_BASE`:
   - In `frontend/index.html` (inside `<head>`):
     ```html
     <script>window.CASHFLOW_API_BASE = 'https://<YOUR_FIREBASE_BACKEND_URL>';</script>
     ```
2. In Google Cloud Console, ensure:
   - **Authorized JavaScript origins** contains your frontend URL (e.g. `https://<YOUR_APP>.vercel.app`).
   - **Authorized redirect URIs** contains `https://<YOUR_APP>.vercel.app/auth/callback` and `https://<YOUR_FIREBASE_BACKEND_URL>/auth/callback`.
