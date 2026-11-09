#!/usr/bin/env bash
# Links a firm's records in Quoting, Scheduling and Timesheets into one MIS firm, and gives people
# access to it. Run on the server, as root:
#
#   sudo bash add-firm.sh list
#       shows each firm in each app with its id
#   sudo bash add-firm.sh add <short-name> "<Firm name>" quoting=<id> scheduling=<id> timesheets=<id>
#       makes (or updates) the MIS firm; leave out any app the firm doesn't use
#   sudo bash add-firm.sh grant <email> <short-name>
#       lets that login open the MIS for that firm (they must already have a login)
#   sudo bash add-firm.sh day-hours <short-name> <hours>
#       sets the firm's normal working day for crew capacity, e.g. 10 (8 if never set)
#
# Firms are kept in /etc/mis/firms.json; the MIS reads it again within a minute, no restart needed.
set -euo pipefail
QUOTING_DB=${QUOTING_DB:-sands_quoting}
SCHEDULING_DB=${SCHEDULING_DB:-rule29_scheduler}
TIMESHEETS_DB=${TIMESHEETS_DB:-rule29_timesheets_demo}
FIRMS=/etc/mis/firms.json
die() { echo "Stopped: $*" >&2; exit 1; }
[ "$(id -u)" = 0 ] || die "run with sudo."
pg() { sudo -u postgres env PGOPTIONS=--client-min-messages=warning psql -v ON_ERROR_STOP=1 -qtA "$@"; }
dbExists() { [ "$(pg -c "SELECT 1 FROM pg_database WHERE datname='$1'")" = 1 ]; }
NODE=$(command -v node) || die "node is not installed."

case "${1:-}" in
list)
  show() { # app, database, query
    echo; echo "$1 ($2):"
    if dbExists "$2"; then pg -d "$2" -F '   ' -c "$3" | sed 's/^/  /'; else echo "  no database called $2"; fi
  }
  show Quoting "$QUOTING_DB" "SELECT id, name FROM quoting.companies ORDER BY name"
  show Scheduling "$SCHEDULING_DB" "SELECT id, name FROM integration.clients_v1 ORDER BY name"
  show Timesheets "$TIMESHEETS_DB" "SELECT id, name FROM timesheet.clients ORDER BY name"
  echo; echo "MIS firms now:"; cat "$FIRMS" 2>/dev/null || echo "  none"
  ;;
add)
  id=${2:?Give a short name for the firm, e.g. ss}
  name=${3:?Give the firm name in quotes, e.g. "S&S Builders"}
  [[ $id =~ ^[a-z0-9-]{2,40}$ ]] || die "use lower-case letters, numbers and - for the short name."
  shift 3
  [ -f "$FIRMS" ] || echo '[]' > "$FIRMS"
  "$NODE" -e '
    const fs = require("fs"), [file, id, name, ...links] = process.argv.slice(1);
    const die = m => { console.error("Stopped: " + m); process.exit(1); };
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const firm = {id, name};
    for (const l of links) {
      const [app, value] = l.split("=");
      if (!["quoting", "scheduling", "timesheets"].includes(app)) die(`"${l}": use quoting=, scheduling= or timesheets=`);
      if (!UUID.test(value || "")) die(`"${l}": that is not an id from the list`);
      firm[app] = value.toLowerCase();
    }
    const all = JSON.parse(fs.readFileSync(file, "utf8")), old = all.find(f => f.id === id);
    if (old && old.dayHours) firm.dayHours = old.dayHours;   // keep the working day already set
    const list = all.filter(f => f.id !== id);
    list.push(firm);
    fs.writeFileSync(file, JSON.stringify(list, null, 2) + "\n");
    console.log(`Saved ${name} (${id}): ` + (["quoting", "scheduling", "timesheets"].filter(a => firm[a]).join(", ") || "no apps linked"));
  ' "$FIRMS" "$id" "$name" "$@"
  chown root:mis "$FIRMS"; chmod 640 "$FIRMS"
  ;;
grant)
  email=$(echo "${2:?Give the login email}" | tr '[:upper:]' '[:lower:]')
  id=${3:?Give the firm short name}
  name=$("$NODE" -e 'const f = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).find(x => x.id === process.argv[2]); if (!f) process.exit(1); console.log(f.name)' "$FIRMS" "$id") \
    || die "no MIS firm called $id: add it first."
  # Values go in as psql variables, so names with quotes or & can't break the statement.
  n=$(pg -d rule29_signin -v email="$email" -v tenant="$id" -v tname="$name" <<'SQL'
INSERT INTO identity.app_access (account_id, app, tenant_id, tenant_name, role)
SELECT id, 'mis', :'tenant', :'tname', '' FROM identity.accounts WHERE email = :'email'
ON CONFLICT (account_id, app, tenant_id) DO UPDATE SET tenant_name = EXCLUDED.tenant_name
RETURNING 1;
SQL
)
  [ "$n" = 1 ] || die "no login with the email $email. Add the person on the sign-in's setup page first."
  echo "$email can now open the MIS for $name."
  ;;
"day-hours")
  id=${2:?Give the firm short name}
  hours=${3:?Give the hours in a working day, e.g. 10}
  "$NODE" -e '
    const fs = require("fs"), [file, id, hours] = process.argv.slice(1);
    const die = m => { console.error("Stopped: " + m); process.exit(1); };
    const h = Number(hours);
    if (!(h > 0 && h <= 24)) die("give the hours in a working day, from 1 to 24, e.g. 10 or 7.5");
    const list = JSON.parse(fs.readFileSync(file, "utf8")), firm = list.find(f => f.id === id);
    if (!firm) die(`no MIS firm called ${id}: add it first.`);
    firm.dayHours = h;
    fs.writeFileSync(file, JSON.stringify(list, null, 2) + "\n");
    console.log(`${firm.name} now has a ${h}-hour working day in crew capacity.`);
  ' "$FIRMS" "$id" "$hours"
  chown root:mis "$FIRMS"; chmod 640 "$FIRMS"
  ;;
*)
  sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'
  exit 1
  ;;
esac
