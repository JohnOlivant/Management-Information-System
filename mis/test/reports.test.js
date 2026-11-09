'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {pipeline, orderBook, hours, fixes, monthsFrom} = require('../src/reports');
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

test('the demo data builds every report', () => {
  const d = demoData(TODAY);
  assert.equal(pipeline(d.quotes, TODAY).count, 4);
  assert.equal(orderBook(d.quotes, TODAY).count, 3);
  assert.equal(hours(d.jobs, d.booked, TODAY).over, 1);
  assert.equal(fixes(d.quotes, d.jobs, d.booked).length, 4);
});
