@echo off
title CashFlow App Launcher
color 0A

echo.
echo  ██████╗ █████╗ ███████╗██╗  ██╗███████╗██╗      ██████╗ ██╗    ██╗
echo ██╔════╝██╔══██╗██╔════╝██║  ██║██╔════╝██║     ██╔═══██╗██║    ██║
echo ██║     ███████║███████╗███████║█████╗  ██║     ██║   ██║██║ █╗ ██║
echo ██║     ██╔══██║╚════██║██╔══██║██╔══╝  ██║     ██║   ██║██║███╗██║
echo ╚██████╗██║  ██║███████║██║  ██║██║     ███████╗╚██████╔╝╚███╔███╔╝
echo  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝╚═╝     ╚══════╝ ╚═════╝  ╚══╝╚══╝
echo.
echo  Personal Finance App — Starting servers...
echo  ─────────────────────────────────────────

:: Check if .env exists for backend
if not exist "%~dp0backend\.env" (
  echo.
  echo  [WARNING] backend\.env not found.
  echo  Copy backend\.env.example to backend\.env and fill in your API keys.
  echo  Gmail sync and AI chat require valid keys.
  echo  Local-only features (transactions, reports, PDF) work without keys.
  echo.
  pause
)

:: Start backend in a new window
echo  [1/2] Starting backend API (port 3001)...
start "CashFlow Backend" cmd /k "cd /d "%~dp0backend" && npm run dev"

:: Wait a moment for backend to initialize
timeout /t 2 /nobreak >nul

:: Start frontend in a new window
echo  [2/2] Starting frontend PWA (port 3000)...
start "CashFlow Frontend" cmd /k "cd /d "%~dp0frontend" && node server.js"

:: Wait for frontend to start
timeout /t 2 /nobreak >nul

:: Open browser
echo.
echo  [✓] Opening http://localhost:3000 in your browser...
start "" "http://localhost:3000"

echo.
echo  ─────────────────────────────────────────
echo  CashFlow is running!
echo.
echo  Frontend:  http://localhost:3000
echo  Backend:   http://localhost:3001
echo.
echo  To stop: close the two server windows, or press Ctrl+C in each.
echo  ─────────────────────────────────────────
echo.
echo  IMPORTANT: Always use http://localhost:3000
echo  Do NOT open index.html directly from File Explorer.
echo  (ES modules require a real HTTP server — file:// won't work)
echo.
pause
