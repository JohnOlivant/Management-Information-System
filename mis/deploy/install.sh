#!/usr/bin/env bash
# Installs or updates the MIS on the server. Run as root from an unpacked release (see ship.sh):
#
#   sudo bash mis/deploy/install.sh rule29.co.uk
#
# The MIS answers at management.<domain> (set MIS_HOST to change it on the first install) and signs
# people in with the shared sign-in at signin.<domain>, which must already be installed here.
# It reads Quoting, Scheduling and Timesheets read-only, as the database role rule29_mis_reader.
# Database names default to the live ones; set QUOTING_DB, SCHEDULING_DB or TIMESHEETS_DB to change them.
#
# Safe to run again for every release: it keeps /etc/mis (settings and firms.json) and the web server
# entry, and switches to the new release only once it is built.
set -euo pipefail
DOMAIN=${1:?Give the parent domain the apps share, e.g. rule29.co.uk}
HOST=${MIS_HOST:-management.$DOMAIN}
PORT=3400
QUOTING_DB=${QUOTING_DB:-sands_quoting}
SCHEDULING_DB=${SCHEDULING_DB:-rule29_scheduler}
TIMESHEETS_DB=${TIMESHEETS_DB:-rule29_timesheets_demo}
SRC=$(cd "$(dirname "$0")/../.." && pwd)
say() { printf '\n== %s\n' "$*"; }
die() { echo "Stopped: $*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || die "run with sudo."
[[ $DOMAIN =~ ^[a-z0-9-]+(\.[a-z0-9-]+)+$ ]] || die "$DOMAIN is not a domain."
NODE=$(command -v node) || die "Node 24 is not installed."
[ "$("$NODE" -p 'process.versions.node.split(".")[0]')" -ge 24 ] || die "Node 24 or later is needed ($("$NODE" -v) found)."
command -v psql >/dev/null || die "PostgreSQL's psql is not installed."
command -v nginx >/dev/null || die "nginx is not installed."
[ -f /etc/signin/app.env ] || die "the shared sign-in is not installed on this server (no /etc/signin/app.env)."
SHA=$(cat "$SRC/RELEASE" 2>/dev/null || true)
[[ $SHA =~ ^[0-9a-f]{7,40}$ ]] || die "no RELEASE file: unpack a release made by ship.sh."
REL=/srv/mis/releases/$SHA
pg() { sudo -u postgres env PGOPTIONS=--client-min-messages=warning psql -v ON_ERROR_STOP=1 -qtA "$@"; }
dbExists() { [ "$(pg -c "SELECT 1 FROM pg_database WHERE datname='$1'")" = 1 ]; }

# Something else on the port would stop the MIS starting; say so plainly.
if ! systemctl is-active --quiet mis && command -v ss >/dev/null && ss -ltn "sport = :$PORT" | grep -q LISTEN; then
  die "port $PORT is already used by another program. Tell Claude which one (sudo ss -ltnp 'sport = :$PORT')."
fi

say "Account and folders"
id mis >/dev/null 2>&1 || useradd --system --home /srv/mis --shell /usr/sbin/nologin mis
install -d -m 0755 /srv/mis /srv/mis/releases
install -d -m 0750 -o root -g mis /etc/mis

say "Release $SHA"
if [ ! -f "$REL/.installed" ]; then
  rm -rf "$REL"
  cp -a "$SRC" "$REL"
  rm -f "$REL/RELEASE"
  chown -R root:root "$REL"
  (cd "$REL/mis" && npm ci --omit=dev --no-audit --no-fund)
  chmod -R go-w,o+rX "$REL"
  touch "$REL/.installed"
else
  echo "Already built."
fi

say "Read-only database access"
ENV=/etc/mis/app.env
if ! pg -c "SELECT 1 FROM pg_roles WHERE rolname='rule29_mis_reader'" | grep -q 1; then
  pg -c "CREATE ROLE rule29_mis_reader LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT"
fi
# The reader's password is kept only here (root only) and in the database addresses in $ENV.
PWFILE=/etc/mis/reader-password
if [ ! -s "$PWFILE" ]; then
  (umask 077; openssl rand -hex 24 > "$PWFILE")
  # The password goes to psql on its input, so it never shows in the process list.
  printf "ALTER ROLE rule29_mis_reader PASSWORD '%s';\n" "$(cat "$PWFILE")" | pg
fi
chmod 600 "$PWFILE"
pw=$(cat "$PWFILE")
urls=""
for pair in "quoting:$QUOTING_DB" "scheduling:$SCHEDULING_DB" "timesheets:$TIMESHEETS_DB"; do
  app=${pair%%:*}; db=${pair#*:}
  if dbExists "$db"; then
    pg -d "$db" < "$REL/mis/db/reader-$app.sql"
    echo "  $app: reading $db"
    urls+="${app^^}_DATABASE_URL=postgresql://rule29_mis_reader:$pw@127.0.0.1:5432/$db"$'\n'
  else
    echo "  $app: no database called $db here, so the MIS won't show $app figures"
  fi
done

say "Settings"
if [ ! -f "$ENV" ]; then
  key=$(sed -n 's/^SIGNIN_KEY_MIS=//p' /etc/signin/app.env)
  [ -n "$key" ] || die "no SIGNIN_KEY_MIS in /etc/signin/app.env."
  umask 077
  {
    echo "NODE_ENV=production"
    echo "HOST=127.0.0.1"
    echo "PORT=$PORT"
    echo "MIS_ORIGIN=https://$HOST"
    echo "SIGNIN_URL=https://signin.$DOMAIN"
    echo "SIGNIN_KEY=$key"
    echo "FIRMS_FILE=/etc/mis/firms.json"
    printf '%s' "$urls"
  } > "$ENV"
  echo "Made $ENV."
else
  # Add any app database that has appeared since the first install; keep everything else.
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    grep -q "^${line%%=*}=" "$ENV" || { echo "$line" >> "$ENV"; echo "Added ${line%%=*}."; }
  done <<< "$urls"
  echo "Keeping $ENV."
fi
unset pw urls
chown root:mis "$ENV"; chmod 640 "$ENV"
FIRMS=/etc/mis/firms.json
[ -f "$FIRMS" ] || { echo '[]' > "$FIRMS"; echo "Made $FIRMS (no firms yet: see add-firm.sh)."; }
chown root:mis "$FIRMS"; chmod 640 "$FIRMS"

say "Service"
sed "s#/usr/local/bin/node#$NODE#" "$REL/mis/deploy/mis.service" > /etc/systemd/system/mis.service
ln -sfn "$REL" /srv/mis/current
systemctl daemon-reload
systemctl enable mis >/dev/null 2>&1
systemctl restart mis
for i in $(seq 1 20); do
  curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 && break
  [ "$i" = 20 ] && { journalctl -u mis -n 30 --no-pager; die "the MIS didn't start (its log is above)."; }
  sleep 1
done
echo "Running."

say "Web address"
SITE=/etc/nginx/sites-available/mis
if [ ! -f "$SITE" ]; then
  sed "s/management\.example\.com/$HOST/" "$REL/mis/deploy/nginx.conf" > "$SITE"
  ln -sfn "$SITE" /etc/nginx/sites-enabled/mis
fi
nginx -t || die "the web server settings have a problem (shown above)."
systemctl reload nginx
if [ ! -d "/etc/letsencrypt/live/$HOST" ]; then
  command -v certbot >/dev/null || die "certbot is not installed."
  certbot --nginx -d "$HOST" --redirect --non-interactive --agree-tos --register-unsafely-without-email \
    || certbot --nginx -d "$HOST" --redirect
fi
if curl -fsS "https://$HOST/api/health" >/dev/null; then echo "https://$HOST is up."; else echo "https://$HOST does not answer yet: check $HOST points at this server."; fi

# Old releases: keep the five newest and the one in use.
cur=$(readlink -f /srv/mis/current)
ls -1dt /srv/mis/releases/*/ 2>/dev/null | tail -n +6 | while read -r old; do
  [ "$(readlink -f "$old")" = "$cur" ] || rm -rf "$old"
done

echo
echo "Installed $SHA. Next: link a firm and give people access (mis/deploy/RUNBOOK.md, step 3)."
