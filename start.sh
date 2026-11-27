#!/usr/bin/env bash
set -euo pipefail

mode=${1:-}
if (( $# > 1 )) || [[ -n "$mode" && "$mode" != --setup-only ]]; then
  printf 'Использование: bash start.sh [--setup-only]\n' >&2
  exit 2
fi

cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
php_bin=${PHP_BIN:-php}
if ! command -v "$php_bin" >/dev/null; then
  printf 'Нужен PHP CLI 8.3+. Укажите путь к нему в PHP_BIN.\n' >&2
  exit 1
fi

"$php_bin" server/php/setup.php

if [[ "$mode" != --setup-only ]]; then
  exec "$php_bin" -S "${HOST:-127.0.0.1}:${PORT:-3000}" -t public public/index.php
fi
