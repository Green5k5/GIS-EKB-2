@echo off
setlocal
set "ROOT=%~dp0.."
set "SERVER=%~dp0llama-win-cpu-x64\llama-server.exe"
set "MODEL=%ROOT%\models\qwen3-4b-iq3_m.gguf"

if not exist "%SERVER%" (
  echo Не найден llama-server: %SERVER%
  pause
  exit /b 1
)
if not exist "%MODEL%" (
  echo Не найдена модель: %MODEL%
  pause
  exit /b 1
)

"%SERVER%" --model "%MODEL%" --alias kh-way-local --host 127.0.0.1 --port 8080 --ctx-size 4096 --threads 4 --parallel 1 --no-webui --jinja
