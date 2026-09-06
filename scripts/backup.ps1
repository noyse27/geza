$ErrorActionPreference = 'Stop'
$backupDirectory = Join-Path $PSScriptRoot '../backups'
New-Item -ItemType Directory -Path $backupDirectory -Force | Out-Null
$backupName = 'geza-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.dump'
docker compose exec -T db pg_dump -U geza -Fc -f /tmp/geza-backup.dump geza
if ($LASTEXITCODE -ne 0) { throw 'Database backup failed.' }
docker compose cp db:/tmp/geza-backup.dump (Join-Path $backupDirectory $backupName)
if ($LASTEXITCODE -ne 0) { throw 'Copying database backup failed.' }
Get-FileHash -LiteralPath (Join-Path $backupDirectory $backupName) -Algorithm SHA256
Write-Output 'Keep a separate secure copy of .env as well: it contains the encryption key for provider credentials.'
