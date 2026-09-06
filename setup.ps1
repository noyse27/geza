$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
docker run --rm --mount "type=bind,source=$PSScriptRoot,target=/workspace" --workdir /workspace node:22-alpine node scripts/setup-env.mjs
if ($LASTEXITCODE -ne 0) { throw 'Configuration failed.' }
New-Item -ItemType Directory -Path data -Force | Out-Null
docker compose up --build -d
if ($LASTEXITCODE -ne 0) { throw 'Starting Geza failed.' }
Write-Output 'Geza: http://localhost:3080 — first admin: http://localhost:3080/login'
