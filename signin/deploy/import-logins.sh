#!/usr/bin/env bash
# Copies one app's existing logins on this server into the shared sign-in. Everyone keeps their
# password; someone already in the sign-in keeps theirs and only gains access. Safe to run again.
#
#   sudo bash import-logins.sh timesheets
#   sudo bash import-logins.sh scheduling-connected   (scheduler using the timesheet's logins)
#   sudo bash import-logins.sh scheduling             (scheduler with its own logins)
#   sudo bash import-logins.sh quoting
#
# It finds each app's database from that app's settings file and reads it as the postgres user.
set -euo pipefail
FROM=${1:?Give the app: timesheets, scheduling-connected, scheduling or quoting}
die() { echo "Stopped: $*" >&2; exit 1; }
[ "$(id -u)" = 0 ] || die "run with sudo."
case $FROM in
  timesheets) ENV=/etc/timesheet/app.env ;;
  scheduling|scheduling-connected) ENV=/etc/scheduler/app.env ;;
  quoting) ENV=/etc/quoting/app.env ;;
  *) die "$FROM is not one of timesheets, scheduling-connected, scheduling, quoting." ;;
esac
[ -f "$ENV" ] || die "$ENV is missing: is that app installed on this server?"
[ -d /srv/signin/current/signin ] || die "the sign-in isn't installed here (run install.sh first)."
SRCDB=$(sed -n 's#^DATABASE_URL=.*/\([A-Za-z0-9_]*\)\(?.*\)\{0,1\}$#\1#p' "$ENV" | tail -1)
[ -n "$SRCDB" ] || die "couldn't read the database name from $ENV."
SOCK=/var/run/postgresql
cd /srv/signin/current/signin
sudo -u postgres env DATABASE_URL="postgresql://postgres@/rule29_signin?host=$SOCK" \
  "$(command -v node)" scripts/import-accounts.js "$FROM" "postgresql://postgres@/$SRCDB?host=$SOCK"
