#!/bin/sh
set -eu
mkdir -p backups
file="backups/geza-$(date +%Y%m%d-%H%M%S).dump"
docker compose exec -T db pg_dump -U geza -Fc geza > "$file"
echo "Backup: $file"
echo 'Keep a separate secure copy of .env as well.'
