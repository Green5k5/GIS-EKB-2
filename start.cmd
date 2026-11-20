@echo off
setlocal
chcp 65001 >nul
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\start-local.ps1" %*
if errorlevel 1 (
  pause
  exit /b 1
)
