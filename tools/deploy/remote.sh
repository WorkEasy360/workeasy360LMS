#!/bin/bash
# WorkEasyLMS production deploy helper — runs ON the EC2 host (copied to /tmp, run with sudo, then deleted).
#
#   sudo bash remote.sh inspect                 read-only: deployed commit, services, Flyway version, data counts, disk/memory
#   sudo bash remote.sh backup                  pg_dump + verified test-restore into a throwaway database; records data counts
#   sudo bash remote.sh deploy <sha>            install /tmp/backend-<sha>.jar (+ .sha256) and frontend at <sha>; restart backend
#   sudo bash remote.sh verify                  health, routing, Flyway, data preserved, auth, SSE through Nginx, payment config
#   sudo bash remote.sh set-env < settings      add/replace KEY=VALUE lines (SMTP_*, AI_*, APP_PUBLIC_URL, PLATFORM_ADMIN_*) in the env file
#   sudo bash remote.sh harden                  auto-restart + start at boot, hang watchdog, swap, log cap, nightly DB backups
#   sudo bash remote.sh rollback                previous jar + previous frontend (schema changes are additive: no data restore)
#   sudo bash remote.sh restore-db <dumpfile>   LAST RESORT: restore a dump into a new database and swap it in (old one kept)
#
# Scope: touches only /opt/workeasy360, the workeasy360-* units and the WorkEasyLMS database; `harden` also adds a
# swap file and a journal size cap, which only ever help other services on the host. It never edits Nginx, never
# prints secret values (the env file is read, never echoed), and never drops a database it did not just create
# itself for verification.
set -euo pipefail

ROOT=/opt/workeasy360
ENV_FILE=/etc/workeasy360/backend.env
SERVICE=workeasy360-backend
BACKUPS=$ROOT/backups
TABLES="users courses modules lessons enrollments lesson_progress quiz_attempts submissions certificates posts comments notifications videos"

[ "$(id -u)" = 0 ] || { echo "run with sudo"; exit 1; }
[ -f "$ENV_FILE" ] || { echo "missing $ENV_FILE"; exit 1; }
set -a; . "$ENV_FILE"; set +a
DB_HOST=${DB_HOST:-localhost}; DB_PORT=${DB_PORT:-5432}; DB_NAME=${DB_NAME:-we360}; DB_USERNAME=${DB_USERNAME:-we360}
BACKEND_PORT=${SERVER_PORT:-8081}
export PGPASSWORD="${DB_PASSWORD:-}"
q() { psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USERNAME" -d "${2:-$DB_NAME}" -At -v ON_ERROR_STOP=1 -c "$1"; }
flyway_version() { q "select version from flyway_schema_history where success order by installed_rank desc limit 1" "${1:-$DB_NAME}"; }
counts() { local db=${1:-$DB_NAME}; for t in $TABLES; do printf '%s=%s\n' "$t" "$(q "select count(*) from $t" "$db" 2>/dev/null || echo n/a)"; done; }
src_sha() { git -c safe.directory=$ROOT/src -C $ROOT/src rev-parse HEAD; }
say() { printf '\n== %s\n' "$*"; }

inspect() {
  say "deployed source commit"; src_sha; [ -f $ROOT/app/DEPLOYED_SHA ] && echo "jar built from: $(cat $ROOT/app/DEPLOYED_SHA)"
  say "jar"; ls -la $ROOT/app/*.jar; sha256sum $ROOT/app/backend.jar
  say "services"; for s in $SERVICE nginx postgresql; do printf '%-22s %s\n' "$s" "$(systemctl is-active $s 2>/dev/null || true)"; done
  say "listeners (backend and database must be loopback-only)"; ss -ltnp | awk 'NR==1 || /:(80|443|5432|'"$BACKEND_PORT"')\b/'
  say "database"; echo "name=$DB_NAME host=$DB_HOST"; echo "flyway=$(flyway_version)"; counts
  say "disk / memory"; df -h / $ROOT | awk 'NR==1||!seen[$0]++'; free -m
  say "configuration (names only; secret values are never shown)"
  grep -oE '^[A-Z_]+' "$ENV_FILE" | sort | tr '\n' ' '; echo
  echo "PAYMENTS_PROVIDER=${PAYMENTS_PROVIDER:-none} PAYMENTS_MOCK_ALLOWED=${PAYMENTS_MOCK_ALLOWED:-false} PLATFORM_ADMIN_EMAIL set: $([ -n "${PLATFORM_ADMIN_EMAIL:-}" ] && echo yes || echo no) SMTP_HOST set: $([ -n "${SMTP_HOST:-}" ] && echo yes || echo no)"
  say "health"; curl -s -o /dev/null -w "frontend via nginx: %{http_code}\n" http://127.0.0.1/; curl -s -o /dev/null -w "api via nginx (login probe): %{http_code}\n" -X POST -H 'Content-Type: application/json' -d '{}' http://127.0.0.1/api/auth/login
}

backup() {
  mkdir -p $BACKUPS; chmod 700 $BACKUPS
  local ts sha dump verify; ts=$(date -u +%Y%m%dT%H%M%SZ); sha=$(src_sha | cut -c1-7)
  dump=$BACKUPS/$DB_NAME-$ts-pre-$sha.dump; verify="workeasy360_verify_$(date -u +%s)"
  say "pg_dump -> $dump"; pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USERNAME" -d "$DB_NAME" -Fc -f "$dump"; chmod 600 "$dump"
  ls -la "$dump"; echo "toc entries: $(pg_restore --list "$dump" | grep -vc '^;')"
  counts > "$dump.counts"; echo "flyway=$(flyway_version)" >> "$dump.counts"
  say "test-restore into throwaway database $verify"
  sudo -u postgres createdb -O "$DB_USERNAME" "$verify"
  pg_restore -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USERNAME" -d "$verify" --no-owner "$dump"
  counts "$verify" > "$dump.restored-counts"; echo "flyway=$(flyway_version "$verify")" >> "$dump.restored-counts"
  case "$verify" in workeasy360_verify_*) sudo -u postgres dropdb "$verify" ;; esac
  if diff -q "$dump.counts" "$dump.restored-counts" >/dev/null; then echo "BACKUP VERIFIED: the restored copy matches production row for row"; cat "$dump.counts"
  else echo "BACKUP MISMATCH"; diff "$dump.counts" "$dump.restored-counts" || true; exit 1; fi
  echo "$dump" > $BACKUPS/LATEST
}

deploy() {
  local sha=${1:?usage: deploy <full-sha>} jar=/tmp/backend-$1.jar
  [ -f "$jar" ] && [ -f "$jar.sha256" ] || { echo "upload $jar and $jar.sha256 first"; exit 1; }
  (cd /tmp && sha256sum -c "$(basename "$jar").sha256") || { echo "jar checksum mismatch"; exit 1; }
  local latest; latest=$(cat $BACKUPS/LATEST 2>/dev/null || true)
  [ -n "$latest" ] && [ -f "$latest" ] && [ -n "$(find "$latest" -mmin -120)" ] || { echo "no verified backup from the last 2 hours: run 'backup' first"; exit 1; }
  local old; old=$(src_sha)
  say "source $old -> $sha"
  git -c safe.directory=$ROOT/src -C $ROOT/src fetch -q origin main
  git -c safe.directory=$ROOT/src -C $ROOT/src merge -q --ff-only "$sha"
  [ "$(src_sha)" = "$sha" ] || { echo "source is not at $sha"; exit 1; }
  echo "$old" > $ROOT/app/PREVIOUS_SHA

  say "frontend"
  rm -rf $ROOT/frontend.new; mkdir -p $ROOT/frontend.new
  cp -r $ROOT/src/src $ROOT/frontend.new/src
  sed 's#<script type="module" src="/src/app.js"></script>#<script>window.WE360_API_BASE = "/api";</script>\n<script type="module" src="/src/app.js"></script>#' $ROOT/src/index.html > $ROOT/frontend.new/index.html
  [ "$(grep -c 'WE360_API_BASE = "/api"' $ROOT/frontend.new/index.html)" = 1 ] || { echo "frontend index.html rewrite failed"; exit 1; }
  chown -R root:root $ROOT/frontend.new; chmod -R a+rX $ROOT/frontend.new

  say "backend jar (previous kept as backend-${old:0:7}.jar)"
  cp -p $ROOT/app/backend.jar "$ROOT/app/backend-${old:0:7}.jar"
  install -m 644 "$jar" $ROOT/app/backend.jar
  local since; since=$(date '+%Y-%m-%d %H:%M:%S')
  systemctl restart $SERVICE
  for i in $(seq 1 90); do
    journalctl -u $SERVICE --since "$since" --no-pager | grep -q "Started BackendApplication" && break
    systemctl is-active -q $SERVICE || break
    sleep 2
  done
  if ! journalctl -u $SERVICE --since "$since" --no-pager | grep -q "Started BackendApplication"; then
    echo "BACKEND DID NOT START — restoring the previous jar"; journalctl -u $SERVICE --since "$since" --no-pager | tail -40
    install -m 644 "$ROOT/app/backend-${old:0:7}.jar" $ROOT/app/backend.jar; systemctl restart $SERVICE; exit 1
  fi
  journalctl -u $SERVICE --since "$since" --no-pager | grep -E "Migrating schema|Successfully applied|Schema .* is up to date|PlatformBootstrap" || true

  [ -d $ROOT/frontend.prev ] && rm -rf $ROOT/frontend.prev
  mv $ROOT/frontend $ROOT/frontend.prev; mv $ROOT/frontend.new $ROOT/frontend
  echo "$sha" > $ROOT/app/DEPLOYED_SHA
  rm -f "$jar" "$jar.sha256"
  echo "DEPLOYED $sha (flyway now $(flyway_version))"
}

verify() {
  local fails=0; check() { if eval "$2"; then echo "PASS $1"; else echo "FAIL $1"; fails=$((fails+1)); fi; }
  say "services and routing"
  check "backend service active" "systemctl is-active -q $SERVICE"
  check "nginx config valid and active" "nginx -t -q 2>/dev/null && systemctl is-active -q nginx"
  check "backend bound to loopback only" "! ss -ltn | grep -E ':$BACKEND_PORT\b' | grep -vqE '127.0.0.1|\[::1\]'"
  check "postgres bound to loopback only" "! ss -ltn | grep -E ':5432\b' | grep -vqE '127.0.0.1|\[::1\]'"
  check "frontend served with API base" "curl -s http://127.0.0.1/ | grep -q 'WE360_API_BASE = \"/api\"'"
  check "API routed through nginx (public plan catalogue)" "[ \"\$(curl -s http://127.0.0.1/api/public/plans | grep -o '\"id\"' | wc -l)\" -ge 1 ]"
  check "bad credentials refused (401)" "[ \"\$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{\"email\":\"nobody@example.invalid\",\"password\":\"wrong-password\"}' http://127.0.0.1/api/auth/login)\" = 401 ]"
  check "stream refuses requests without a ticket (401)" "[ \"\$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1/api/sync/stream)\" = 401 ]"
  check "deployed commit matches source" "[ \"\$(cat $ROOT/app/DEPLOYED_SHA)\" = \"\$(src_sha)\" ]"
  check "no secrets in served frontend" "! grep -rqE 'JWT_SECRET|DB_PASSWORD|SMTP_PASSWORD|PLATFORM_ADMIN_PASSWORD|BEGIN (RSA )?PRIVATE KEY' $ROOT/frontend"

  say "database"
  echo "flyway=$(flyway_version)"
  check "Flyway at V11" "[ \"\$(flyway_version)\" = 11 ]"
  local before; before=$(cat $BACKUPS/LATEST).counts
  counts > /tmp/we360-counts-after
  while IFS='=' read -r t n; do
    [ "$t" = flyway ] && continue
    a=$(grep "^$t=" /tmp/we360-counts-after | cut -d= -f2)
    check "data preserved: $t ($n before, $a now)" "[ \"$n\" = n/a ] || [ \"$a\" -ge \"$n\" ]"
  done < "$before"
  rm -f /tmp/we360-counts-after
  check "existing users joined the default organization" "[ \"\$(q \"select count(*) from users where org_id is null\")\" = 0 ]"

  say "payments (reported, never changed here)"
  echo "PAYMENTS_PROVIDER=${PAYMENTS_PROVIDER:-none} PAYMENTS_MOCK_ALLOWED=${PAYMENTS_MOCK_ALLOWED:-false}"
  check "mock payments disabled in production" "[ \"${PAYMENTS_MOCK_ALLOWED:-false}\" != true ]"

  say "live SSE through nginx (platform owner account, credentials read from the env file)"
  if [ -n "${PLATFORM_ADMIN_EMAIL:-}" ] && [ -n "${PLATFORM_ADMIN_PASSWORD:-}" ]; then
    local body token ticket out
    body=$(printf '{"email":"%s","password":"%s"}' "$PLATFORM_ADMIN_EMAIL" "$PLATFORM_ADMIN_PASSWORD")
    token=$(curl -s -X POST -H 'Content-Type: application/json' -d "$body" http://127.0.0.1/api/auth/login | sed -n 's/.*"token":"\([^"]*\)".*/\1/p'); unset body
    check "platform owner signs in" "[ -n \"$token\" ]"
    check "platform console API answers" "[ \"\$(curl -s -o /dev/null -w '%{http_code}' -H \"Authorization: Bearer $token\" http://127.0.0.1/api/platform/stats)\" = 200 ]"
    ticket=$(curl -s -X POST -H "Authorization: Bearer $token" http://127.0.0.1/api/sync/ticket | sed -n 's/.*"ticket":"\([^"]*\)".*/\1/p')
    out=$(timeout 32 curl -s -N -D - "http://127.0.0.1/api/sync/stream?ticket=$ticket" || true)
    check "stream opens through nginx (hello event)" "grep -q 'event:hello' <<<\"\$out\""
    check "stream is not buffered (heartbeat arrived within 32s)" "grep -q '^:ping' <<<\"\$out\""
    check "ticket is single-use" "[ \"\$(curl -s -o /dev/null -w '%{http_code}' \"http://127.0.0.1/api/sync/stream?ticket=$ticket\")\" = 401 ]"
    unset token ticket out
  else echo "SKIP: PLATFORM_ADMIN_EMAIL / PLATFORM_ADMIN_PASSWORD not set in $ENV_FILE"; fi

  say "e-mail"
  if [ -n "${SMTP_HOST:-}" ]; then
    local started; started=$(systemctl show -p ActiveEnterTimestamp --value $SERVICE)
    check "server reaches $SMTP_HOST:${SMTP_PORT:-587}" "timeout 10 bash -c '</dev/tcp/$SMTP_HOST/${SMTP_PORT:-587}' 2>/dev/null"
    check "backend loaded the SMTP settings" "journalctl -u $SERVICE --since \"$started\" --no-pager | grep -q 'Outgoing e-mail enabled'"
    check "links in e-mails point at an https address" "[[ \"${APP_PUBLIC_URL:-}\" == https://* ]]"
  else echo "SKIP: SMTP_HOST not set — admins hand reset links over themselves"; fi

  say "AI agent"
  if [ "${AI_ENABLED:-false}" = true ]; then
    check "AI provider, model and key configured" "[ -n \"${AI_PROVIDER:-}\" ] && [ -n \"${AI_MODEL:-}\" ] && [ -n \"${AI_API_KEY:-}\" ]"
    [ "${AI_PROVIDER:-}" = openai ] && check "server reaches the AI provider and it accepts the key" "ai_key_ok"
  else echo "SKIP: AI_ENABLED is not true — the agent answers from the built-in offline guide"; fi

  say "resilience"
  check "backend restarts automatically after a crash" "[ \"\$(systemctl show -p Restart --value $SERVICE)\" = always ]"
  for s in $SERVICE nginx postgresql; do check "$s starts at boot" "systemctl is-enabled -q $s"; done
  check "hang watchdog scheduled" "systemctl is-active -q workeasy360-watchdog.timer"
  check "nightly database backup scheduled" "systemctl is-active -q workeasy360-backup.timer"

  say "result"; [ $fails = 0 ] && echo "ALL CHECKS PASSED" || { echo "$fails CHECK(S) FAILED"; exit 1; }
}

# The key travels in a curl config read from stdin, so it never appears in a process listing or in output.
ai_key_ok() {
  local base=${AI_BASE_URL:-https://api.openai.com/v1}
  [ "$(printf 'header = "Authorization: Bearer %s"\n' "$AI_API_KEY" | curl -s -o /dev/null -w '%{http_code}' --max-time 20 -K - "${base%/}/models")" = 200 ]
}

# Makes the service survive the failures that took it down before: crashes, hangs, memory pressure, a full disk and
# reboots, and keeps a rolling two weeks of database backups. Idempotent; each step reports what it found or did.
harden() {
  say "backend restarts after a crash and every service starts at boot"
  mkdir -p /etc/systemd/system/$SERVICE.service.d
  printf '[Unit]\nStartLimitIntervalSec=600\nStartLimitBurst=10\n\n[Service]\nRestart=always\nRestartSec=5\n' > /etc/systemd/system/$SERVICE.service.d/10-restart.conf
  mkdir -p $ROOT/bin

  cat > $ROOT/bin/watchdog.sh <<'EOF'
#!/bin/bash
# Restarts the backend when it is running but has stopped answering (two failed probes in a row, five minutes apart).
state=/run/workeasy360-watchdog.failures
systemctl is-active -q workeasy360-backend || { rm -f "$state"; exit 0; }
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 -X POST -H 'Content-Type: application/json' -d '{}' "http://127.0.0.1:${SERVER_PORT:-8081}/api/auth/login" || true)
if [ "$code" = 400 ] || [ "$code" = 401 ]; then rm -f "$state"; exit 0; fi
n=$(( $(cat "$state" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$state"
if [ "$n" -ge 2 ]; then logger -t workeasy360-watchdog "backend not answering (HTTP $code), restarting"; systemctl restart workeasy360-backend; rm -f "$state"; fi
EOF
  cat > $ROOT/bin/nightly-backup.sh <<'EOF'
#!/bin/bash
# Nightly pg_dump of the WorkEasyLMS database; dumps older than 14 days are removed.
set -euo pipefail
umask 077
dir=/opt/workeasy360/backups/nightly; mkdir -p "$dir"
export PGPASSWORD="${DB_PASSWORD:-}"
pg_dump -h "${DB_HOST:-localhost}" -p "${DB_PORT:-5432}" -U "${DB_USERNAME:-we360}" -d "${DB_NAME:-we360}" -Fc -f "$dir/${DB_NAME:-we360}-$(date -u +%Y%m%dT%H%M%SZ).dump"
find "$dir" -name '*.dump' -mtime +14 -delete
EOF
  chmod 750 $ROOT/bin/watchdog.sh $ROOT/bin/nightly-backup.sh
  printf '[Unit]\nDescription=WorkEasyLMS hang watchdog\n\n[Service]\nType=oneshot\nEnvironmentFile=%s\nExecStart=/bin/bash %s/bin/watchdog.sh\n' "$ENV_FILE" "$ROOT" > /etc/systemd/system/workeasy360-watchdog.service
  printf '[Unit]\nDescription=WorkEasyLMS hang watchdog every 5 minutes\n\n[Timer]\nOnBootSec=10min\nOnUnitActiveSec=5min\n\n[Install]\nWantedBy=timers.target\n' > /etc/systemd/system/workeasy360-watchdog.timer
  printf '[Unit]\nDescription=WorkEasyLMS nightly database backup\nAfter=postgresql.service\n\n[Service]\nType=oneshot\nEnvironmentFile=%s\nExecStart=/bin/bash %s/bin/nightly-backup.sh\n' "$ENV_FILE" "$ROOT" > /etc/systemd/system/workeasy360-backup.service
  printf '[Unit]\nDescription=WorkEasyLMS nightly database backup at 02:30 UTC\n\n[Timer]\nOnCalendar=*-*-* 02:30:00 UTC\nPersistent=true\nRandomizedDelaySec=15min\n\n[Install]\nWantedBy=timers.target\n' > /etc/systemd/system/workeasy360-backup.timer
  systemctl daemon-reload
  for s in $SERVICE nginx postgresql workeasy360-watchdog.timer workeasy360-backup.timer; do systemctl enable -q "$s" 2>/dev/null && echo "enabled at boot: $s" || echo "could not enable $s"; done
  systemctl start workeasy360-watchdog.timer workeasy360-backup.timer
  echo "Restart=$(systemctl show -p Restart --value $SERVICE) (takes effect for the running service now)"

  say "swap (protects the JVM and PostgreSQL from out-of-memory kills on a small instance)"
  if swapon --show --noheadings | grep -q .; then swapon --show
  else
    local memmb freemb; memmb=$(free -m | awk '/^Mem:/{print $2}'); freemb=$(df --output=avail -m / | tail -1 | tr -d ' ')
    if [ "$memmb" -lt 4096 ] && [ "$freemb" -gt 4096 ]; then
      if [ ! -f /swapfile ]; then fallocate -l 2G /swapfile; chmod 600 /swapfile; mkswap -q /swapfile; fi
      swapon /swapfile
      grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
      echo 'vm.swappiness=10' > /etc/sysctl.d/90-workeasy360-swap.conf; sysctl -q -p /etc/sysctl.d/90-workeasy360-swap.conf
      swapon --show
    else echo "skipped: ${memmb} MB memory, ${freemb} MB free disk"; fi
  fi

  say "journal size cap (logs can't fill the disk)"
  if [ -f /etc/systemd/journald.conf.d/90-workeasy360.conf ]; then echo "already capped"
  else mkdir -p /etc/systemd/journald.conf.d; printf '[Journal]\nSystemMaxUse=300M\n' > /etc/systemd/journald.conf.d/90-workeasy360.conf; systemctl restart systemd-journald; echo "capped at 300M"; fi

  say "automatic security updates (reported, not changed)"
  echo "unattended-upgrades: $(systemctl is-enabled unattended-upgrades 2>/dev/null || echo not installed)"
  df -h / | tail -1
}

# Reads KEY=VALUE lines from stdin and writes them into the env file, replacing earlier (or commented-out) lines for
# the same key. Only the settings named here can be changed this way; values are never printed. Takes effect at the
# next backend restart (deploy restarts it).
SETTABLE="SMTP_HOST SMTP_PORT SMTP_USERNAME SMTP_PASSWORD SMTP_FROM SMTP_SSL SMTP_STARTTLS APP_PUBLIC_URL PLATFORM_ADMIN_EMAIL PLATFORM_ADMIN_PASSWORD AI_ENABLED AI_PROVIDER AI_API_KEY AI_MODEL AI_BASE_URL AI_REASONING_EFFORT"
set_env() {
  [ -t 0 ] && { echo "pipe KEY=VALUE lines in on stdin"; exit 1; }
  umask 077
  local tmp line key keys=""; tmp=$(mktemp "$ENV_FILE.new.XXXXXX")
  cat "$ENV_FILE" > "$tmp"
  while IFS= read -r line || [ -n "$line" ]; do
    line=${line%$'\r'}
    [[ -z "$line" || "$line" == \#* ]] && continue
    key=${line%%=*}
    if [[ "$line" != *=* || " $SETTABLE " != *" $key "* ]]; then echo "refused: '${key:0:40}' is not a setting this command manages — nothing changed"; rm -f "$tmp"; exit 1; fi
    grep -v -E "^#?[[:space:]]*$key=" "$tmp" > "$tmp.f" || true
    printf '%s\n' "$line" >> "$tmp.f"; mv "$tmp.f" "$tmp"
    keys="$keys $key"
  done
  [ -n "$keys" ] || { echo "no KEY=VALUE lines on stdin — nothing changed"; rm -f "$tmp"; exit 1; }
  cp -p "$ENV_FILE" "$ENV_FILE.bak-$(date -u +%Y%m%dT%H%M%SZ)"
  chown --reference="$ENV_FILE" "$tmp"; chmod --reference="$ENV_FILE" "$tmp"
  mv "$tmp" "$ENV_FILE"
  echo "set:$keys (values not shown; previous file kept as $ENV_FILE.bak-*)"
  echo "takes effect when the backend restarts: deploy restarts it, or: systemctl restart $SERVICE"
}

rollback() {
  local prev; prev=$(cat $ROOT/app/PREVIOUS_SHA)
  [ -f "$ROOT/app/backend-${prev:0:7}.jar" ] || { echo "previous jar backend-${prev:0:7}.jar not found"; exit 1; }
  say "backend -> ${prev:0:7} (migrations V8+ are additive with defaults; the older build ignores newer schema history)"
  install -m 644 "$ROOT/app/backend-${prev:0:7}.jar" $ROOT/app/backend.jar
  systemctl restart $SERVICE
  if [ -d $ROOT/frontend.prev ]; then say "frontend -> previous"; mv $ROOT/frontend $ROOT/frontend.failed; mv $ROOT/frontend.prev $ROOT/frontend; fi
  git -c safe.directory=$ROOT/src -C $ROOT/src reset -q --keep "$prev"
  echo "$prev" > $ROOT/app/DEPLOYED_SHA
  echo "ROLLED BACK to $prev — data untouched. Check: journalctl -u $SERVICE -n 50"
}

restore_db() {
  local dump=${1:?usage: restore-db <dumpfile>} ts; ts=$(date -u +%s)
  [ -f "$dump" ] || { echo "no such dump"; exit 1; }
  echo "This replaces the live database with the dump. Data written since the dump stays in ${DB_NAME}_replaced_$ts."
  read -r -p "Type the database name ($DB_NAME) to continue: " confirm; [ "$confirm" = "$DB_NAME" ] || { echo "aborted"; exit 1; }
  sudo -u postgres createdb -O "$DB_USERNAME" "${DB_NAME}_restore_$ts"
  pg_restore -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USERNAME" -d "${DB_NAME}_restore_$ts" --no-owner "$dump"
  systemctl stop $SERVICE
  sudo -u postgres psql -v ON_ERROR_STOP=1 -c "alter database \"$DB_NAME\" rename to \"${DB_NAME}_replaced_$ts\"" -c "alter database \"${DB_NAME}_restore_$ts\" rename to \"$DB_NAME\""
  systemctl start $SERVICE
  echo "RESTORED $dump; previous live database kept as ${DB_NAME}_replaced_$ts"
}

case "${1:-}" in
  inspect) inspect ;; backup) backup ;; deploy) deploy "${2:-}" ;; verify) verify ;; set-env) set_env ;; harden) harden ;; rollback) rollback ;; restore-db) restore_db "${2:-}" ;;
  *) sed -n '2,16p' "$0"; exit 1 ;;
esac
