@echo off
title sideline live
cd /d "%~dp0"
rem Keeps the site running: if it ever stops, it starts again after 5 seconds.
:loop
call npm run dev
echo.
echo sideline live stopped. Restarting in 5 seconds (close this window to stop it for good)...
timeout /t 5 /nobreak >nul
goto loop
