#!/usr/bin/env bash
# Backs up the database (pg_dump custom format) and uploaded files, keeping the last $KEEP backups.
#   ./deploy/backup.sh [backup-dir]        (run from the folder with docker-compose.yml; cron-friendly)
set -euo pipefail
DIR="${1:-./backups}"
KEEP="${KEEP:-14}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$DIR"

docker compose exec -T db pg_dump -U taskforge -d taskforge --format=custom --no-owner > "$DIR/db-$STAMP.dump"
docker compose exec -T backend tar -C /data -czf - uploads > "$DIR/uploads-$STAMP.tar.gz"

# A dump that can't be listed is not a backup
docker compose exec -T db pg_restore --list < "$DIR/db-$STAMP.dump" > /dev/null
tar -tzf "$DIR/uploads-$STAMP.tar.gz" > /dev/null

ls -1t "$DIR"/db-*.dump 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm --
ls -1t "$DIR"/uploads-*.tar.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm --
echo "Backed up to $DIR/db-$STAMP.dump and $DIR/uploads-$STAMP.tar.gz"
