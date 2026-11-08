# Putting the shared sign-in live

The apps sit under `rule29.co.uk`:

| App | Address | Settings file on the server |
| --- | --- | --- |
| Sign-in | https://signin.rule29.co.uk | `/etc/signin/app.env` |
| Timesheets | https://timesheets.rule29.co.uk | `/etc/timesheet/app.env` |
| Scheduling | https://scheduling.rule29.co.uk | `/etc/scheduler/app.env` |
| Quoting | https://quoting.rule29.co.uk | `/etc/quoting/app.env` |
| MIS | https://management.rule29.co.uk | not built yet |

One cookie, set for `rule29.co.uk`, is what makes one sign-in work across every app. Nothing changes for anyone until step 4, and step 4 can be undone one app at a time.

## 1. Before you start

- Merge the sign-in pull request (Management-Information-System #1), then Timesheets #9, Scheduling #6 and Quoting #42. Each app's shared sign-in stays off until its settings are set, so merging changes nothing for users.
- Ship each app's new release as usual so the server runs the merged code.
- In DNS, point `signin.rule29.co.uk` at the server, using the same record type as the other apps. Wait until `dig +short signin.rule29.co.uk` shows the server's address.
- The server already has Node 24, PostgreSQL, nginx and certbot from the other apps.

## 2. Install the sign-in

From your own computer, in this repository:

```bash
bash signin/deploy/ship.sh you@185.44.254.36 rule29.co.uk
```

This copies `main` to the server and runs `install.sh`, which does the following:

- creates the `signin` system user and the `rule29_signin` database
- applies the database files
- writes `/etc/signin/app.env`, with the database password and one random key per app
- writes `/etc/signin/apps.json`, with each app's address
- starts the `signin` service on port 3900, adds the nginx site and gets the certificate

Running it again for a later release keeps the settings and the data.

Check it: https://signin.rule29.co.uk/?app=timesheets should show the sign-in page in the Timesheets colours.

## 3. Copy the logins in

On the server:

```bash
cd /srv/signin/current/signin/deploy
sudo bash import-logins.sh timesheets
sudo bash import-logins.sh scheduling-connected   # or "scheduling" if the scheduler has its own logins
sudo bash import-logins.sh quoting
```

Everyone keeps their current password. Someone who uses two apps gets one login, and that login keeps the password from the first import. If they had a different password in the second app, they use the first one. Each script prints how many logins it copied, and running one again is safe.

To add someone new before an app's user screen can do it:

```bash
cd /srv/signin/current/signin
sudo -u postgres env DATABASE_URL='postgresql://postgres@/rule29_signin?host=/var/run/postgresql' \
  node scripts/add-account.js person@firm.co.uk "Their Name" timesheets:<client_id>:admin
```

## 4. Switch the apps over, one at a time

```bash
sudo bash connect-app.sh timesheets
```

This adds `SIGNIN_URL` and the app's key to the app's settings file, keeps a dated copy of the old file, restarts the app and checks that it came back. Then do the checks in step 5 before you move on to `scheduling` and `quoting`.

To switch an app back to its own login page:

```bash
sudo bash connect-app.sh timesheets off
```

If an app runs on a different server, add these two lines to its settings file by hand and restart it:

```
SIGNIN_URL=https://signin.rule29.co.uk
SIGNIN_KEY=<the SIGNIN_KEY_TIMESHEETS value from /etc/signin/app.env>
```

## 5. Check it works

1. Open https://timesheets.rule29.co.uk in a private window. It should send you to the sign-in page.
2. Sign in. You should land back in Timesheets.
3. Open https://quoting.rule29.co.uk. It should open without asking you to sign in again, once Quoting is switched over too.
4. Sign out in one app. Reloading any app should then show the sign-in page.
5. Five wrong passwords for one account should lock that account out for 15 minutes.

Logs:

```bash
journalctl -u signin -n 50
```

## Keys and backups

- Each app's key lives in two places: the `SIGNIN_KEY_<APP>` line in `/etc/signin/app.env` and that app's own `SIGNIN_KEY`. To change a key:
  1. Edit the line in `/etc/signin/app.env`.
  2. Run `systemctl restart signin`.
  3. Run `connect-app.sh <app>` again.
- Include the `rule29_signin` database in the nightly backup alongside the other app databases. Without it, nobody can sign in to any app that uses the shared sign-in.
