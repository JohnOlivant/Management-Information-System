#!/usr/bin/env bash
# Switches one app on this server to the shared sign-in, or back to its own login. Run as root:
#
#   sudo bash connect-app.sh timesheets        (or scheduling, quoting)
#   sudo bash connect-app.sh timesheets off    (back to the app's own login page)
#
# It writes SIGNIN_URL and the app's key from /etc/signin/app.env into the app's own settings file,
# keeps a copy of the old file next to it, restarts the app and checks it came back.
# Copy the app's logins in first (import-logins.sh), or nobody will be able to open it.
set -euo pipefail
APP=${1:?Give the app: timesheets, scheduling or quoting}
MODE=${2:-on}
die() { echo "Stopped: $*" >&2; exit 1; }
[ "$(id -u)" = 0 ] || die "run with sudo."
case $APP in
  timesheets) ENV=/etc/timesheet/app.env; UNIT=timesheet; CHECK=http://127.0.0.1:3000/ ;;
  scheduling) ENV=/etc/scheduler/app.env; UNIT=scheduler; CHECK=http://127.0.0.1:3001/scheduler/health ;;
  quoting)    ENV=/etc/quoting/app.env;   UNIT=quoting;   CHECK=http://127.0.0.1:3002/api/health ;;
  *) die "$APP is not one of timesheets, scheduling, quoting." ;;
esac
[ -f "$ENV" ] || die "$ENV is missing: is $APP installed on this server?"
[[ $MODE =~ ^(on|off)$ ]] || die "the second word is on or off."

KEYNAME=SIGNIN_KEY_$(echo "$APP" | tr a-z A-Z)
get() { sed -n "s/^$1=//p" /etc/signin/app.env | tail -1; }
if [ "$MODE" = on ]; then
  [ -f /etc/signin/app.env ] || die "the sign-in isn't installed here (run install.sh first)."
  URL=$(get SIGNIN_ORIGIN); KEY=$(get "$KEYNAME")
  [[ $URL == https://* ]] || die "SIGNIN_ORIGIN in /etc/signin/app.env is not an https address."
  [ ${#KEY} -ge 32 ] || die "$KEYNAME in /etc/signin/app.env is missing or too short."
  curl -fsS "$URL/api/health" >/dev/null || die "$URL does not answer: finish the sign-in install first."
fi

cp -p "$ENV" "$ENV.before-signin.$(date +%Y%m%d%H%M%S)"
tmp=$(mktemp "$ENV.XXXX")
grep -v -E '^(SIGNIN_URL|SIGNIN_KEY)=' "$ENV" > "$tmp" || true
if [ "$MODE" = on ]; then printf 'SIGNIN_URL=%s\nSIGNIN_KEY=%s\n' "$URL" "$KEY" >> "$tmp"; fi
chown --reference="$ENV" "$tmp"; chmod --reference="$ENV" "$tmp"
mv "$tmp" "$ENV"

systemctl restart "$UNIT"
for i in $(seq 1 20); do
  curl -fsS "$CHECK" >/dev/null 2>&1 && break
  [ "$i" = 20 ] && { journalctl -u "$UNIT" -n 30 --no-pager; die "$APP didn't come back (its log is above). The old settings are in $ENV.before-signin.*"; }
  sleep 1
done
if [ "$MODE" = on ]; then echo "$APP now uses the shared sign-in at $URL."; else echo "$APP is back on its own login page."; fi
