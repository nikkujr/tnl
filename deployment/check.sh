#!/usr/bin/env bash
# Offline failure-path check: never contacts Docker or a real database.
set -Eeuo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
scratch=$(mktemp -d)
trap 'rm -rf -- "$scratch"' EXIT
cp manage.sh .env.example compose.yaml "$scratch/"
mkdir "$scratch/bin"
export DEPLOY_CHECK_LOG="$scratch/docker.log"
cat > "$scratch/bin/docker" <<'EOF'
#!/usr/bin/env bash
set -eu
printf '%s\n' "$*" >> "$DEPLOY_CHECK_LOG"
shift 5 # compose --env-file .env -f compose.yaml
case "$*" in
  'ps --services --status running api worker') echo api ;;
  *dist/database/migrate.js*) [[ "${DEPLOY_CHECK_FAIL:-}" != migrate ]] ;;
  *dist/database/seed.js*) [[ "${DEPLOY_CHECK_FAIL:-}" != seed ]] ;;
  'exec -T db sh -c '*) echo 'fake database dump' ;;
  *'tar -czf '*) [[ "${DEPLOY_CHECK_FAIL:-}" != photos ]] ;;
esac
EOF
chmod +x "$scratch/bin/docker"
export PATH="$scratch/bin:$PATH"
cd "$scratch"
bash manage.sh init >/dev/null
test "$(grep -Ec '^(DB_PASSWORD|MYSQL_ROOT_PASSWORD|JWT_SECRET)=[a-f0-9]{64}$' .env)" -eq 3
before=$(cat .env)
bash manage.sh init >/dev/null
test "$(cat .env)" = "$before"
if bash manage.sh deploy >/dev/null 2>&1; then echo 'Placeholder domain accepted' >&2; exit 1; fi
sed -i 's/track.example.com/track.test/' .env
: > "$DEPLOY_CHECK_LOG"
if DEPLOY_CHECK_FAIL=migrate bash manage.sh deploy >/dev/null 2>&1; then echo 'Migration failure ignored' >&2; exit 1; fi
grep -q 'stop web api worker' "$DEPLOY_CHECK_LOG"
grep -q 'dist/database/migrate.js' "$DEPLOY_CHECK_LOG"
! grep -q 'up -d --wait --wait-timeout 180' "$DEPLOY_CHECK_LOG"
: > "$DEPLOY_CHECK_LOG"
bash manage.sh deploy >/dev/null
grep -q 'up -d --wait --wait-timeout 180' "$DEPLOY_CHECK_LOG"
: > "$DEPLOY_CHECK_LOG"
if DEPLOY_CHECK_FAIL=photos bash manage.sh backup >/dev/null 2>&1; then echo 'Photo backup failure ignored' >&2; exit 1; fi
grep -q 'start api$' "$DEPLOY_CHECK_LOG"
! grep -q 'start api worker' "$DEPLOY_CHECK_LOG"
test "$(find backups -mindepth 1 -maxdepth 1 ! -name '.partial-*' | wc -l)" -eq 0
: > "$DEPLOY_CHECK_LOG"
if bash manage.sh restore missing --confirm-replace >/dev/null 2>&1; then echo 'Missing backup accepted' >&2; exit 1; fi
! grep -q 'stop\|exec\|run' "$DEPLOY_CHECK_LOG"
: > "$DEPLOY_CHECK_LOG"
bash manage.sh rename-admin >/dev/null
grep -q -- '-e ADMIN_EMAIL=admin@tnltrack.tech api node --input-type=module' "$DEPLOY_CHECK_LOG"
: > "$DEPLOY_CHECK_LOG"
if bash manage.sh seed-demo >/dev/null 2>&1; then echo 'Unconfirmed demo reset accepted' >&2; exit 1; fi
! grep -q 'seed.js' "$DEPLOY_CHECK_LOG"
: > "$DEPLOY_CHECK_LOG"
if DEPLOY_CHECK_FAIL=photos bash manage.sh seed-demo --confirm-replace >/dev/null 2>&1; then echo 'Failed backup ignored' >&2; exit 1; fi
! grep -q 'seed.js' "$DEPLOY_CHECK_LOG"
: > "$DEPLOY_CHECK_LOG"
if DEPLOY_CHECK_FAIL=seed bash manage.sh seed-demo --confirm-replace >/dev/null 2>&1; then echo 'Failed seed ignored' >&2; exit 1; fi
grep -q 'stop web api worker' "$DEPLOY_CHECK_LOG"
grep -q -- '-e NODE_ENV=development api node dist/database/seed.js --reset --confirm=tnl_track' "$DEPLOY_CHECK_LOG"
! grep -q 'ADMIN_EMAIL\|up -d --wait --wait-timeout 180' "$DEPLOY_CHECK_LOG"
# Allow a fresh UTC timestamp for the next completed backup.
sleep 1
: > "$DEPLOY_CHECK_LOG"
bash manage.sh seed-demo --confirm-replace >/dev/null
seed_line=$(grep -n 'seed.js' "$DEPLOY_CHECK_LOG" | cut -d: -f1)
rename_line=$(grep -n 'ADMIN_EMAIL' "$DEPLOY_CHECK_LOG" | cut -d: -f1)
start_line=$(grep -n 'up -d --wait --wait-timeout 180' "$DEPLOY_CHECK_LOG" | cut -d: -f1)
test "$seed_line" -lt "$rename_line"
test "$rename_line" -lt "$start_line"
echo 'Deployment failure-path checks passed.'
