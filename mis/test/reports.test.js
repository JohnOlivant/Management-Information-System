'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {pipeline, orderBook, hours, fixes, winRate, capacity, hoursWent, bookingDays, monthsFrom, monthsBack} = require('../src/reports');
const {demoData} = require('../src/demo');

const TODAY = '2026-11-09';
const quote = (o = {}) => ({reference: 'Q1', title: 'T', customer: 'C', leadSource: null, jobType: null, kind: 'firm', status: 'issued',
  value: '100.00', issuedOn: '2026-11-01', validUntil: '2026-12-01', acceptedValue: null, respondedOn: null, cancelled: false,
  completedOn: null, programmeStarts: null, programmeEnds: null, scheduleState: null, stages: [], ...o});

test('months run on from this month across the year end', () => {
  assert.deepEqual(monthsFrom('2026-11-09', 3), ['2026-11', '2026-12', '2027-01']);
});

test('pipeline counts only issued quotes still in date, and lists those running out', () => {
  const p = pipeline([
    quote({reference: 'A', value: '1000.10'}),
    quote({reference: 'B', value: '500', kind: 'budget', validUntil: '2026-11-15'}),
    quote({reference: 'C', validUntil: '2026-11-08'}),         // past its date
    quote({reference: 'D', status: 'accepted'}),
    quote({reference: 'E', status: 'draft'}),
  ], TODAY);
  assert.equal(p.count, 2);
  assert.equal(p.value, 1500.1);
  assert.equal(p.firmValue, 1000.1);
  assert.equal(p.budgetValue, 500);
  assert.deepEqual(p.expiringSoon.map(q => q.reference), ['B']);
  assert.deepEqual(p.byLeadSource, [{key: 'Not recorded', count: 2, value: 1500.1}]);
  assert.equal(p.quotes[0].ageDays, 8);
});

test('order book uses the accepted value and spreads stages by month; the last stage takes the penny', () => {
  const o = orderBook([
    quote({reference: 'W', status: 'authorised', value: '900', acceptedValue: '1000.00', stages: [
      {description: 'a', percent: '33.3333', expectedOn: '2026-10-01'},
      {description: 'b', percent: '33.3333', expectedOn: '2026-11-20'},
      {description: 'c', percent: '33.3334', expectedOn: '2028-01-01'}]}),
    quote({reference: 'X', status: 'accepted', value: '200'}),
    quote({reference: 'Done', status: 'authorised', completedOn: '2026-11-01', stages: [{description: 'x', percent: '100', expectedOn: '2026-12-01'}]}),
    quote({reference: 'Off', status: 'authorised', cancelled: true}),
  ], TODAY);
  assert.equal(o.count, 2);
  assert.equal(o.value, 1200);
  assert.equal(o.pastDue, 333.33);
  assert.equal(o.cashIn[0].value, 333.33);
  assert.equal(o.later, 333.34);
  assert.equal(o.noStages, 200);
  assert.equal(o.cashIn.length, 12);
  const w = o.jobs.find(j => j.reference === 'W');
  assert.equal(w.stages.reduce((s, x) => s + x.amount, 0), 1000);
  assert.equal(w.stages[0].passed, true);
});

test('hours flags over-plan and past-80% jobs, matching job numbers loosely', () => {
  const h = hours([
    {jobNumber: 'Q00001', name: 'a', status: 'scheduled', plannedHours: 100, quotedHours: 90},
    {jobNumber: 'Q00002', name: 'b', status: 'scheduled', plannedHours: 10},
    {jobNumber: 'Q00003', name: 'c', status: 'complete', plannedHours: 10},
    {jobNumber: 'Q00004', name: 'd', status: 'scheduled', plannedHours: null},
    {jobNumber: 'Q00005', name: 'e', status: 'cancelled', plannedHours: 10},
  ], [
    {jobNumber: 'q00001 ', approved: 70, pending: 15},
    {jobNumber: 'Q00002', approved: 12, pending: 0},
    {jobNumber: 'Q00003', approved: 9, pending: 0},
  ], TODAY);
  const by = Object.fromEntries(h.jobs.map(j => [j.jobNumber, j]));
  assert.equal(by.Q00001.flag, 'near'); assert.equal(by.Q00001.usedShare, 85);
  assert.equal(by.Q00002.flag, 'over');
  assert.equal(by.Q00003.flag, null, 'a finished job near its plan is fine');
  assert.equal(by.Q00004.usedShare, null);
  assert.equal(by.Q00005, undefined);
  assert.equal(h.jobs[0].jobNumber, 'Q00002', 'over-plan jobs come first');
  assert.equal(h.over, 1); assert.equal(h.near, 1);
});

test('fixes lists missing stages, unscheduled jobs, unplanned jobs and unknown job numbers', () => {
  const list = fixes(
    [quote({reference: 'Q1', status: 'authorised'}), quote({reference: 'Q2', status: 'accepted', stages: [{description: 'x', percent: '100', expectedOn: '2026-12-01'}]})],
    [{jobNumber: 'Q1', name: 'one', status: 'scheduled', plannedHours: null}],
    [{jobNumber: 'Q1', jobName: 'one', kind: 'customer', approved: 1, pending: 0}, {jobNumber: 'ZZ9', jobName: 'odd', kind: 'customer', approved: 2, pending: 1},
      {jobNumber: 'YARD', jobName: 'yard', kind: 'internal', approved: 5, pending: 0}]);
  assert.deepEqual(list.map(f => `${f.app}:${f.reference}:${f.problem}`), [
    'Quoting:Q1:Won job with no payment stages',
    'Scheduling:Q1:Job with no planned hours',
    'Scheduling:Q2:Won job not in Scheduling',
    'Timesheets:ZZ9:Hours on a job number Quoting does not know',
  ]);
});

test('fixes does not blame an app the firm is not linked to', () => {
  const list = fixes([quote({reference: 'Q1', status: 'authorised', stages: [{description: 'x', percent: '100', expectedOn: '2026-12-01'}]})], [],
    [{jobNumber: 'ZZ9', jobName: 'odd', kind: 'customer', approved: 2, pending: 0}], {quoting: false, scheduling: false, timesheets: true});
  assert.deepEqual(list, []);
});

test('win rate counts won, declined and run-out quotes, leaving open ones out of the rate', () => {
  const w = winRate([
    quote({reference: 'A', status: 'authorised', value: '900', acceptedValue: '1000', firstIssuedOn: '2026-03-01', issuedOn: '2026-03-10', respondedOn: '2026-03-21', leadSource: 'Web'}),
    quote({reference: 'B', status: 'accepted', value: '500', cancelled: true, firstIssuedOn: '2026-03-05', respondedOn: '2026-03-15'}),
    quote({reference: 'C', status: 'declined', value: '2000', firstIssuedOn: '2026-04-01', respondedOn: '2026-04-11', leadSource: 'Web'}),
    quote({reference: 'D', status: 'expired', value: '300', firstIssuedOn: '2026-05-01', expiredOn: '2026-06-01'}),
    quote({reference: 'E', status: 'issued', value: '400', firstIssuedOn: '2026-10-01', validUntil: '2026-11-01'}),   // ran out, not yet marked
    quote({reference: 'F', status: 'issued', value: '700', firstIssuedOn: '2026-11-02', validUntil: '2026-12-01'}),   // still open
    quote({reference: 'Old', status: 'declined', firstIssuedOn: '2025-10-31'}),                                       // before the 12 months
    quote({reference: 'G', status: 'withdrawn', firstIssuedOn: '2026-06-01'}),
  ], TODAY);
  assert.equal(w.since, '2025-12-01');
  assert.deepEqual([w.won, w.lost, w.expired, w.open, w.decided], [2, 1, 2, 1, 5]);
  assert.equal(w.rate, 40);
  assert.equal(w.wonValue, 1500);
  assert.equal(w.valueRate, Math.round(100 * 1500 / 4200));
  assert.equal(w.daysToWin, 15);        // 20 and 10 days
  assert.equal(w.daysToLose, 10);
  assert.equal(w.byMonth.length, 12);
  assert.equal(w.byMonth.find(m => m.key === '2026-03').rate, 100);
  assert.deepEqual(w.byLeadSource.find(g => g.key === 'Web'), {...w.byLeadSource.find(g => g.key === 'Web'), won: 1, lost: 1, rate: 50});
  assert.deepEqual(w.lostQuotes.map(q => q.reference), ['C', 'E', 'D']);
  assert.equal(w.lostQuotes[1].outcome, 'expired');
});

test('months back run up to this month', () => {
  assert.deepEqual(monthsBack('2026-02-10', 3), ['2025-12', '2026-01', '2026-02']);
});

test('a booking counts weekdays at its daily times, as Scheduling does', () => {
  assert.deepEqual(bookingDays({start: '2026-11-13T08:00', end: '2026-11-17T16:00', weekend: false}), {days: ['2026-11-13', '2026-11-16', '2026-11-17'], daily: 8});
  assert.equal(bookingDays({start: '2026-11-14T08:00', end: '2026-11-15T16:30', weekend: true}).days.length, 2);
  assert.deepEqual(bookingDays({start: '2026-11-10T09:00', end: '2026-11-10T13:30', weekend: false}), {days: ['2026-11-10'], daily: 4.5});
  assert.deepEqual(bookingDays({start: '2026-11-10T08:00', end: '2026-11-12T00:00', weekend: false}), {days: ['2026-11-10', '2026-11-11'], daily: 8});
});

test('capacity takes time away off each worker and counts crews still to find', () => {
  const c = capacity({
    workers: [{id: 'a', name: 'Al', jobTitle: 'Joiner'}, {id: 'b', name: 'Bea', jobTitle: ''}],
    assignments: [{workerId: 'a', start: '2026-11-02T08:00', end: '2026-11-13T16:00', weekend: false},
      {workerId: 'gone', start: '2026-11-09T08:00', end: '2026-11-13T16:00', weekend: false}],
    away: [{workerId: 'b', kind: 'holiday', from: '2026-11-16', to: '2026-11-17', hours: null},
      {workerId: 'b', kind: 'sickness', from: '2026-11-18', to: '2026-11-18', hours: 4},
      {workerId: 'a', kind: 'training', from: '2026-11-12', to: '2026-11-12', hours: null}],
    plans: [{jobNumber: 'Q9', name: 'Nine', start: '2026-11-16T08:00', end: '2026-11-17T16:00', weekend: false, minCrew: 1, loneWorking: false, crew: 0},
      {jobNumber: 'Q8', name: 'Eight', start: '2026-11-16T08:00', end: '2026-11-17T16:00', weekend: false, minCrew: 1, loneWorking: true, crew: 1}],
  }, '2026-11-10');
  assert.equal(c.weeks.length, 8);
  const [w1, w2] = c.weeks;
  assert.equal(w1.week, '2026-11-09');
  assert.equal(w1.available, 2 * 4 * 8 - 8, 'from today, Tuesday: four days each, less Al\'s training day');
  assert.equal(w1.booked, 32, 'Al is booked Tuesday to Friday; someone not on the crew list is ignored');
  assert.equal(w2.available, 80 - 16 - 4);
  assert.equal(w2.unfilled, 2 * 2 * 8, 'Q9 needs two (no lone working) for two days; Q8 is fine');
  assert.deepEqual(c.short.map(j => [j.jobNumber, j.missing, j.hours]), [['Q9', 2, 32]]);
  const al = c.workers.find(p => p.name === 'Al');
  assert.equal(al.clashes, 1, 'booked on his training day');
  assert.equal(al.weeks[0].booked, 32);
});

test('where the hours went splits customer, internal and leave by week, job and worker', () => {
  const r = hoursWent([
    {week: '2026-11-09', jobNumber: 'Q1', jobName: 'One', kind: 'customer', workerId: 'a', worker: 'Al', hours: 30},
    {week: '2026-11-02', jobNumber: 'q1', jobName: 'One', kind: 'customer', workerId: 'b', worker: 'Bea', hours: 7.25},
    {week: '2026-11-09', jobNumber: 'YARD', jobName: 'Yard', kind: 'internal', workerId: 'a', worker: 'Al', hours: 10},
    {week: '2026-11-09', jobNumber: 'HOL', jobName: 'Leave', kind: 'holiday', workerId: 'b', worker: 'Bea', hours: 8},
    {week: '2026-08-10', jobNumber: 'Q1', jobName: 'One', kind: 'customer', workerId: 'a', worker: 'Al', hours: 99},   // too long ago
  ], TODAY);
  assert.equal(r.weeks.length, 12);
  assert.equal(r.from, '2026-08-24');
  assert.deepEqual([r.customer, r.internal, r.holiday, r.worked, r.customerShare], [37.25, 10, 8, 47.25, 79]);
  assert.deepEqual(r.customerJobs, [{jobNumber: 'Q1', name: 'One', hours: 37.25, weeks: 2}]);
  assert.equal(r.weeks[11].customerShare, 75);
  assert.deepEqual(r.workers.map(p => [p.name, p.customerShare]), [['Al', 75], ['Bea', 100]]);
});

test('the demo data builds every report', () => {
  const d = demoData(TODAY);
  assert.ok(winRate(d.quotes, TODAY).decided > 10);
  assert.equal(capacity(d.crew, TODAY).crew, 6);
  assert.equal(hoursWent(d.worked, TODAY).weeks.length, 12);
  assert.equal(pipeline(d.quotes, TODAY).count, 4);
  assert.equal(orderBook(d.quotes, TODAY).count, 3);
  assert.equal(hours(d.jobs, d.booked, TODAY).over, 1);
  assert.equal(fixes(d.quotes, d.jobs, d.booked).length, 4);
});
