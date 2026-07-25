#!/bin/sh
# Backup PostgreSQL database — retention 7 days
set -e
DB_URL="${DATABASE_URL:?DATABASE_URL must be set}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS=7

mkdir -p "$BACKUP_DIR"
TIMESTAMP=$(date -u +%Y%m%dT%H%M%SZ)
BACKUP_FILE="$BACKUP_DIR/polywatch-$TIMESTAMP.sql.gz"

pg_dump "$DB_URL" | gzip > "$BACKUP_FILE"
echo "Backup created: $BACKUP_FILE"

find "$BACKUP_DIR" -name 'polywatch-*.sql.gz' -mtime +$RETENTION_DAYS -delete
echo "Old backups cleaned (retention: ${RETENTION_DAYS}d)"