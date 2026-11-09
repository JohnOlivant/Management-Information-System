'use strict';
// Runs the MIS's database reads against the real schemas of Quoting, Scheduling (standalone mode) and
// Timesheets, as the rule29_mis_reader role with only the grants in db/reader-*.sql.
//
// Set up once (see README): three databases built from each app's own db/*.sql files, the reader role,
// and the grants. Then:
//   ADMIN_URL=postgresql://postgres:pw@127.0.0.1 READER_URL=postgresql://rule29_mis_reader:pw@127.0.0.1 \
//   QUOTING_DB=t_quoting SCHEDULING_DB=t_sched TIMESHEETS_DB=t_ts npm run test:integration
const test = require('node:test');
const assert = require('node:assert/strict');
const {Pool} = require('pg');
const {quotes, jobs, booked, firmData} = require('../src/sources');
const {allReports} = require('../src/reports');
const tsReport = require('../src/timesheet-report');

const env = process.env;
const url = (base, db) => `${base.replace(/\/$/, '')}/${db}`;
const admin = db => new Pool({connectionString: url(env.ADMIN_URL, db), max: 1});
const reader = db => new Pool({connectionString: url(env.READER_URL, db), max: 2});
const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222';

async function seedQuoting() {
  const db = admin(env.QUOTING_DB);
  try {
    await db.query('BEGIN');
    await db.query(`TRUNCATE quoting.companies CASCADE`);
    await db.query(`TRUNCATE quoting.accounts CASCADE`);
    await db.query(`INSERT INTO quoting.companies (id, name) VALUES ($1, 'Firm A'), ($2, 'Firm B')`, [A, B]);
    const acc = (await db.query(`INSERT INTO quoting.accounts (email, display_name, password_hash) VALUES ('a@x.co', 'A', 'x') RETURNING id`)).rows[0].id;
    for (const [company, ref, status, value, extra] of [
      [A, 'Q00001', 'issued', '1000.00', {}],
      [A, 'Q00002', 'authorised', '5000.00', {stages: true}],
      [A, 'Q00003', 'withdrawn', '9.00', {}],
      [B, 'Q00001', 'issued', '777.00', {}],
    ]) {
      await db.query(`SELECT set_config('quoting.company_id', $1, true)`, [company]);
      const cust = (await db.query(`INSERT INTO quoting.customers (company_id, name) VALUES ($1, $2) RETURNING id`, [company, 'Cust ' + ref])).rows[0].id;
      const e = (await db.query(`INSERT INTO quoting.estimates (company_id, reference, title, customer_id, kind, status, owner_id, response_on, accepted_total)
        VALUES ($1,$2,$3,$4,'firm',$5,$6,$7,$8) RETURNING id`,
      [company, ref, 'Job ' + ref, cust, status, acc, status === 'authorised' ? '2026-10-01' : null, status === 'authorised' ? '5100.00' : null])).rows[0].id;
      const r = (await db.query(`INSERT INTO quoting.revisions (company_id, estimate_id, number, vat_applied, policy, sheet)
        VALUES ($1,$2,1,true,'{}','{}') RETURNING id`, [company, e])).rows[0].id;
      const doc = {price: {total: value, vat: null, totalIncVat: value}, validUntil: '2099-01-01'};
      const p = (await db.query(`INSERT INTO quoting.proposals (company_id, estimate_id, revision_id, number, document, checksum, pdf, file_name, issued_by, issued_at)
        VALUES ($1,$2,$3,1,$4,'c','\\x00','q.pdf',$5,'2026-10-01T10:00:00Z') RETURNING id`, [company, e, r, doc, acc])).rows[0].id;
      if (status === 'authorised') {
        await db.query(`UPDATE quoting.estimates SET response_proposal_id=$2 WHERE id=$1`, [e, p]);
        await db.query(`INSERT INTO quoting.payment_stages (company_id, estimate_id, sort_order, description, percent, expected_on)
          VALUES ($1,$2,0,'Deposit',20,'2026-12-01'), ($1,$2,1,'Final',80,'2027-01-15')`, [company, e]);
      }
    }
    await db.query('COMMIT');
  } finally { await db.end(); }
}

async function seedScheduling() {
  const db = admin(env.SCHEDULING_DB);
  try {
    await db.query('TRUNCATE standalone.clients CASCADE');
    await db.query('TRUNCATE scheduling.job_plans, scheduling.handovers CASCADE');
    await db.query(`INSERT INTO standalone.clients (id, name) VALUES ($1,'A'), ($2,'B')`, [A, B]);
    const job = (await db.query(`INSERT INTO standalone.jobs (client_id, legacy_id, name, kind) VALUES ($1,'Q00002','Job Q00002','customer') RETURNING id`, [A])).rows[0].id;
    const jobB = (await db.query(`INSERT INTO standalone.jobs (client_id, legacy_id, name, kind) VALUES ($1,'Q00009','Other firm','customer') RETURNING id`, [B])).rows[0].id;
    await db.query(`INSERT INTO scheduling.job_plans (job_id, client_id, starts_at, ends_at, planned_minutes, status)
      VALUES ($1,$2,'2026-11-01T08:00:00Z','2026-11-30T17:00:00Z', 6000, 'scheduled'), ($3,$4,'2026-11-01T08:00:00Z','2026-11-30T17:00:00Z', 60, 'scheduled')`, [job, A, jobB, B]);
    await db.query(`INSERT INTO scheduling.handovers (client_id, quoting_estimate_id, key, checksum, reference, title, content, status, job_id)
      VALUES ($1, gen_random_uuid(), 'k1', repeat('a',64), 'Q00002', 'Job', '{"totals":{"manHours":"95.5"}}', 'confirmed', $2)`, [A, job]);
  } finally { await db.end(); }
}

async function seedTimesheets() {
  const db = admin(env.TIMESHEETS_DB);
  try {
    await db.query('TRUNCATE timesheet.clients CASCADE');
    await db.query(`INSERT INTO timesheet.clients (id, name) VALUES ($1,'A'), ($2,'B')`, [A, B]);
    for (const c of [A, B]) {
      const w = (await db.query(`INSERT INTO timesheet.workers (client_id, legacy_id, first_name, last_name) VALUES ($1,'W1','Al','Smith') RETURNING id`, [c])).rows[0].id;
      const j = (await db.query(`INSERT INTO timesheet.jobs (client_id, legacy_id, name, kind) VALUES ($1,'Q00002','Job two','customer') RETURNING id`, [c])).rows[0].id;
      const code = (await db.query(`INSERT INTO timesheet.codes (client_id, legacy_id, label) VALUES ($1,'N','Normal') RETURNING id`, [c])).rows[0].id;
      let n = 0;
      for (const [status, hours] of [['payroll_approved', 8], ['submitted', 3]]) {
        n += 1;
        const per = (await db.query(`INSERT INTO timesheet.pay_periods (client_id, date_from, date_to, label) VALUES ($1, $2::date, $2::date + 6, 'wk') RETURNING id`,
          [c, `2026-10-${String(n * 7).padStart(2, '0')}`])).rows[0].id;
        const s = (await db.query(`INSERT INTO timesheet.submissions (client_id, worker_id, period_id, status) VALUES ($1,$2,$3,$4) RETURNING id`, [c, w, per, status])).rows[0].id;
        await db.query(`INSERT INTO timesheet.time_entries (client_id, submission_id, job_id, code_id, work_date, hours) VALUES ($1,$2,$3,$4,$5,$6)`,
          [c, s, j, code, `2026-10-${String(n * 7).padStart(2, '0')}`, c === A ? hours : 20]);
      }
    }
  } finally { await db.end(); }
}

const ready = env.ADMIN_URL && env.READER_URL && env.QUOTING_DB && env.SCHEDULING_DB && env.TIMESHEETS_DB;

test('reads each app as the reader role, one firm only', {skip: !ready && 'set ADMIN_URL, READER_URL and the three database names'}, async () => {
  await seedQuoting(); await seedScheduling(); await seedTimesheets();
  const p = {quoting: reader(env.QUOTING_DB), scheduling: reader(env.SCHEDULING_DB), timesheets: reader(env.TIMESHEETS_DB)};
  try {
    const q = await quotes(p.quoting, A);
    assert.deepEqual(q.map(x => x.reference).sort(), ['Q00001', 'Q00002'], 'withdrawn and other firm left out');
    const won = q.find(x => x.reference === 'Q00002');
    assert.equal(won.acceptedValue, '5100.00');
    assert.equal(won.stages.length, 2);
    assert.equal(won.issuedOn, '2026-10-01');
    assert.deepEqual((await quotes(p.quoting, B)).map(x => x.value), ['777.00']);

    const j = await jobs(p.scheduling, A);
    assert.deepEqual(j, [{jobNumber: 'Q00002', name: 'Job Q00002', status: 'scheduled', startsOn: '2026-11-01', endsOn: '2026-11-30', plannedHours: 100, quotedHours: 95.5}]);

    const b = await booked(p.timesheets, A);
    assert.equal(b.length, 1);
    assert.equal(b[0].approved, 8); assert.equal(b[0].pending, 3);

    const d = await firmData(p, {id: 'a', name: 'A', quoting: A, scheduling: A, timesheets: A});
    assert.deepEqual(d.problems, []);
    const r = allReports(d, '2026-11-09');
    assert.equal(r.pipeline.count, 1);
    assert.equal(r.orderBook.value, 5100);
    assert.deepEqual(r.orderBook.cashIn.slice(1, 3).map(m => m.value), [1020, 4080]);
    assert.equal(r.hours.jobs[0].usedShare, 11);
    assert.deepEqual(r.fixes, []);

    // The Timesheet report reads the same lines as Timesheets does, for this firm only.
    const ref = await tsReport.reference(p.timesheets, A);
    assert.equal(ref.workers.length, 1); assert.equal(ref.jobs.length, 1); assert.equal(ref.periods.length, 2);
    const f = tsReport.filters(new URLSearchParams({from: '2026-10-01', to: '2026-10-31'}));
    const rep = tsReport.build(await tsReport.lines(p.timesheets, A, f), f, A);
    assert.equal(rep.totals.hours, 11);
    assert.equal(rep.byJob[0].reference, 'Q00002');
    const approved = tsReport.build(await tsReport.lines(p.timesheets, A, {...f, approval: 'approved'}), f, A);
    assert.equal(approved.totals.hours, 8);
    assert.match(tsReport.csv(rep, 'jobs'), /Q00002/);

    // The reader cannot write.
    await assert.rejects(p.timesheets.query(`DELETE FROM timesheet.jobs`), /permission denied/);
    await assert.rejects(p.quoting.query(`SELECT * FROM quoting.accounts`), /permission denied/);
  } finally { await Promise.all(Object.values(p).map(x => x.end())); }
});
