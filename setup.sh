#!/bin/sh
set -eu
cd "$(dirname "$0")"
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/workspace" -w /workspace node:22-alpine node scripts/setup-env.mjs
mkdir -p data
docker compose up --build -d
docker compose run --rm --no-deps --user "$(id -u):$(id -g)" -v "$PWD/data:/app/data" app node --import tsx scripts/admin.ts
echo 'Geza: http://localhost:3080 — credentials: data/admin-access.txt'
