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
        (SELECT to_char((min(x.issued_at) AT TIME ZONE 'Europe/London')::date, 'YYYY-MM-DD') FROM quoting.proposals x WHERE x.estimate_id = e.id) AS first_issued_on,
        to_char(e.expired_on, 'YYYY-MM-DD') AS expired_on,
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
      kind: r.kind, status: r.status, value: r.value, issuedOn: r.issued_on, firstIssuedOn: r.first_issued_on, validUntil: r.valid_until, expiredOn: r.expired_on,
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

const LOCAL = ts => `to_char(${ts} AT TIME ZONE 'Europe/London', 'YYYY-MM-DD"T"HH24:MI')`;
const FROM = "($2::date)::timestamp AT TIME ZONE 'Europe/London'", TO = "($3::date)::timestamp AT TIME ZONE 'Europe/London'";

/**
 * Scheduling, for crew capacity between from and to (dates, to exclusive): active workers, their
 * assignments, their time away (Scheduling's own holiday, sickness, training and other bookings, plus
 * approved Timesheets leave when connected) and live jobs with the size of their crew. Times are UK local.
 */
async function crew(pool, clientId, from, to) {
  return readOnly(pool, async db => {
    const q = async (sql, params = [clientId, from, to]) => (await db.query(sql, params)).rows;
    const workers = await q(`SELECT id, first_name || ' ' || last_name AS name, job_title FROM integration.workers_v1
      WHERE client_id = $1 AND active ORDER BY last_name, first_name`, [clientId]);
    const assignments = await q(`SELECT a.worker_id, j.job_number, j.name, ${LOCAL('a.starts_at')} AS start, ${LOCAL('a.ends_at')} AS "end", jp.weekend_working
      FROM scheduling.assignments a
      JOIN scheduling.job_plans jp ON jp.client_id = a.client_id AND jp.job_id = a.job_id
      JOIN integration.jobs_v1 j ON j.client_id = a.client_id AND j.id = a.job_id
      WHERE a.client_id = $1 AND a.status = 'assigned' AND jp.status <> 'cancelled' AND a.ends_at > ${FROM} AND a.starts_at < ${TO}`);
    const away = await q(`SELECT worker_id, kind, to_char(date_from, 'YYYY-MM-DD') AS date_from, to_char(date_to, 'YYYY-MM-DD') AS date_to, NULL::numeric AS hours
      FROM scheduling.unavailability WHERE client_id = $1 AND date_to >= $2::date AND date_from < $3::date
      UNION ALL
      SELECT worker_id, kind, to_char(date_from, 'YYYY-MM-DD'), to_char(date_to, 'YYYY-MM-DD'), CASE WHEN partial THEN hours END
      FROM integration.approved_leave_v1 WHERE client_id = $1 AND date_to >= $2::date AND date_from < $3::date`);
    const plans = await q(`SELECT j.job_number, j.name, jp.status, ${LOCAL('jp.starts_at')} AS start, ${LOCAL('jp.ends_at')} AS "end",
        jp.weekend_working, jp.min_crew, jp.lone_working_allowed,
        (SELECT count(*) FROM scheduling.assignments a WHERE a.client_id = jp.client_id AND a.job_id = jp.job_id AND a.status = 'assigned')::int AS crew
      FROM scheduling.job_plans jp JOIN integration.jobs_v1 j ON j.client_id = jp.client_id AND j.id = jp.job_id
      WHERE jp.client_id = $1 AND jp.status IN ('unscheduled', 'scheduled', 'tickets_sent') AND jp.ends_at > ${FROM} AND jp.starts_at < ${TO}`);
    return {
      workers: workers.map(w => ({id: w.id, name: w.name, jobTitle: w.job_title})),
      assignments: assignments.map(a => ({workerId: a.worker_id, jobNumber: a.job_number, jobName: a.name, start: a.start, end: a.end, weekend: a.weekend_working})),
      away: away.map(a => ({workerId: a.worker_id, kind: a.kind, from: a.date_from, to: a.date_to, hours: a.hours === null ? null : Number(a.hours)})),
      plans: plans.map(p => ({jobNumber: p.job_number, name: p.name, status: p.status, start: p.start, end: p.end, weekend: p.weekend_working,
        minCrew: p.min_crew, loneWorking: p.lone_working_allowed, crew: p.crew})),
    };
  });
}

/**
 * Timesheets: hours by week (starting Monday), job, worker and kind between from and to (dates, inclusive).
 * Kind is the job's kind (customer or internal), or holiday or sickness for hours made from leave.
 * Draft timesheets are left out.
 */
async function worked(pool, clientId, from, to) {
  return readOnly(pool, async db => (await db.query(`
    SELECT to_char(date_trunc('week', te.work_date)::date, 'YYYY-MM-DD') AS week, j.legacy_id AS job_number, j.name AS job_name,
      coalesce(lr.kind, j.kind) AS kind, w.id AS worker_id, w.first_name || ' ' || w.last_name AS worker, sum(te.hours)::float8 AS hours
    FROM timesheet.time_entries te
    JOIN timesheet.submissions s ON s.id = te.submission_id
    JOIN timesheet.jobs j ON j.id = te.job_id
    JOIN timesheet.workers w ON w.id = s.worker_id
    LEFT JOIN timesheet.leave_requests lr ON lr.id = te.source_leave_id
    WHERE te.client_id = $1 AND s.status <> 'draft' AND te.work_date BETWEEN $2::date AND $3::date
    GROUP BY 1, 2, 3, 4, 5, 6`, [clientId, from, to])).rows.map(r => ({
    week: r.week, jobNumber: r.job_number, jobName: r.job_name, kind: r.kind, workerId: r.worker_id, worker: r.worker, hours: r.hours,
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
async function firmData(p, firm, today = ukToday()) {
  const {weekStart} = require('./reports');
  const add = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const thisWeek = weekStart(today);
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
  const [q, j, b, c, w] = await Promise.all([
    read('quoting', () => quotes(p.quoting, firm.quoting)),
    read('scheduling', () => jobs(p.scheduling, firm.scheduling)),
    read('timesheets', () => booked(p.timesheets, firm.timesheets)),
    read('scheduling', () => crew(p.scheduling, firm.scheduling, today, add(thisWeek, 56))),
    read('timesheets', () => worked(p.timesheets, firm.timesheets, add(thisWeek, -77), today)),
  ]);
  return {quotes: q, jobs: j, booked: b, crew: Array.isArray(c) ? {} : c, worked: w, have, problems};
}

module.exports = {quotes, jobs, booked, crew, worked, pools, firmData, ukToday, APPROVED};
