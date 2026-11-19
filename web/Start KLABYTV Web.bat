@echo off
rem KLABYTV web version (Windows): double-click to start, then use it at http://localhost:8080
cd /d "%~dp0"
where node >nul 2>nul || (echo KLABYTV web needs Node.js ^(LTS^): https://nodejs.org & pause & exit /b 1)
start "" http://localhost:8080
node src\web\server.js %*
