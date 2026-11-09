'use strict';
// Reads one firm's data from the three apps' databases, read-only, as the rule29_mis_reader role.
// The MIS never writes to them (product description section 8). Each app keeps its own firm id
// (Quoting company_id, Scheduling and Timesheets client_id); firms.json says which ids are one firm.

const APPROVED = ['supervisor_approved', 'payroll_approved', 'exported'];

/** Runs fn in a read-only transaction. `setup` statements run first (Quoting's row security needs the firm set). */
async function readOnly(pool, fn, setup = []) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN READ ONLY');
    await db.query("SET LOCAL statement_timeout = '15s'");
    for (const [sql, params] of setup) await db.query(sql, params);
    return await fn(db);
  } finally {
    await db.query('ROLLBACK').catch(() => {});
    db.release();
  }
}

/** Quoting: every estimate with an issued proposal, its latest proposal's value and its payment stages. */
async function quotes(pool, companyId) {
  return readOnly(pool, async db => {
    const found = (await db.query(`
      SELECT e.id, e.reference, e.title, c.name AS customer, ls.name AS lead_source, e.job_type, e.kind, e.status,
        p.document->'price'->>'total' AS value,
        to_char((p.issued_at AT TIME ZONE 'Europe/London')::date, 'YYYY-MM-DD') AS issued_on,
        p.document->>'validUntil' AS valid_until,
        coalesce(e.accepted_total::text, rp.document->'price'->>'total') AS accepted_value,
        to_char(e.response_on, 'YYYY-MM-DD') AS responded_on,
        e.job_cancelled_at IS NOT NULL AS cancelled, to_char(e.completed_on, 'YYYY-MM-DD') AS completed_on,
        to_char(e.programme_starts, 'YYYY-MM-DD') AS programme_starts, to_char(e.programme_ends, 'YYYY-MM-DD') AS programme_ends,
        e.schedule_state
      FROM quoting.estimates e
      JOIN LATERAL (SELECT * FROM quoting.proposals x WHERE x.estimate_id = e.id ORDER BY x.number DESC LIMIT 1) p ON true
      LEFT JOIN quoting.proposals rp ON rp.id = e.response_proposal_id
      LEFT JOIN quoting.customers c ON c.id = e.customer_id
      LEFT JOIN quoting.lead_sources ls ON ls.id = e.lead_source_id
      WHERE e.company_id = $1 AND e.status <> 'withdrawn'`, [companyId])).rows;
    const stages = (await db.query(`
      SELECT estimate_id, description, percent::text AS percent, to_char(expected_on, 'YYYY-MM-DD') AS expected_on
      FROM quoting.payment_stages WHERE company_id = $1 ORDER BY estimate_id, sort_order`, [companyId])).rows;
    const byEstimate = new Map();
    for (const s of stages) {
      if (!byEstimate.has(s.estimate_id)) byEstimate.set(s.estimate_id, []);
      byEstimate.get(s.estimate_id).push({description: s.description, percent: s.percent, expectedOn: s.expected_on});
    }
    return found.map(r => ({
      reference: r.reference, title: r.title, customer: r.customer, leadSource: r.lead_source, jobType: r.job_type,
      kind: r.kind, status: r.status, value: r.value, issuedOn: r.issued_on, validUntil: r.valid_until,
      acceptedValue: r.accepted_value, respondedOn: r.responded_on, cancelled: r.cancelled, completedOn: r.completed_on,
      programmeStarts: r.programme_starts, programmeEnds: r.programme_ends, scheduleState: r.schedule_state,
      stages: byEstimate.get(r.id) || [],
    }));
  }, [["SELECT set_config('quoting.company_id', $1, true)", [companyId]]]);
}

/**
 * Scheduling: each planned job with its planned hours, and the quoted hours from the handover Quoting sent.
 * Jobs and job numbers come through integration.jobs_v1, which exists in standalone and connected mode.
 */
async function jobs(pool, clientId) {
  return readOnly(pool, async db => (await db.query(`
    SELECT j.job_number, j.name, jp.status,
      to_char((jp.starts_at AT TIME ZONE 'Europe/London')::date, 'YYYY-MM-DD') AS starts_on,
      to_char((jp.ends_at AT TIME ZONE 'Europe/London')::date, 'YYYY-MM-DD') AS ends_on,
      jp.planned_minutes / 60.0 AS planned_hours,
      (SELECT h.content->'totals'->>'manHours' FROM scheduling.handovers h
        WHERE h.client_id = jp.client_id AND h.job_id = jp.job_id AND h.status = 'confirmed'
        ORDER BY h.received_at DESC LIMIT 1) AS quoted_hours
    FROM scheduling.job_plans jp
    JOIN integration.jobs_v1 j ON j.id = jp.job_id AND j.client_id = jp.client_id
    WHERE jp.client_id = $1`, [clientId])).rows.map(r => ({
    jobNumber: r.job_number, name: r.name, status: r.status, startsOn: r.starts_on, endsOn: r.ends_on,
    plannedHours: r.planned_hours === null ? null : Number(r.planned_hours),
    quotedHours: r.quoted_hours === null || r.quoted_hours === '' ? null : Number(r.quoted_hours),
  })));
}

/** Timesheets: hours booked to each job, approved and not yet approved. Hours made from leave are left out. */
async function booked(pool, clientId) {
  return readOnly(pool, async db => (await db.query(`
    SELECT j.legacy_id AS job_number, j.name AS job_name, j.kind,
      coalesce(sum(te.hours) FILTER (WHERE s.status = ANY($2)), 0)::float8 AS approved,
      coalesce(sum(te.hours) FILTER (WHERE NOT s.status = ANY($2)), 0)::float8 AS pending,
      to_char(min(te.work_date), 'YYYY-MM-DD') AS first_date, to_char(max(te.work_date), 'YYYY-MM-DD') AS last_date
    FROM timesheet.time_entries te
    JOIN timesheet.submissions s ON s.id = te.submission_id
    JOIN timesheet.jobs j ON j.id = te.job_id
    WHERE te.client_id = $1 AND te.source_leave_id IS NULL
    GROUP BY j.legacy_id, j.name, j.kind`, [clientId, APPROVED])).rows.map(r => ({
    jobNumber: r.job_number, jobName: r.job_name, kind: r.kind, approved: r.approved, pending: r.pending,
    firstDate: r.first_date, lastDate: r.last_date,
  })));
}

/** Today's date in the UK. */
const ukToday = (now = new Date()) => new Intl.DateTimeFormat('en-CA', {timeZone: 'Europe/London'}).format(now);

/**
 * Pools for the apps that have a database address set; an app without one is simply not read.
 * {quoting, scheduling, timesheets} -> pg.Pool or undefined
 */
function pools(env, Pool) {
  const make = url => url ? new Pool({connectionString: url, max: 3, application_name: 'rule29-mis'}) : undefined;
  return {quoting: make(env.QUOTING_DATABASE_URL), scheduling: make(env.SCHEDULING_DATABASE_URL), timesheets: make(env.TIMESHEETS_DATABASE_URL)};
}

/** One firm's data from every app it is linked to. A source that fails is reported, not fatal. */
async function firmData(p, firm) {
  const have = {quoting: !!(p.quoting && firm.quoting), scheduling: !!(p.scheduling && firm.scheduling), timesheets: !!(p.timesheets && firm.timesheets)};
  const problems = [];
  const read = async (name, fn) => {
    if (!have[name]) return [];
    try { return await fn(); } catch (e) {
      have[name] = false;
      problems.push(`${name}: ${e.message}`);
      return [];
    }
  };
  const [q, j, b] = await Promise.all([
    read('quoting', () => quotes(p.quoting, firm.quoting)),
    read('scheduling', () => jobs(p.scheduling, firm.scheduling)),
    read('timesheets', () => booked(p.timesheets, firm.timesheets)),
  ]);
  return {quotes: q, jobs: j, booked: b, have, problems};
}

module.exports = {quotes, jobs, booked, pools, firmData, ukToday, APPROVED};
