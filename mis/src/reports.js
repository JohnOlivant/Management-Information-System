'use strict';
// The first MIS reports, built from what Quoting, Scheduling and Timesheets already hold. Pure: each
// takes the firm's data as read by sources.js (or the demo data) and today's date, so it is tested
// without a database. Money is ex VAT and kept in pence while adding up.
//
//   pipeline  open quotes waiting for the customer (product description V1)
//   orderBook won jobs not yet complete and the money expected from their payment stages (V3, V5 without Xero)
//   hours     planned against used hours per job, with jobs running over flagged (V7 inputs, alert A2)
//   fixes     data that stops the numbers being trusted (alert A3)
//   winRate   share of quotes won, by month sent, lead source, job type and customer, and how long answers take (V2)
//   capacity  crew hours free against hours booked, week by week for the next 8 weeks (V6)
//   hoursWent where the hours went: customer jobs, internal work and leave, week by week (V7 inputs)

const WON = ['accepted', 'authorised'];
const WARN_SHARE = 0.8;   // A2: flag a job once its hours pass 80% of plan
const EXPIRY_DAYS = 14;   // quotes running out within this many days are listed
const DAY_HOURS = 8;      // a normal working day, Monday to Friday, for crew capacity
const CAPACITY_WEEKS = 8, HISTORY_WEEKS = 12, WIN_MONTHS = 12;

const pence = v => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v))) ? 0 : Math.round(Number(v) * 100);
const pounds = p => p / 100;
const month = d => d.slice(0, 7);
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
// Hours to 2 decimal places, as Timesheets keeps them (a quarter hour is 0.25).
const round2 = n => Math.round(n * 100) / 100;
/** Job numbers are matched without regard to case or spaces, as people type them differently. */
const jobKey = n => String(n || '').replace(/\s+/g, '').toUpperCase();

const weekday = d => (new Date(d + 'T00:00:00Z').getUTCDay() + 6) % 7;   // Monday = 0
const weekStart = d => addDays(d, -weekday(d));
const isWeekend = d => weekday(d) >= 5;
const median = list => { if (!list.length) return null; const s = [...list].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

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
      quotedHours: j.quotedHours === null || j.quotedHours === undefined ? null : round2(Number(j.quotedHours)),
      plannedHours: planned === null ? null : round2(planned), approvedHours: round2(approved), pendingHours: round2(pending),
      usedShare: share === null ? null : Math.round(share * 100), flag,
      lastBooked: b ? b.lastDate : null};
  });
  const order = {over: 0, near: 1};
  rows.sort((a, b) => (order[a.flag] ?? 2) - (order[b.flag] ?? 2) || (b.usedShare ?? -1) - (a.usedShare ?? -1) || a.jobNumber.localeCompare(b.jobNumber));
  const live = rows.filter(r => r.status !== 'complete');
  return {
    today,
    over: rows.filter(r => r.flag === 'over').length, near: rows.filter(r => r.flag === 'near').length,
    plannedHours: round2(live.reduce((s, r) => s + (r.plannedHours || 0), 0)),
    usedHours: round2(live.reduce((s, r) => s + r.approvedHours + r.pendingHours, 0)),
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
    if (!quoteRefs.has(k)) add('Timesheets', 'Hours on a job number Quoting does not know', b.jobNumber, `${b.jobName}: ${round2(Number(b.approved) + Number(b.pending))} hours`,
      'Check the job number in Timesheets matches the quote reference (for example Q00012).');
  }
  const order = {Quoting: 0, Scheduling: 1, Timesheets: 2};
  return out.sort((a, b) => order[a.app] - order[b.app] || a.problem.localeCompare(b.problem) || String(a.reference).localeCompare(String(b.reference)));
}

/**
 * What became of each quote: won (accepted or authorised, even if the job was later cancelled), lost (the
 * customer declined), expired (ran out with no answer) or still open.
 */
function outcome(q, today) {
  if (WON.includes(q.status)) return 'won';
  if (q.status === 'declined') return 'lost';
  if (q.status === 'expired' || (q.status === 'issued' && q.validUntil && q.validUntil < today)) return 'expired';
  return q.status === 'issued' ? 'open' : null;
}

/**
 * Win rate over quotes first sent in the last 12 months. The rate is won out of those with an outcome
 * (won, lost or expired); open quotes are counted but left out of the rate. Value uses the accepted
 * price for won quotes and the latest proposal's price for the rest.
 */
function winRate(quotes, today, months = WIN_MONTHS) {
  const span = monthsBack(today, months);
  const since = span[0] + '-01';
  const sentOn = q => q.firstIssuedOn || q.issuedOn;
  const rows = quotes.map(q => ({q, outcome: outcome(q, today)})).filter(r => r.outcome && sentOn(r.q) && sentOn(r.q) >= since);
  const blank = key => ({key, won: 0, lost: 0, expired: 0, open: 0, wonValue: 0, lostValue: 0, expiredValue: 0, openValue: 0});
  const add = (g, r) => { const v = r.outcome === 'won' ? wonValue(r.q) : pence(r.q.value); g[r.outcome] += 1; g[r.outcome + 'Value'] += v; };
  const finish = g => {
    const decided = g.won + g.lost + g.expired, decidedValue = g.wonValue + g.lostValue + g.expiredValue;
    return {...g, decided, rate: decided ? Math.round(100 * g.won / decided) : null,
      valueRate: decidedValue ? Math.round(100 * g.wonValue / decidedValue) : null,
      wonValue: pounds(g.wonValue), lostValue: pounds(g.lostValue), expiredValue: pounds(g.expiredValue), openValue: pounds(g.openValue)};
  };
  const group = keyOf => {
    const map = new Map();
    for (const r of rows) { const k = keyOf(r.q); if (!map.has(k)) map.set(k, blank(k)); add(map.get(k), r); }
    return [...map.values()].map(finish).sort((a, b) => b.decided - a.decided || b.wonValue - a.wonValue || a.key.localeCompare(b.key));
  };
  const total = blank('All'); for (const r of rows) add(total, r);
  const byMonthMap = new Map(span.map(m => [m, blank(m)]));
  for (const r of rows) { const m = month(sentOn(r.q)); if (byMonthMap.has(m)) add(byMonthMap.get(m), r); }
  const days = o => rows.filter(r => r.outcome === o && r.q.respondedOn).map(r => daysBetween(sentOn(r.q), r.q.respondedOn)).filter(n => n >= 0);
  const row = r => ({reference: r.q.reference, title: r.q.title, customer: r.q.customer, outcome: r.outcome, sentOn: sentOn(r.q),
    endedOn: r.outcome === 'expired' ? (r.q.expiredOn || r.q.validUntil) : r.q.respondedOn, value: pounds(pence(r.q.value)),
    leadSource: r.q.leadSource || 'Not recorded', jobType: r.q.jobType || 'Not recorded'});
  return {
    since, months,
    ...finish(total),
    daysToWin: median(days('won')), daysToLose: median(days('lost')),
    byMonth: [...byMonthMap.values()].map(finish),
    byLeadSource: group(q => q.leadSource || 'Not recorded'),
    byJobType: group(q => q.jobType || 'Not recorded'),
    byCustomer: group(q => q.customer || 'No customer'),
    byKind: group(q => q.kind === 'budget' ? 'Budget' : 'Firm'),
    lostQuotes: rows.filter(r => r.outcome === 'lost' || r.outcome === 'expired')
      .sort((a, b) => pence(b.q.value) - pence(a.q.value) || a.q.reference.localeCompare(b.q.reference)).map(row),
  };
}

/** The last `count` months up to and including today's month, as YYYY-MM. */
function monthsBack(today, count) {
  const [y, m] = today.split('-').map(Number);
  return Array.from({length: count}, (_, i) => new Date(Date.UTC(y, m - count + i, 1)).toISOString().slice(0, 7));
}

const minutesOf = t => Number(t.slice(11, 13)) * 60 + Number(t.slice(14, 16));
/**
 * The days a booking in Scheduling covers and its hours on each, worked out as Scheduling's own usage
 * report does: Monday to Friday unless the job has weekend working; one-day bookings count their whole
 * span, longer ones the end time of day less the start time of day (8 hours if that is unclear).
 * start and end are local times, YYYY-MM-DDTHH:MM.
 */
function bookingDays({start, end, weekend}) {
  const first = start.slice(0, 10);
  let last = end.slice(0, 10);
  if (minutesOf(end) === 0 && last > first) last = addDays(last, -1);
  const days = [];
  for (let d = first; d <= last; d = addDays(d, 1)) if (weekend || !isWeekend(d)) days.push(d);
  let daily;
  if (first === last) daily = (Date.parse(end + 'Z') - Date.parse(start + 'Z')) / 3600000;
  else { const m = minutesOf(end) - minutesOf(start); daily = m > 0 ? m / 60 : DAY_HOURS; }
  return {days, daily};
}
/** Scheduling's minimum crew: at least the job's minimum, and two where lone working isn't allowed. */
const minCrew = p => Math.max(1, Number(p.minCrew) || 1, p.loneWorking ? 1 : 2);

/**
 * Crew capacity for this week and the next seven, from today. Available: each active worker's working
 * days (Monday to Friday, 8 hours) less holiday, sickness, training and other time away. Booked: their
 * assignments on jobs in Scheduling. Still to crew: jobs short of their minimum crew, at the job's hours.
 */
function capacity({workers = [], assignments = [], away = [], plans = []} = {}, today, weeks = CAPACITY_WEEKS) {
  const first = weekStart(today), end = addDays(first, 7 * weeks);
  const span = Array.from({length: weeks}, (_, i) => addDays(first, 7 * i));
  const inWindow = d => d >= today && d < end;
  const zero = () => ({available: 0, booked: 0, away: 0, unfilled: 0});
  const totals = new Map(span.map(w => [w, zero()]));
  const people = new Map(workers.map(w => [w.id, {id: w.id, name: w.name, jobTitle: w.jobTitle || '', weeks: new Map(span.map(x => [x, zero()])), clashes: 0}]));
  // Time away per worker per day, in hours.
  const off = new Map();
  for (const a of away) {
    if (!people.has(a.workerId)) continue;
    for (let d = a.from > today ? a.from : today; d <= a.to && d < end; d = addDays(d, 1)) {
      if (isWeekend(d)) continue;
      const k = a.workerId + d;
      off.set(k, Math.min(DAY_HOURS, (off.get(k) || 0) + (a.hours ? Number(a.hours) : DAY_HOURS)));
    }
  }
  const bookedOn = new Map();
  for (const b of assignments) {
    if (!people.has(b.workerId)) continue;
    const {days, daily} = bookingDays(b);
    for (const d of days.filter(inWindow)) bookedOn.set(b.workerId + d, (bookedOn.get(b.workerId + d) || 0) + daily);
  }
  for (const p of people.values()) {
    for (let d = today; d < end; d = addDays(d, 1)) {
      const w = weekStart(d), mine = p.weeks.get(w), all = totals.get(w);
      const gone = off.get(p.id + d) || 0, booked = bookedOn.get(p.id + d) || 0;
      const avail = isWeekend(d) ? 0 : DAY_HOURS - gone;
      if (booked && gone >= DAY_HOURS) p.clashes += 1;
      for (const t of [mine, all]) { t.available += avail; t.booked += booked; t.away += isWeekend(d) ? 0 : gone; }
    }
  }
  const short = [];
  for (const p of plans) {
    const missing = Math.max(0, minCrew(p) - Number(p.crew || 0));
    if (!missing) continue;
    const {days, daily} = bookingDays(p);
    const mine = days.filter(inWindow);
    if (!mine.length) continue;
    for (const d of mine) totals.get(weekStart(d)).unfilled += missing * daily;
    short.push({jobNumber: p.jobNumber, name: p.name, starts: p.start.slice(0, 10), ends: days[days.length - 1] || p.end.slice(0, 10),
      crew: Number(p.crew || 0), needed: minCrew(p), missing, hours: round2(missing * daily * mine.length)});
  }
  const shape = t => ({available: round2(t.available), booked: round2(t.booked), away: round2(t.away), unfilled: round2(t.unfilled),
    free: round2(t.available - t.booked), share: t.available ? Math.round(100 * t.booked / t.available) : null});
  const rows = span.map(w => ({week: w, ...shape(totals.get(w))}));
  const sum = k => round2(rows.reduce((s, r) => s + r[k], 0));
  return {
    from: today, dayHours: DAY_HOURS, crew: people.size,
    available: sum('available'), booked: sum('booked'), unfilled: sum('unfilled'), free: round2(sum('available') - sum('booked')),
    share: sum('available') ? Math.round(100 * sum('booked') / sum('available')) : null,
    weeks: rows,
    workers: [...people.values()].map(p => {
      const ws = span.map(w => shape(p.weeks.get(w)));
      const a = ws.reduce((s, x) => s + x.available, 0), b = ws.reduce((s, x) => s + x.booked, 0);
      return {name: p.name, jobTitle: p.jobTitle, weeks: ws, available: round2(a), booked: round2(b), share: a ? Math.round(100 * b / a) : null, clashes: p.clashes};
    }).sort((x, y) => (x.share ?? -1) - (y.share ?? -1) || x.name.localeCompare(y.name)),
    short: short.sort((a, b) => a.starts.localeCompare(b.starts) || a.jobNumber.localeCompare(b.jobNumber)),
  };
}

/**
 * Where the hours went over the last 12 weeks (this week included): hours in Timesheets on customer jobs,
 * on internal work, and leave (holiday and sickness), by week, job and worker. Drafts are left out.
 * rows: [{week, jobNumber, jobName, kind: customer|internal|holiday|sickness, workerId, worker, hours}]
 */
function hoursWent(rows, today, weeks = HISTORY_WEEKS) {
  const first = addDays(weekStart(today), -7 * (weeks - 1));
  const span = Array.from({length: weeks}, (_, i) => addDays(first, 7 * i));
  const KINDS = ['customer', 'internal', 'holiday', 'sickness'];
  const blank = () => Object.fromEntries(KINDS.map(k => [k, 0]));
  const byWeek = new Map(span.map(w => [w, blank()])), total = blank();
  const jobs = new Map(), people = new Map();
  for (const r of rows) {
    if (!byWeek.has(r.week) || !KINDS.includes(r.kind)) continue;
    const h = Math.round(Number(r.hours) * 100);
    byWeek.get(r.week)[r.kind] += h; total[r.kind] += h;
    if (r.kind === 'customer' || r.kind === 'internal') {
      const k = jobKey(r.jobNumber) || r.jobName;
      if (!jobs.has(k)) jobs.set(k, {jobNumber: r.jobNumber, name: r.jobName, kind: r.kind, hours: 0, weeks: 0, seen: new Set()});
      const j = jobs.get(k); j.hours += h; j.seen.add(r.week);
    }
    if (!people.has(r.workerId)) people.set(r.workerId, {name: r.worker, ...blank()});
    people.get(r.workerId)[r.kind] += h;
  }
  const hrs = p => round2(p / 100);
  const shape = t => {
    const worked = t.customer + t.internal;
    return {...Object.fromEntries(KINDS.map(k => [k, hrs(t[k])])), worked: hrs(worked), all: hrs(worked + t.holiday + t.sickness),
      customerShare: worked ? Math.round(100 * t.customer / worked) : null};
  };
  const jobList = kind => [...jobs.values()].filter(j => j.kind === kind).map(j => ({jobNumber: j.jobNumber, name: j.name, hours: hrs(j.hours), weeks: j.seen.size}))
    .sort((a, b) => b.hours - a.hours || String(a.jobNumber).localeCompare(String(b.jobNumber)));
  return {
    from: first, to: today, weeks: span.map(w => ({week: w, ...shape(byWeek.get(w))})),
    ...shape(total),
    customerJobs: jobList('customer'), internalJobs: jobList('internal'),
    workers: [...people.values()].map(p => ({name: p.name, ...shape(p)})).sort((a, b) => (a.customerShare ?? 101) - (b.customerShare ?? 101) || a.name.localeCompare(b.name)),
  };
}

/** Every report for one firm. Missing sources give empty lists, and `have` says which were read. */
function allReports({quotes = [], jobs = [], booked = [], crew = {}, worked = [], have}, today) {
  return {
    today,
    pipeline: pipeline(quotes, today),
    orderBook: orderBook(quotes, today),
    hours: hours(jobs, booked, today),
    winRate: winRate(quotes, today),
    capacity: capacity(crew, today),
    hoursWent: hoursWent(worked, today),
    fixes: fixes(quotes, jobs, booked, have),
    have,
  };
}

module.exports = {pipeline, orderBook, hours, fixes, winRate, capacity, hoursWent, bookingDays, allReports, jobKey, monthsFrom, monthsBack, weekStart};
