# Putting the MIS live

The MIS answers at **https://management.rule29.co.uk**, on the same server as the other apps (185.44.254.36). People sign in with the shared sign-in. It only reads the Quoting, Scheduling and Timesheets databases and never changes them.

Each step says which machine to run it on.

## 1. Point the address at the server (DNS)

In the DNS settings for `rule29.co.uk`, add `management` the same way as `signin`, `quoting` and the others: an A record pointing to `185.44.254.36`.

**On your own computer**, check it has taken effect. It should print `185.44.254.36`:

```bash
dig +short management.rule29.co.uk
```

## 2. Install the MIS

**On your own computer**, in your copy of this repository:

```bash
git pull
bash mis/deploy/ship.sh you@185.44.254.36 rule29.co.uk
```

Use the same server login as you did for the sign-in. This copies `main` to the server and runs `install.sh`, which does the following:

- creates a `mis` system user
- creates the database login `rule29_mis_reader`, which can only read these tables:
  - in Quoting: quotes, proposals, customers, lead sources and payment stages
  - in Scheduling: job plans and handovers
  - in Timesheets: time entries, submissions and jobs
- writes `/etc/mis/app.env`, with the database addresses and the MIS key taken from the sign-in's settings
- starts the `mis` service on port 3400, adds the nginx site and gets the certificate

It prints a line for each app it can read. If one says "no database called …", tell Claude the right name.

Running it again for a later release keeps the settings and the firms list.

## 3. Link your firm and give yourself access

**On the server**:

```bash
cd /srv/mis/current/mis/deploy
sudo bash add-firm.sh list
```

This lists every firm in each app with its id, which is a long code like `3f2a…`. Pick the lines that are the same firm, then put the three ids into this command:

```bash
sudo bash add-firm.sh add ss "S&S Builders" quoting=<id from Quoting> scheduling=<id from Scheduling> timesheets=<id from Timesheets>
sudo bash add-firm.sh grant john@johnolivant.co.uk ss
```

`ss` is a short name you choose for the firm. If you'd rather not work out the ids yourself, paste the `list` output to Claude and you'll get back the exact commands.

Once one person has access, the firm also appears under **Management Information** on the sign-in's setup page (https://signin.rule29.co.uk/setup), so anyone else can be given access there.

## 4. Check it works

1. Open https://management.rule29.co.uk. You should go straight in if you're already signed in to another app. If not, you'll see the sign-in page first.
2. The four tabs should show your firm's figures.
3. If a yellow note says an app is "not linked", that app's id is missing from step 3.

Logs, **on the server**:

```bash
journalctl -u mis -n 50
```

## Later releases

**On your own computer**, run the same command as in step 2:

```bash
git pull
bash mis/deploy/ship.sh you@185.44.254.36 rule29.co.uk
```
