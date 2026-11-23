#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODEL="$ROOT/models/qwen3-4b-iq3_m.gguf"
LLAMA_SERVER="${LLAMA_SERVER:-llama-server}"
if [[ ! -f "$MODEL" ]]; then echo "Модель не найдена: $MODEL" >&2; exit 1; fi
exec "$LLAMA_SERVER" --model "$MODEL" --alias kh-way-local --host 127.0.0.1 --port 8080 --ctx-size 4096 --threads "${LLAMA_THREADS:-4}" --parallel 1 --jinja
