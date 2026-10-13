@echo off
taskkill /IM llama-server.exe /F >nul 2>&1
if errorlevel 1 (
  echo Локальная модель не была запущена.
) else (
  echo Локальная модель остановлена.
)
