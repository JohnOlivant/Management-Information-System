# Management Information (MIS)

The first MIS reports, built from the data Quoting, Scheduling and Timesheets already hold. Xero (invoiced, paid and job costs) comes later.

| Tab | What it shows | From |
| --- | --- | --- |
| Quote pipeline | Open quotes by month sent, customer, lead source and job type; quotes running out in the next 14 days | Quoting |
| Win rate | Quotes first sent in the last 12 months that were won, declined or ran out, by month, lead source, job type and customer; typical time to an answer | Quoting |
| Order book and cash in | Won jobs not yet complete and the money expected each month from their payment stages | Quoting |
| Crew capacity | Crew hours available (8 a day, Monday to Friday, less time away) against hours booked, this week and the next seven; jobs short of crew; each worker week by week | Scheduling |
| Hours by job | Quoted, planned and booked hours per job; jobs past 80% of plan or over it | Scheduling, Timesheets |
| Where the hours went | The last 12 weeks of timesheet hours split between customer jobs, internal work and leave, by week, job and worker | Timesheets |
| Timesheet report | The Timesheets app's own report for the whole firm: hours, subsistence, expenses and mileage by worker, job, code, activity, expense category and approval status, with its CSV downloads | Timesheets |
| Things to fix | Won jobs with no payment stages or not in Scheduling, jobs with no planned hours, timesheet hours on unknown job numbers | All three |

Jobs are joined across the apps on the job number, which is the quote reference (for example `Q00012`). Capitals and spaces are ignored when matching.

## Run it locally

```sh
cd mis
npm install
npm run demo      # http://localhost:3400, made-up data, no sign-in
```

## How it fits together

- **Sign-in:** the shared sign-in (`../signin`). Someone can open the MIS for a firm when their login has `mis` access for that firm. The tenant id is the MIS firm's short name.
- **Firms:** `/etc/mis/firms.json` links one MIS firm to its id in each app (Quoting `company_id`, Scheduling and Timesheets `client_id`), as these differ until MIS gap G5 is settled. `deploy/add-firm.sh` keeps it.
- **Data:** read-only, as the `rule29_mis_reader` database role, with only the grants in `db/reader-*.sql`. Quoting's row security still applies; the MIS sets the firm on each read. Scheduling is read through `integration.jobs_v1`, so standalone and connected mode both work. Answers are cached for a minute.

## Settings

| Variable | Meaning |
| --- | --- |
| `SIGNIN_URL`, `SIGNIN_KEY` | The shared sign-in and the MIS's key there (`SIGNIN_KEY_MIS`). Without them the demo runs, which is refused when `NODE_ENV=production` |
| `MIS_ORIGIN` | The MIS's own address, e.g. `https://management.rule29.co.uk` |
| `QUOTING_DATABASE_URL`, `SCHEDULING_DATABASE_URL`, `TIMESHEETS_DATABASE_URL` | Each app's database, as `rule29_mis_reader`. An app without one is left out |
| `FIRMS_FILE` | Defaults to `/etc/mis/firms.json` |
| `PORT`, `HOST` | Default `3400`, `127.0.0.1` |

## Tests

```sh
npm test    # reports and the web app, no database
```

The database test builds each app's real schema from its own repository and reads it as the reader role:

```sh
# three databases, each made from that app's db/*.sql (Scheduling: db/standalone/001 first), then:
psql -c "CREATE ROLE rule29_mis_reader LOGIN PASSWORD 'pw'"
psql -d t_quoting -f db/reader-quoting.sql   # and the same for scheduling and timesheets
ADMIN_URL=postgresql://postgres:pw@127.0.0.1 READER_URL=postgresql://rule29_mis_reader:pw@127.0.0.1 \
  QUOTING_DB=t_quoting SCHEDULING_DB=t_sched TIMESHEETS_DB=t_ts npm run test:integration
```

## Putting it live

[deploy/RUNBOOK.md](deploy/RUNBOOK.md).
