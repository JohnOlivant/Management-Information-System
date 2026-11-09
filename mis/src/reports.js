'use strict';
// The first MIS reports, built from what Quoting, Scheduling and Timesheets already hold. Pure: each
// takes the firm's data as read by sources.js (or the demo data) and today's date, so it is tested
// without a database. Money is ex VAT and kept in pence while adding up.
//
//   pipeline  open quotes waiting for the customer (product description V1)
//   orderBook won jobs not yet complete and the money expected from their payment stages (V3, V5 without Xero)
//   hours     planned against used hours per job, with jobs running over flagged (V7 inputs, alert A2)
//   fixes     data that stops the numbers being trusted (alert A3)

const WON = ['accepted', 'authorised'];
const WARN_SHARE = 0.8;   // A2: flag a job once its hours pass 80% of plan
const EXPIRY_DAYS = 14;   // quotes running out within this many days are listed

const pence = v => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v))) ? 0 : Math.round(Number(v) * 100);
const pounds = p => p / 100;
const month = d => d.slice(0, 7);
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
const round1 = n => Math.round(n * 10) / 10;
/** Job numbers are matched without regard to case or spaces, as people type them differently. */
const jobKey = n => String(n || '').replace(/\s+/g, '').toUpperCase();

/** The next `count` months from today's month, as YYYY-MM. */
function monthsFrom(today, count) {
  const [y, m] = today.split('-').map(Number);
  return Array.from({length: count}, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 + i, 1));
    return d.toISOString().slice(0, 7);
  });
}

function addTo(map, key, p) {
  const row = map.get(key) || {key, count: 0, value: 0};
  row.count += 1; row.value += p;
  map.set(key, row);
}
const sorted = map => [...map.values()].sort((a, b) => b.value - a.value || a.key.localeCompare(b.key))
  .map(r => ({...r, value: pounds(r.value)}));

/** A quote still waiting for the customer: issued, unanswered, not past its validity. */
const isOpen = (q, today) => q.status === 'issued' && !(q.validUntil && q.validUntil < today);
/** A won job still to finish: accepted or authorised, not cancelled, not marked complete. */
const isLive = q => WON.includes(q.status) && !q.cancelled && !q.completedOn;
const wonValue = q => pence(q.acceptedValue ?? q.value);

function pipeline(quotes, today) {
  const open = quotes.filter(q => isOpen(q, today));
  const byMonth = new Map(), byCustomer = new Map(), bySource = new Map(), byType = new Map();
  let total = 0, firm = 0;
  for (const q of open) {
    const p = pence(q.value);
    total += p; if (q.kind === 'firm') firm += p;
    addTo(byMonth, month(q.issuedOn), p);
    addTo(byCustomer, q.customer || 'No customer', p);
    addTo(bySource, q.leadSource || 'Not recorded', p);
    addTo(byType, q.jobType || 'Not recorded', p);
  }
  const soon = addDays(today, EXPIRY_DAYS);
  const row = q => ({reference: q.reference, title: q.title, customer: q.customer, kind: q.kind, value: pounds(pence(q.value)),
    issuedOn: q.issuedOn, validUntil: q.validUntil, ageDays: daysBetween(q.issuedOn, today)});
  return {
    count: open.length, value: pounds(total), firmValue: pounds(firm), budgetValue: pounds(total - firm),
    byMonth: [...byMonth.values()].sort((a, b) => a.key.localeCompare(b.key)).map(r => ({...r, value: pounds(r.value)})),
    byCustomer: sorted(byCustomer), byLeadSource: sorted(bySource), byJobType: sorted(byType),
    expiringSoon: open.filter(q => q.validUntil && q.validUntil <= soon).sort((a, b) => a.validUntil.localeCompare(b.validUntil)).map(row),
    quotes: open.sort((a, b) => pence(b.value) - pence(a.value)).map(row),
  };
}

/**
 * Each stage's amount of the won value. The last stage takes the rounding penny, as in Quoting, so the
 * amounts add up to the value.
 */
function stageAmounts(q) {
  const total = wonValue(q);
  let left = total;
  return q.stages.map((s, i) => {
    const amount = i === q.stages.length - 1 ? left : Math.round(total * Number(s.percent) / 100);
    left -= amount;
    return {description: s.description, percent: Number(s.percent), expectedOn: s.expectedOn, amount};
  });
}

function orderBook(quotes, today, months = 12) {
  const live = quotes.filter(isLive);
  const span = monthsFrom(today, months);
  const cash = new Map(span.map(m => [m, 0]));
  let total = 0, overdue = 0, later = 0, unscheduledCash = 0;
  const jobs = live.map(q => {
    const value = wonValue(q);
    total += value;
    const stages = stageAmounts(q);
    if (!stages.length) unscheduledCash += value;
    let pastDue = 0;
    for (const s of stages) {
      if (s.expectedOn < today) { pastDue += s.amount; overdue += s.amount; continue; }
      const m = month(s.expectedOn);
      if (cash.has(m)) cash.set(m, cash.get(m) + s.amount); else later += s.amount;
    }
    return {reference: q.reference, title: q.title, customer: q.customer, status: q.status, value: pounds(value),
      wonOn: q.respondedOn, starts: q.programmeStarts, ends: q.programmeEnds, scheduleState: q.scheduleState,
      stageCount: stages.length, pastDue: pounds(pastDue),
      stages: stages.map(s => ({...s, amount: pounds(s.amount), passed: s.expectedOn < today}))};
  }).sort((a, b) => b.value - a.value);
  return {
    count: live.length, value: pounds(total),
    cashIn: span.map(m => ({month: m, value: pounds(cash.get(m))})),
    // Stages whose date has passed: they may have been paid. Only Xero can say.
    pastDue: pounds(overdue), later: pounds(later), noStages: pounds(unscheduledCash),
    jobs,
  };
}

/**
 * Planned hours from Scheduling against hours booked in Timesheets, per job number. Quoted hours come
 * from the handover Quoting sent the scheduler. Approved means signed off by a supervisor or payroll.
 */
function hours(jobs, booked, today) {
  const used = new Map(booked.map(b => [jobKey(b.jobNumber), b]));
  const rows = jobs.filter(j => j.status !== 'cancelled').map(j => {
    const b = used.get(jobKey(j.jobNumber));
    const approved = b ? Number(b.approved) : 0, pending = b ? Number(b.pending) : 0;
    const planned = j.plannedHours === null || j.plannedHours === undefined ? null : Number(j.plannedHours);
    const share = planned ? (approved + pending) / planned : null;
    let flag = null;
    if (share !== null && share > 1) flag = 'over';
    else if (share !== null && share >= WARN_SHARE && j.status !== 'complete') flag = 'near';
    return {jobNumber: j.jobNumber, name: j.name, status: j.status, starts: j.startsOn, ends: j.endsOn,
      quotedHours: j.quotedHours === null || j.quotedHours === undefined ? null : round1(Number(j.quotedHours)),
      plannedHours: planned === null ? null : round1(planned), approvedHours: round1(approved), pendingHours: round1(pending),
      usedShare: share === null ? null : Math.round(share * 100), flag,
      lastBooked: b ? b.lastDate : null};
  });
  const order = {over: 0, near: 1};
  rows.sort((a, b) => (order[a.flag] ?? 2) - (order[b.flag] ?? 2) || (b.usedShare ?? -1) - (a.usedShare ?? -1) || a.jobNumber.localeCompare(b.jobNumber));
  const live = rows.filter(r => r.status !== 'complete');
  return {
    today,
    over: rows.filter(r => r.flag === 'over').length, near: rows.filter(r => r.flag === 'near').length,
    plannedHours: round1(live.reduce((s, r) => s + (r.plannedHours || 0), 0)),
    usedHours: round1(live.reduce((s, r) => s + r.approvedHours + r.pendingHours, 0)),
    warnAt: Math.round(WARN_SHARE * 100),
    jobs: rows,
  };
}

/** Each problem says what is wrong, where to fix it and which job it is. */
function fixes(quotes, jobs, booked, have = {quoting: true, scheduling: true, timesheets: true}) {
  const out = [];
  const add = (app, problem, reference, detail, fix) => out.push({app, problem, reference, detail, fix});
  const quoteRefs = new Set(quotes.map(q => jobKey(q.reference)));
  const scheduled = new Map(jobs.map(j => [jobKey(j.jobNumber), j]));
  for (const q of quotes.filter(isLive)) {
    if (!q.stages.length) add('Quoting', 'Won job with no payment stages', q.reference, q.title,
      'Open the quote in Quoting and add its payment schedule, so the expected cash in includes it.');
    if (have.scheduling && !scheduled.has(jobKey(q.reference))) add('Scheduling', 'Won job not in Scheduling', q.reference, q.title,
      q.status === 'accepted' ? 'Authorise it in Quoting to send it to Scheduling, or add it there by hand.' : 'Confirm it in Jobs to schedule, or add it in Scheduling.');
  }
  for (const j of jobs.filter(j => !['cancelled', 'complete'].includes(j.status))) {
    if (j.plannedHours === null || j.plannedHours === undefined) add('Scheduling', 'Job with no planned hours', j.jobNumber, j.name,
      'Set the planned hours on the job in Scheduling, so hours used can be compared with them.');
  }
  for (const b of have.quoting ? booked.filter(b => b.kind === 'customer') : []) {
    const k = jobKey(b.jobNumber);
    if (!quoteRefs.has(k)) add('Timesheets', 'Hours on a job number Quoting does not know', b.jobNumber, `${b.jobName}: ${round1(Number(b.approved) + Number(b.pending))} hours`,
      'Check the job number in Timesheets matches the quote reference (for example Q00012).');
  }
  const order = {Quoting: 0, Scheduling: 1, Timesheets: 2};
  return out.sort((a, b) => order[a.app] - order[b.app] || a.problem.localeCompare(b.problem) || String(a.reference).localeCompare(String(b.reference)));
}

/** All four reports for one firm. Missing sources give empty lists, and `sources` says which were read. */
function allReports({quotes = [], jobs = [], booked = [], have}, today) {
  return {
    today,
    pipeline: pipeline(quotes, today),
    orderBook: orderBook(quotes, today),
    hours: hours(jobs, booked, today),
    fixes: fixes(quotes, jobs, booked, have),
    have,
  };
}

module.exports = {pipeline, orderBook, hours, fixes, allReports, jobKey, monthsFrom};
