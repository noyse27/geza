$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
docker run --rm --mount "type=bind,source=$PSScriptRoot,target=/workspace" --workdir /workspace node:22-alpine node scripts/setup-env.mjs
if ($LASTEXITCODE -ne 0) { throw 'Configuration failed.' }
New-Item -ItemType Directory -Path data -Force | Out-Null
docker compose up --build -d
if ($LASTEXITCODE -ne 0) { throw 'Starting Geza failed.' }
$dataPath = Join-Path $PSScriptRoot 'data'
docker compose run --rm --no-deps --volume "${dataPath}:/app/data" app node --import tsx scripts/admin.ts
if ($LASTEXITCODE -ne 0) { throw 'Admin setup failed.' }
Write-Output 'Geza: http://localhost:3080 — credentials: data/admin-access.txt'
