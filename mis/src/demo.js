'use strict';
// Made-up data for the demo (npm run demo) and the tests: one small building firm, dated around `today`.
const {monthsFrom} = require('./reports');

function demoData(today) {
  const d = n => { const x = new Date(today + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const [m0, m1, m2, m3] = monthsFrom(today, 4);
  const q = (reference, title, customer, status, value, issued, extra = {}) => ({
    reference, title, customer, leadSource: extra.leadSource || 'Repeat customer', jobType: extra.jobType || 'Extension', kind: extra.kind || 'firm',
    status, value: String(value), issuedOn: d(issued), validUntil: d(issued + 30), acceptedValue: extra.acceptedValue ?? null,
    respondedOn: extra.respondedOn ?? null, cancelled: false, completedOn: extra.completedOn ?? null,
    programmeStarts: extra.starts ?? null, programmeEnds: extra.ends ?? null, scheduleState: extra.scheduleState ?? null, stages: extra.stages || [],
  });
  const quotes = [
    q('Q00031', 'Rear kitchen extension', 'Hall & Sons', 'issued', 48500, -25, {leadSource: 'Website'}),
    q('Q00032', 'Loft conversion', 'M. Patel', 'issued', 36200, -10, {jobType: 'Loft', leadSource: 'Referral'}),
    q('Q00033', 'Shop front refit', 'Beverley Bakery Ltd', 'issued', 12750, -3, {jobType: 'Commercial fit-out', kind: 'budget', leadSource: 'Website'}),
    q('Q00034', 'Garage to annexe', 'J. Turner', 'issued', 27400, -20, {leadSource: 'Referral'}),
    q('Q00028', 'Office partitioning', 'Humber Logistics', 'declined', 18900, -60, {jobType: 'Commercial fit-out', respondedOn: d(-40)}),
    q('Q00021', 'Two-storey side extension', 'R. & K. Wilson', 'authorised', 92000, -90, {
      respondedOn: d(-70), starts: d(-35), ends: d(40), scheduleState: 'scheduled',
      stages: [{description: 'Deposit', percent: '10', expectedOn: d(-60)}, {description: 'Roof on', percent: '40', expectedOn: `${m1}-15`},
        {description: 'Practical completion', percent: '45', expectedOn: `${m2}-20`}, {description: 'Retention', percent: '5', expectedOn: `${m3}-20`}]}),
    q('Q00024', 'Café refurbishment', 'Old Town Café', 'authorised', 41800, -75, {
      jobType: 'Commercial fit-out', respondedOn: d(-50), acceptedValue: '43250', starts: d(-14), ends: d(12), scheduleState: 'scheduled',
      stages: [{description: 'Start', percent: '30', expectedOn: d(-14)}, {description: 'Completion', percent: '70', expectedOn: `${m1}-05`}]}),
    q('Q00027', 'Garden room', 'S. Clarke', 'accepted', 22600, -30, {jobType: 'Outbuilding', respondedOn: d(-6)}),
    q('Q00019', 'Bathroom and en-suite', 'D. Hughes', 'authorised', 15400, -120, {jobType: 'Refurbishment', respondedOn: d(-100), completedOn: d(-20),
      stages: [{description: 'On completion', percent: '100', expectedOn: d(-18)}]}),
  ];
  const jobs = [
    {jobNumber: 'Q00021', name: 'Two-storey side extension', status: 'scheduled', startsOn: d(-35), endsOn: d(40), plannedHours: 640, quotedHours: 600},
    {jobNumber: 'Q00024', name: 'Café refurbishment', status: 'scheduled', startsOn: d(-14), endsOn: d(12), plannedHours: 220, quotedHours: 210},
    {jobNumber: 'Q00019', name: 'Bathroom and en-suite', status: 'complete', startsOn: d(-50), endsOn: d(-20), plannedHours: 120, quotedHours: 112},
    {jobNumber: 'Q00026', name: 'Porch and canopy', status: 'scheduled', startsOn: d(5), endsOn: d(12), plannedHours: null, quotedHours: null},
  ];
  const booked = [
    {jobNumber: 'Q00021', jobName: 'Two-storey side extension', kind: 'customer', approved: 296, pending: 38, firstDate: d(-35), lastDate: d(-1)},
    {jobNumber: 'Q00024', jobName: 'Café refurbishment', kind: 'customer', approved: 168, pending: 24, firstDate: d(-14), lastDate: d(-1)},
    {jobNumber: 'Q00019', jobName: 'Bathroom and en-suite', kind: 'customer', approved: 131.5, pending: 0, firstDate: d(-50), lastDate: d(-21)},
    {jobNumber: 'Q0021', jobName: 'Wilson extension (typo)', kind: 'customer', approved: 16, pending: 0, firstDate: d(-9), lastDate: d(-8)},
    {jobNumber: 'YARD', jobName: 'Yard and van', kind: 'internal', approved: 42, pending: 6, firstDate: d(-60), lastDate: d(-2)},
  ];
  return {quotes, jobs, booked, have: {quoting: true, scheduling: true, timesheets: true}, problems: []};
}

/** Made-up Timesheets lines for the demo's Timesheet report: four workers over the last eight weeks. */
function demoTimesheet(today) {
  const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const workers = [[11, 'W01', 'Sam Archer'], [12, 'W02', 'Priya Nair'], [13, 'W03', 'Tom Booth'], [14, 'W04', 'Leah Moss']];
  const jobs = [[21, 'Q00021', 'Two-storey side extension', 'Cottingham'], [22, 'Q00024', 'Café refurbishment', 'Beverley'], [23, 'YARD', 'Yard and van', '']];
  const codes = [[31, 'N', 'Normal time'], [32, 'OT', 'Overtime']];
  const statusFor = d => { const age = (Date.parse(today() + 'T00:00:00Z') - Date.parse(d + 'T00:00:00Z')) / 86400000;
    return age > 14 ? 'payroll_approved' : age > 7 ? 'supervisor_approved' : 'submitted'; };
  function all() {
    const out = []; let line = 100;
    for (let back = 56; back >= 1; back--) {
      const d = new Date(today() + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - back);
      if ([0, 6].includes(d.getUTCDay())) continue;
      const date = d.toISOString().slice(0, 10), status = statusFor(date);
      workers.forEach(([w, ref, name], i) => {
        const [j, jref, jname, site] = jobs[(i + back) % 3 === 2 && i === 3 ? 2 : i % 2];
        const base = {submission_id: id(500 + w), worker_id: id(w), worker_reference: ref, worker_name: name, status, period_label: `w/c ${date}`,
          job_id: id(j), job_reference: jref, job_name: jname, site, date};
        out.push({...base, kind: 'time', id: id(line++), values: {hours: '8.00', break_minutes: 30, code_id: id(31), code_reference: 'N', code_label: 'Normal time',
          activity_id: back % 4 ? id(41) : null, activity_label: back % 4 ? 'Site work' : null}});
        if (back % 5 === 0) out.push({...base, kind: 'time', id: id(line++), values: {hours: '2.00', code_id: id(32), code_reference: 'OT', code_label: 'Overtime', activity_id: id(41), activity_label: 'Site work'}});
        if (i === 0 && back % 7 === 0) out.push({...base, kind: 'subsistence', id: id(line++), values: {amount: '12.50', category_id: id(51), category_reference: 'MEAL', category_label: 'Meal allowance'}});
        if (i === 1 && back % 6 === 0) out.push({...base, kind: 'expense', id: id(line++), values: {gross: '27.90', vat: '0.00', net: '27.90', miles: '62', vehicle: 'car', category_id: id(61), category_reference: 'MILES', category_label: 'Mileage', receipt: false}});
        if (i === 2 && back % 9 === 0) out.push({...base, kind: 'expense', id: id(line++), values: {gross: '48.00', vat: '8.00', net: '40.00', supplier: 'Jewson', category_id: id(62), category_reference: 'MAT', category_label: 'Materials', receipt: true}});
      });
    }
    return out;
  }
  return {
    reference: async () => ({workers: workers.map(([w, reference, name]) => ({id: id(w), reference, name, active: true})),
      jobs: jobs.map(([j, reference, name]) => ({id: id(j), reference, name, active: true})), periods: []}),
    lines: async (firm, f) => all().filter(r => r.date >= f.from && r.date <= f.to
      && (f.approval === 'all' || (f.approval === 'approved') === ['payroll_approved', 'exported'].includes(r.status))
      && (!f.workerId || r.worker_id === f.workerId) && (!f.jobId || r.job_id === f.jobId)),
  };
}

module.exports = {demoData, demoTimesheet};
