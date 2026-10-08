#!/usr/bin/env bash
# Backup Postgres (pg_dump custom format) + MinIO bucket (plain files via mc mirror)
# into $BACKUP_DIR/<timestamp>/, keep the last $KEEP_DAYS days.
# Runs against the docker containers on this machine; reads creds from apps/server/.env.
# ponytail: local disk only — point BACKUP_DIR at an external/iCloud/synced folder for
# off-machine safety; add rclone/S3 upload when the machine itself is the risk.
#
# Restore:
#   PGPASSWORD=… docker exec -i -e PGPASSWORD postgres pg_restore -U … -d … --clean --if-exists < db.dump
#   docker cp minio/. minio:/tmp/restore && docker exec minio mc mirror /tmp/restore local/<bucket>
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
set -a; . "$ROOT/apps/server/.env"; set +a

BACKUP_DIR="${BACKUP_DIR:-$HOME/Backups/content-generator}"
KEEP_DAYS="${KEEP_DAYS:-14}"
PG_CONTAINER="${PG_CONTAINER:-postgres}"
MINIO_CONTAINER="${MINIO_CONTAINER:-minio}"
BUCKET="${MINIO_BUCKET:-content-generator}"

DEST="$BACKUP_DIR/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$DEST"

# secrets passed by NAME (-e VAR) — values never appear in argv / `ps`
export PGPASSWORD="$DB_PASSWORD" MC_HOST_cgbk="http://$MINIO_ACCESS_KEY:$MINIO_SECRET_KEY@127.0.0.1:9000"
docker exec -e PGPASSWORD "$PG_CONTAINER" \
  pg_dump -U "$DB_USER" -d "$DB_NAME" -Fc > "$DEST/db.dump"

# mc inside the minio container; MinIO's on-disk layout is NOT plain files, so mirror via the API
# MC_HOST_<alias> env = ephemeral alias (no creds persisted in the container's mc config)
TMP="/tmp/cg-backup-$$"
trap 'docker exec "$MINIO_CONTAINER" rm -rf "$TMP" >/dev/null 2>&1 || true' EXIT
docker exec -e MC_HOST_cgbk "$MINIO_CONTAINER" mc mirror --quiet "cgbk/$BUCKET" "$TMP" >/dev/null
docker cp -q "$MINIO_CONTAINER:$TMP" "$DEST/minio"

# sanity: a dump that small is a failed dump
[ "$(wc -c < "$DEST/db.dump")" -gt 1024 ] || { echo "backup: db.dump suspiciously small" >&2; exit 1; }

find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -mtime +"$KEEP_DAYS" -exec rm -rf {} +
echo "backup ok: $DEST ($(du -sh "$DEST" | cut -f1))"
