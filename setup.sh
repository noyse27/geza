#!/bin/sh
set -eu
cd "$(dirname "$0")"
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/workspace" -w /workspace node:22-alpine node scripts/setup-env.mjs
mkdir -p data
docker compose up --build -d
echo 'Geza: http://localhost:3080 — first admin: http://localhost:3080/login'
