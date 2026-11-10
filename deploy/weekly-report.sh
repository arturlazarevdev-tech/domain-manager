#!/bin/sh
set -eu
cd /opt/domain-manager
exec docker compose --env-file .env.production -f compose.production.yml exec -T web node --import tsx src/weekly-report.ts
