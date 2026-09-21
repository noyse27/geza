param([ValidateSet('production','demo')][string]$Mode = 'production')
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$demoArgs = @()
$composeArgs = @()
if ($Mode -eq 'demo') { $demoArgs = @('--demo'); $composeArgs = @('--env-file', '.env.demo', '-p', 'geza-demo') }
docker run --rm --mount "type=bind,source=$PSScriptRoot,target=/workspace" --workdir /workspace node:22-alpine node scripts/setup-env.mjs @demoArgs
if ($LASTEXITCODE -ne 0) { throw 'Configuration failed.' }
New-Item -ItemType Directory -Path data -Force | Out-Null
docker compose @composeArgs up --build -d
if ($LASTEXITCODE -ne 0) { throw 'Starting Geza failed.' }
if ($Mode -eq 'demo') { Write-Output 'Demo: http://localhost:3081 — admin / admin' } else { Write-Output 'Geza: http://localhost:3080' }
