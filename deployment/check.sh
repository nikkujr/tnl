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
echo 'Deployment failure-path checks passed.'
