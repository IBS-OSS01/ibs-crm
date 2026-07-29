@echo off
cls
echo.
echo ============================================================
echo    India Business Suite M1 - Fixed Setup
echo ============================================================
echo.
echo [1/2] Installing dependencies...
call npm install
if errorlevel 1 (
    echo ERROR: npm install failed
    pause
    exit /b 1
)
echo.
echo [2/2] Starting development server...
echo.
echo Open browser at: http://localhost:5173/
echo Press Ctrl+C to stop the server.
echo.
call npm run dev
