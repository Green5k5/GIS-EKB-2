#!/usr/bin/env bash
set -euo pipefail

mode=${1:-}
if (( $# > 1 )) || [[ -n "$mode" && "$mode" != --setup-only ]]; then
  printf 'Использование: bash start.sh [--setup-only]\n' >&2
  exit 2
fi

cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

if ! command -v node >/dev/null || ! node -e '
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 15)) process.exit(1);
  require("node:sqlite");
' >/dev/null 2>&1; then
  printf 'Нужен Node.js 22.15 или новее с поддержкой node:sqlite. Проверьте node --version.\n' >&2
  exit 1
fi

if ! command -v npm >/dev/null; then
  printf 'Команда npm не найдена. Установите npm для используемой версии Node.js.\n' >&2
  exit 1
fi

if [[ "$mode" == --setup-only || package-lock.json -nt node_modules/.package-lock.json ]] || ! node --input-type=module -e '
  import fs from "node:fs";
  const { dependencies } = JSON.parse(fs.readFileSync("package.json", "utf8"));
  await Promise.all(Object.keys(dependencies).map(name => import(name)));
' >/dev/null 2>&1; then
  npm ci --omit=dev --include=optional
fi

node tools/configure-local.mjs
npm run migrate

if [[ "$mode" != --setup-only ]]; then
  exec node server/server.js
fi
