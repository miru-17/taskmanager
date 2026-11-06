#!/usr/bin/env bash
# Restores a backup made by backup.sh. This REPLACES the current data.
#   ./deploy/restore.sh backups/db-20261106T120000Z.dump backups/uploads-20261106T120000Z.tar.gz
set -euo pipefail
DB="${1:?database dump file}"
FILES="${2:?uploads archive}"
read -r -p "This replaces all TaskForge data with the backup. Type RESTORE to continue: " ok
[ "$ok" = "RESTORE" ] || { echo "Cancelled."; exit 1; }

docker compose stop backend
docker compose exec -T db pg_restore -U taskforge -d taskforge --clean --if-exists --no-owner --single-transaction < "$DB"
docker compose run --rm -T --entrypoint sh backend -c 'rm -rf /data/uploads/* && tar -C /data -xzf -' < "$FILES"
docker compose start backend
echo "Restored. Pending migrations (if the backup is older) are applied as the backend starts."
