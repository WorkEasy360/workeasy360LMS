@echo off
rem Starts the WorkEasy360LMS dev server and opens the app.
start "" "http://localhost:5173/"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1" -Port 5173
