#!/usr/bin/env bash
# Installs or updates the shared sign-in on the server. Run as root from an unpacked release (see ship.sh):
#
#   sudo bash signin/deploy/install.sh rule29.co.uk
#
# The argument is the parent domain every app sits under. The sign-in answers at signin.<domain> and
# its cookie covers every <app>.<domain>. Each app's own address defaults to the names below; set
# MIS_HOST, QUOTING_HOST, SCHEDULING_HOST or TIMESHEETS_HOST to change one on the first install.
#
# Safe to run again for every release: it keeps the database, the settings and app list in
# /etc/signin, and the web server entry, applies only new database files, and switches to the
# new release only once it is built. The app keys and database password are made here and kept
# only in /etc/signin/app.env.
set -euo pipefail
DOMAIN=${1:?Give the parent domain the apps share, e.g. rule29.co.uk}
HOST=signin.$DOMAIN
SRC=$(cd "$(dirname "$0")/../.." && pwd)
DB=rule29_signin
say() { printf '\n== %s\n' "$*"; }
die() { echo "Stopped: $*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || die "run with sudo."
[[ $DOMAIN =~ ^[a-z0-9-]+(\.[a-z0-9-]+)+$ ]] || die "$DOMAIN is not a domain."
NODE=$(command -v node) || die "Node 24 is not installed."
[ "$("$NODE" -p 'process.versions.node.split(".")[0]')" -ge 24 ] || die "Node 24 or later is needed ($("$NODE" -v) found)."
command -v npm >/dev/null || die "npm is not installed."
command -v psql >/dev/null || die "PostgreSQL's psql is not installed."
command -v nginx >/dev/null || die "nginx is not installed."
SHA=$(cat "$SRC/RELEASE" 2>/dev/null || true)
[[ $SHA =~ ^[0-9a-f]{7,40}$ ]] || die "no RELEASE file: unpack a release made by ship.sh."
REL=/srv/signin/releases/$SHA
pg() { sudo -u postgres env PGOPTIONS=--client-min-messages=warning psql -v ON_ERROR_STOP=1 -qtA "$@"; }

say "Account and folders"
id signin >/dev/null 2>&1 || useradd --system --home /srv/signin --shell /usr/sbin/nologin signin
install -d -m 0755 /srv/signin /srv/signin/releases
install -d -m 0750 -o root -g signin /etc/signin

say "Release $SHA"
if [ ! -f "$REL/.installed" ]; then
  rm -rf "$REL"
  cp -a "$SRC" "$REL"
  rm -f "$REL/RELEASE"
  chown -R root:root "$REL"
  (cd "$REL/signin" && npm ci --omit=dev --no-audit --no-fund)
  chmod -R go-w,o+rX "$REL"
  touch "$REL/.installed"
else
  echo "Already built."
fi

say "Database"
if [ "$(pg -c "SELECT 1 FROM pg_database WHERE datname='$DB'")" != 1 ]; then
  pg -c "CREATE DATABASE $DB OWNER postgres"
  pg -d "$DB" -c "REVOKE ALL ON DATABASE $DB FROM PUBLIC"
fi
pg -d "$DB" -c "CREATE TABLE IF NOT EXISTS public.signin_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"
for f in "$REL"/signin/db/*.sql; do
  name=$(basename "$f")
  [ "$(pg -d "$DB" -c "SELECT 1 FROM public.signin_migrations WHERE name='$name'")" = 1 ] && continue
  echo "Applying $name"
  pg -d "$DB" < "$f"
  pg -d "$DB" -c "INSERT INTO public.signin_migrations (name) VALUES ('$name')"
done
pg -d "$DB" -c "GRANT CONNECT ON DATABASE $DB TO rule29_signin_app"

say "Settings"
ENV=/etc/signin/app.env
if [ ! -f "$ENV" ]; then
  pw=$(openssl rand -hex 24)
  # The password goes to psql on its input, so it never shows in the process list.
  printf "ALTER ROLE rule29_signin_app PASSWORD '%s';\n" "$pw" | pg -d "$DB"
  umask 077
  cat > "$ENV" <<ENVFILE
NODE_ENV=production
HOST=127.0.0.1
PORT=3900
TRUSTED_PROXY=loopback
SIGNIN_ORIGIN=https://$HOST
COOKIE_DOMAIN=$DOMAIN
APPS_FILE=/etc/signin/apps.json
DATABASE_URL=postgresql://rule29_signin_app:$pw@127.0.0.1:5432/$DB
SIGNIN_KEY_MIS=$(openssl rand -hex 32)
SIGNIN_KEY_QUOTING=$(openssl rand -hex 32)
SIGNIN_KEY_SCHEDULING=$(openssl rand -hex 32)
SIGNIN_KEY_TIMESHEETS=$(openssl rand -hex 32)
ENVFILE
  unset pw
  echo "Made $ENV (the database password and the four app keys are only in there)."
else
  echo "Keeping $ENV."
fi
chown root:signin "$ENV"; chmod 640 "$ENV"

APPS=/etc/signin/apps.json
if [ ! -f "$APPS" ]; then
  # The repository's app list, with each app's home moved to its address under the domain.
  # Return addresses are only followed to these addresses, so they must be right.
  MIS_HOST=${MIS_HOST:-management.$DOMAIN} QUOTING_HOST=${QUOTING_HOST:-quoting.$DOMAIN} \
  SCHEDULING_HOST=${SCHEDULING_HOST:-scheduling.$DOMAIN} TIMESHEETS_HOST=${TIMESHEETS_HOST:-timesheets.$DOMAIN} \
  "$NODE" -e '
    const fs = require("fs"), c = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    for (const a of c.apps) {
      const h = process.env[a.id.toUpperCase().replace(/-/g, "_") + "_HOST"];
      if (!h) throw new Error("No address for " + a.id);
      a.homeUrl = "https://" + h + "/";
    }
    fs.writeFileSync(process.argv[2], JSON.stringify(c, null, 2) + "\n");
    for (const a of c.apps) console.log("  " + a.id.padEnd(11) + a.homeUrl);
  ' "$REL/signin/apps.json" "$APPS"
  echo "Made $APPS. Edit it if an app lives somewhere else, then: systemctl restart signin"
else
  echo "Keeping $APPS."
fi
chown root:signin "$APPS"; chmod 640 "$APPS"

say "Service"
sed "s#/usr/local/bin/node#$NODE#" "$REL/signin/deploy/signin.service" > /etc/systemd/system/signin.service
ln -sfn "$REL" /srv/signin/current
systemctl daemon-reload
systemctl enable signin >/dev/null 2>&1
systemctl restart signin
for i in $(seq 1 20); do
  curl -fsS http://127.0.0.1:3900/api/health >/dev/null 2>&1 && break
  [ "$i" = 20 ] && { journalctl -u signin -n 30 --no-pager; die "the sign-in didn't start (its log is above)."; }
  sleep 1
done
echo "Running."

say "Web address"
SITE=/etc/nginx/sites-available/signin
if [ ! -f "$SITE" ]; then
  sed "s/signin\.example\.com/$HOST/" "$REL/signin/deploy/nginx.conf" > "$SITE"
  ln -sfn "$SITE" /etc/nginx/sites-enabled/signin
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
cur=$(readlink -f /srv/signin/current)
ls -1dt /srv/signin/releases/*/ 2>/dev/null | tail -n +6 | while read -r old; do
  [ "$(readlink -f "$old")" = "$cur" ] || rm -rf "$old"
done

echo
echo "Installed $SHA. Next: copy logins in and connect each app (signin/deploy/RUNBOOK.md)."
