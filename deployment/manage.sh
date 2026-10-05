#!/usr/bin/env bash
set -Eeuo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
umask 077

compose() { docker compose --env-file .env -f compose.yaml "$@"; }
require_config() {
  [[ -f .env ]] || { echo 'Run bash manage.sh init first.' >&2; exit 1; }
  if grep -Eq '=(CHANGE_ME|track.example.com)$' .env; then
    echo 'Edit .env: set APP_DOMAIN and replace placeholder secrets.' >&2
    exit 1
  fi
  compose config --quiet
}

case "${1:-help}" in
  init)
    [[ ! -e .env ]] || { echo '.env already exists; left unchanged.'; exit 0; }
    command -v openssl >/dev/null
    cp .env.example .env
    for key in DB_PASSWORD MYSQL_ROOT_PASSWORD JWT_SECRET; do
      sed -i "s/^${key}=CHANGE_ME$/${key}=$(openssl rand -hex 32)/" .env
    done
    chmod 600 .env
    echo 'Created .env with random secrets. Edit APP_DOMAIN and SMTP settings.'
    ;;
  deploy)
    require_config
    # Build before downtime. Migrate with all application writers stopped.
    compose build api web
    compose up -d --wait --wait-timeout 300 db
    compose stop web api worker
    compose run --rm --no-deps -T api node dist/database/migrate.js
    compose up -d --wait --wait-timeout 180
    compose ps
    ;;
  admin)
    require_config
    read -r -p 'Admin email: ' ADMIN_EMAIL
    read -r -p 'Full name: ' ADMIN_NAME
    read -r -s -p 'Password (8–72 UTF-8 bytes): ' ADMIN_PASSWORD
    printf '\n'
    export ADMIN_EMAIL ADMIN_NAME ADMIN_PASSWORD
    compose run --rm --no-deps -T -e ADMIN_EMAIL -e ADMIN_NAME -e ADMIN_PASSWORD api node deployment/create-admin.mjs
    unset ADMIN_PASSWORD
    ;;
  status|logs|stop)
    require_config
    case "$1" in
      status) compose ps ;;
      logs) compose logs --tail 100 -f "${@:2}" ;;
      stop) compose stop ;;
    esac
    ;;
  backup)
    require_config
    mkdir -p backups
    destination="backups/$(date -u +%Y%m%dT%H%M%SZ)"
    [[ ! -e "$destination" ]] || { echo 'Backup already exists for this second.' >&2; exit 1; }
    partial=$(mktemp -d backups/.partial-XXXXXX)
    running_text=$(compose ps --services --status running api worker)
    running=()
    if [[ -n "$running_text" ]]; then mapfile -t running <<< "$running_text"; fi
    resume() { if ((${#running[@]})); then compose start "${running[@]}"; fi; }
    trap resume EXIT
    compose stop api worker
    compose exec -T db sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysqldump -uroot --single-transaction --routines --triggers --events --no-tablespaces --set-gtid-purged=OFF --add-drop-database --databases "$MYSQL_DATABASE"' | gzip > "$partial/database.sql.gz"
    compose run --rm --no-deps -T --user root api tar -czf - -C /data/delivery-photos . > "$partial/photos.tar.gz"
    mv -- "$partial" "$destination"
    echo "Backup saved to $PWD/$destination (copy it off the VPS)."
    ;;
  restore)
    require_config
    [[ $# -eq 3 && "$3" == --confirm-replace ]] || { echo 'Usage: bash manage.sh restore BACKUP_DIR --confirm-replace' >&2; exit 1; }
    backup=$2
    [[ -f "$backup/database.sql.gz" && -f "$backup/photos.tar.gz" ]] || { echo 'Backup must contain database.sql.gz and photos.tar.gz.' >&2; exit 1; }
    gzip -t "$backup/database.sql.gz"
    tar -tzf "$backup/photos.tar.gz" >/dev/null
    compose stop web api worker
    compose up -d --wait --wait-timeout 300 db
    gzip -dc "$backup/database.sql.gz" | compose exec -T db sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot'
    compose run --rm --no-deps -T --user root api node --input-type=module -e 'import {readdir,rm} from "node:fs/promises"; for(const name of await readdir("/data/delivery-photos")) await rm(`/data/delivery-photos/${name}`,{recursive:true,force:true});'
    compose run --rm --no-deps -T --user root api tar -xzf - -C /data/delivery-photos < "$backup/photos.tar.gz"
    compose run --rm --no-deps -T --user root api chown -R node:node /data/delivery-photos
    compose run --rm --no-deps -T api node --input-type=module -e 'import {cleanupPhotos} from "./dist/features/delivery/photos.js"; import {db} from "./dist/database/connection.js"; try {await cleanupPhotos();} finally {await db.end();}'
    echo 'Restored. Web/API/worker remain stopped. Reconcile restored email outbox before running deploy.'
    ;;
  *)
    echo 'Usage: bash manage.sh {init|deploy|admin|status|logs [SERVICE]|stop|backup|restore BACKUP_DIR --confirm-replace}'
    ;;
esac
