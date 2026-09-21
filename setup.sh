#!/bin/sh
set -eu
cd "$(dirname "$0")"
mode="${1:-production}"
case "$mode" in production|demo) ;; *) echo "Use production or demo"; exit 1;; esac
flag=""
if [ "$mode" = demo ]; then flag="--demo"; fi
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/workspace" -w /workspace node:22-alpine node scripts/setup-env.mjs $flag
mkdir -p data
if [ "$mode" = demo ]; then
  docker compose --env-file .env.demo -p geza-demo up --build -d
  echo "Demo: http://localhost:3081 — admin / admin"
else
  docker compose up --build -d
fi
echo 'Geza: http://localhost:3080 — first admin: http://localhost:3080/login'
