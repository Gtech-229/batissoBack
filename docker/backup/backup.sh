#!/bin/sh
# Bâtisso backups (feature 18c). Each run writes two encrypted files to
# /backups, named by the run's UTC time:
#   batisso-db-YYYYMMDD-HHMM.dump.enc      pg_dump -Fc (restore with pg_restore)
#   batisso-files-YYYYMMDD-HHMM.tar.gz.enc the private photo and document folders
# then deletes backup files older than 14 days.
#
#   backup.sh once               one backup, then exit (non-zero on failure)
#   backup.sh schedule           one backup every day at 01:00 UTC (the
#                                container's job)
#   backup.sh restore-db <stamp> restore batisso-db-<stamp>.dump.enc (API
#                                stopped); the previous database is kept
#
# Secrets come from the environment only (BACKUP_PASSPHRASE, POSTGRES_*): they
# never appear on a command line or in the log.
set -eu
umask 077

BACKUP_DIR=/backups
STORAGE_DIR=/app/storage
KEEP_DAYS=14

log() {
  echo "[backup] $(date -u +%Y-%m-%dT%H:%M:%SZ) $*"
}

check_passphrase() {
  length=$(printf %s "${BACKUP_PASSPHRASE:-}" | wc -c)
  if [ "$length" -lt 20 ]; then
    log "refused: BACKUP_PASSPHRASE must be set and at least 20 characters long (.env.backup.production)"
    exit 1
  fi
}

# AES-256 with a key derived from the passphrase, read from the environment.
encrypt() {
  openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_PASSPHRASE
}

# Runs a pipeline into "$1.partial" and renames it only when every command of
# the pipeline succeeded, so a failed run never leaves a file that looks done.
write_atomically() {
  target=$1
  shift
  if (set -o pipefail; "$@" | encrypt >"$target.partial"); then
    mv "$target.partial" "$target"
  else
    rm -f "$target.partial"
    return 1
  fi
}

dump_database() {
  PGPASSWORD=$POSTGRES_PASSWORD pg_dump -h db -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc
}

archive_files() {
  tar -czf - -C "$STORAGE_DIR" .
}

run_once() {
  stamp=$(date -u +%Y%m%d-%H%M)
  db_file="$BACKUP_DIR/batisso-db-$stamp.dump.enc"
  files_file="$BACKUP_DIR/batisso-files-$stamp.tar.gz.enc"

  if ! write_atomically "$db_file" dump_database; then
    log "failed: database dump"
    return 1
  fi
  if ! write_atomically "$files_file" archive_files; then
    log "failed: files archive"
    return 1
  fi

  # Only backup files, only after a successful run: -mtime +13 is 14 days or more.
  deleted=$(find "$BACKUP_DIR" -maxdepth 1 -type f \
    \( -name 'batisso-db-*.dump.enc' -o -name 'batisso-files-*.tar.gz.enc' \) \
    -mtime +$((KEEP_DAYS - 1)) -print -delete | wc -l)
  # Leftovers of a run killed mid-write (F-74); a day old, so a run still in
  # progress is never touched.
  partials=$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'batisso-*.partial' \
    -mtime +0 -print -delete | wc -l)
  deleted=$((deleted + partials))

  log "done: $(basename "$db_file") ($(wc -c <"$db_file") bytes), $(basename "$files_file") ($(wc -c <"$files_file") bytes), $deleted old files deleted"
}

# Checks the clock every minute and runs once per UTC day, at the first check
# during the 01:00 hour (a check can never step over a whole hour, F-73), before
# the API's 02:00 balance check. A failed run is logged; the next day runs again.
run_schedule() {
  trap 'exit 0' TERM INT
  last_day=""
  log "scheduled: one backup every day at 01:00 UTC"
  while :; do
    if [ "$(date -u +%H)" = "01" ] && [ "$(date -u +%Y%m%d)" != "$last_day" ]; then
      last_day=$(date -u +%Y%m%d)
      run_once || log "the next backup runs tomorrow at 01:00 UTC"
    fi
    # In the background, so a stop signal ends the wait at once.
    sleep 60 &
    wait $!
  done
}

psql_admin() {
  PGPASSWORD=$POSTGRES_PASSWORD psql -h db -U "$POSTGRES_USER" -d postgres \
    -v ON_ERROR_STOP=1 -qAt "$@"
}

# Restores a database backup without touching the current database until the
# restore has fully succeeded (F-71): into a new database first, with every
# object in one transaction, then both databases are renamed in one
# transaction. The previous database stays, renamed, until the operator drops
# it. It refuses while the API container runs, and the rename fails, changing
# nothing, while any other session is still connected.
restore_db() {
  stamp=$1
  file="$BACKUP_DIR/batisso-db-$stamp.dump.enc"
  if [ ! -f "$file" ]; then
    log "refused: $(basename "$file") not found in $BACKUP_DIR"
    return 1
  fi
  # Docker's DNS answers for the api service only while its container runs; an
  # idle API holds no database connection, so the rename alone cannot tell.
  if getent hosts api >/dev/null 2>&1; then
    log "refused: the API is running; stop it first (stop api nginx); $POSTGRES_DB is unchanged"
    return 1
  fi
  target="${POSTGRES_DB}_restore"
  kept="${POSTGRES_DB}_before_$(date -u +%Y%m%d_%H%M%S)"

  psql_admin -c "DROP DATABASE IF EXISTS \"$target\"" -c "CREATE DATABASE \"$target\""
  if ! (set -o pipefail
    openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE -in "$file" |
      PGPASSWORD=$POSTGRES_PASSWORD pg_restore --exit-on-error --single-transaction \
        --no-owner -h db -U "$POSTGRES_USER" -d "$target"); then
    psql_admin -c "DROP DATABASE IF EXISTS \"$target\""
    log "failed: restore of $(basename "$file") (wrong BACKUP_PASSPHRASE or a damaged file); $POSTGRES_DB is unchanged"
    return 1
  fi

  if ! psql_admin -1 \
    -c "ALTER DATABASE \"$POSTGRES_DB\" RENAME TO \"$kept\"" \
    -c "ALTER DATABASE \"$target\" RENAME TO \"$POSTGRES_DB\""; then
    psql_admin -c "DROP DATABASE IF EXISTS \"$target\""
    log "refused: $POSTGRES_DB is in use by another session; close it first ($POSTGRES_DB is unchanged)"
    return 1
  fi
  log "restored: $(basename "$file") is now $POSTGRES_DB; the previous database is kept as $kept (drop it once you are sure)"
}

mode=${1:-schedule}
check_passphrase
case "$mode" in
  once)
    run_once
    ;;
  schedule)
    run_schedule
    ;;
  restore-db)
    if [ $# -lt 2 ]; then
      log "usage: backup.sh restore-db <YYYYMMDD-HHMM>"
      exit 2
    fi
    restore_db "$2"
    ;;
  *)
    log "unknown mode: $mode (expected once, schedule or restore-db)"
    exit 2
    ;;
esac
