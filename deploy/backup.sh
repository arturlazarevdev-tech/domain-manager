#!/bin/sh
set -eu
cd /opt/domain-manager
umask 077
mkdir -p backups
backup_path="backups/domain-manager-$(date -u +%Y%m%dT%H%M%SZ).dump"
docker compose --env-file .env.production -f compose.production.yml exec -T postgres pg_dump -U domain -d domain_manager -Fc > "$backup_path"
test -s "$backup_path"
find backups -type f -name 'domain-manager-*.dump' -mtime +14 -delete
printf 'Database backup saved: %s\n' "$backup_path"
