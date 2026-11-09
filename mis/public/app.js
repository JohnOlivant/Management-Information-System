'use strict';
(() => {
  const $ = s => document.querySelector(s);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const gbp = new Intl.NumberFormat('en-GB', {style: 'currency', currency: 'GBP', maximumFractionDigits: 0});
  const money = v => gbp.format(v || 0);
  // Hours and miles to 2 decimal places, as Timesheets shows them (10.25, not 10.3).
  const num = v => v === null || v === undefined ? '–' : new Intl.NumberFormat('en-GB', {maximumFractionDigits: 2}).format(v);
  const num2 = v => new Intl.NumberFormat('en-GB', {minimumFractionDigits: 2, maximumFractionDigits: 2}).format(v || 0);
  const date = d => d ? new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', {day: 'numeric', month: 'short', year: 'numeric'}) : '–';
  const monthName = m => new Date(m + '-15T12:00:00Z').toLocaleDateString('en-GB', {month: 'short', year: 'numeric'});
  const STATUS = {issued: 'Waiting', accepted: 'Accepted', authorised: 'Authorised', scheduled: 'Scheduled', unscheduled: 'Not scheduled',
    tickets_sent: 'Tickets sent', complete: 'Complete', cancelled: 'Cancelled'};

  let me = null, data = null, tab = 'pipeline';
  try { tab = localStorage.getItem('mis-tab') || tab; } catch { /* private window */ }

  const tile = (label, value, sub = '', cls = '') => `<div class="tile ${cls}"><div class="label">${esc(label)}</div><div class="value">${value}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;
  const table = (head, rows, empty) => rows.length
    ? `<div class="table-wrap"><table><thead><tr>${head.map(h => `<th class="${h.num ? 'num' : ''} ${h.phone === false ? 'hide-phone' : ''}">${esc(h.t)}</th>`).join('')}</tr></thead><tbody>${
      rows.map(r => `<tr>${r.map((c, i) => `<td class="${head[i].num ? 'num' : ''} ${head[i].phone === false ? 'hide-phone' : ''}">${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
    : `<div class="table-wrap"><p class="empty">${esc(empty)}</p></div>`;
  const bars = (items, label) => {
    const max = Math.max(1, ...items.map(i => i.value));
    return `<div class="bars">${items.map(i => `<div class="bar-row"><span>${esc(label(i))}</span><div class="track"><div class="fill" data-w="${(100 * i.value / max).toFixed(1)}"></div></div><span class="amt">${money(i.value)}</span></div>`).join('')}</div>`;
  };
  const groupTable = (title, rows) => `<div><h3>${esc(title)}</h3>${table([{t: title.replace(/^By /, '')}, {t: 'Quotes', num: true}, {t: 'Value', num: true}],
    rows.map(r => [esc(r.key), r.count, money(r.value)]), 'None.')}</div>`;

  function pipeline(p) {
    return `<h2>Quote pipeline</h2>
      <p class="lead">Quotes sent and still waiting for the customer's answer, at the price of the latest proposal, ex VAT. Quotes past their valid-until date are left out.</p>
      <div class="tiles">
        ${tile('Open quotes', p.count)}
        ${tile('Value waiting', money(p.value), `${money(p.firmValue)} firm, ${money(p.budgetValue)} budget`)}
        ${tile('Running out in 14 days', p.expiringSoon.length, p.expiringSoon.length ? money(p.expiringSoon.reduce((s, q) => s + q.value, 0)) : '', p.expiringSoon.length ? 'warn' : '')}
      </div>
      ${p.expiringSoon.length ? `<h3>Running out soon: chase these</h3>${table([{t: 'Quote'}, {t: 'Customer'}, {t: 'Valid until'}, {t: 'Value', num: true}],
        p.expiringSoon.map(q => [`<b>${esc(q.reference)}</b><small>${esc(q.title)}</small>`, esc(q.customer || '–'), date(q.validUntil), money(q.value)]), '')}` : ''}
      <h3>By month sent</h3>${p.byMonth.length ? bars(p.byMonth, i => monthName(i.key)) : '<div class="table-wrap"><p class="empty">No open quotes.</p></div>'}
      <div class="grid2">${groupTable('By customer', p.byCustomer)}${groupTable('By lead source', p.byLeadSource)}${groupTable('By job type', p.byJobType)}</div>
      <h3>All open quotes</h3>
      ${table([{t: 'Quote'}, {t: 'Customer'}, {t: 'Type', phone: false}, {t: 'Sent', phone: false}, {t: 'Days waiting', num: true, phone: false}, {t: 'Valid until'}, {t: 'Value', num: true}],
        p.quotes.map(q => [`<b>${esc(q.reference)}</b><small>${esc(q.title)}</small>`, esc(q.customer || '–'), q.kind === 'firm' ? 'Firm' : 'Budget',
          date(q.issuedOn), q.ageDays, date(q.validUntil), money(q.value)]), 'No quotes are waiting for an answer.')}`;
  }

  function orderBook(o) {
    const next3 = o.cashIn.slice(0, 3).reduce((s, m) => s + m.value, 0);
    return `<h2>Order book and expected cash in</h2>
      <p class="lead">Jobs the customer has accepted that are not yet complete, at the accepted price ex VAT, and when the money is due from each job's payment stages. This is what is <b>expected</b>: until Xero is linked the MIS can't see what has been invoiced or paid.</p>
      <div class="tiles">
        ${tile('Jobs in hand', o.count)}
        ${tile('Order book', money(o.value))}
        ${tile('Due in the next 3 months', money(next3))}
        ${o.pastDue ? tile('Stage dates passed', money(o.pastDue), 'Check in Xero whether these are paid', 'warn') : ''}
        ${o.noStages ? tile('Jobs with no stages', money(o.noStages), 'Not in the cash-in chart', 'warn') : ''}
      </div>
      <h3>Expected cash in by month</h3>${bars(o.cashIn, i => monthName(i.month))}
      ${o.later ? `<p class="muted">Plus ${money(o.later)} due after that.</p>` : ''}
      <h3>Jobs</h3>
      ${table([{t: 'Job'}, {t: 'Customer'}, {t: 'Status', phone: false}, {t: 'Programme', phone: false}, {t: 'Payment stages'}, {t: 'Value', num: true}],
        o.jobs.map(j => [`<b>${esc(j.reference)}</b><small>${esc(j.title)}</small>`, esc(j.customer || '–'), esc(STATUS[j.status] || j.status),
          j.starts ? `${date(j.starts)} to ${date(j.ends)}` : '<span class="muted">Not scheduled</span>',
          j.stages.length ? j.stages.map(s => `${esc(s.description)}: ${money(s.amount)} <span class="muted">${date(s.expectedOn)}</span>${s.passed ? ' <span class="pill near">date passed</span>' : ''}`).join('<br>')
            : '<span class="pill near">none set</span>',
          money(j.value)]), 'No accepted jobs in hand.')}`;
  }

  function hours(h) {
    const meter = j => j.usedShare === null ? '<span class="muted">no plan</span>'
      : `<span class="meter ${j.flag === 'over' ? 'over' : ''}"><span data-w="${Math.min(100, j.usedShare)}"></span></span>${j.usedShare}%`;
    const flag = j => j.flag === 'over' ? '<span class="pill over">Over plan</span>' : j.flag === 'near' ? `<span class="pill near">Past ${h.warnAt}%</span>` : '';
    return `<h2>Hours by job</h2>
      <p class="lead">Hours planned in Scheduling against hours booked in Timesheets, matched on the job number. Quoted hours are the man-hours Quoting sent with the job. Booked hours include timesheets not yet approved.</p>
      <div class="tiles">
        ${tile('Over plan', h.over, '', h.over ? 'warn' : '')}
        ${tile(`Past ${h.warnAt}% of plan`, h.near, 'and not complete', h.near ? 'warn' : '')}
        ${tile('Live jobs: hours used', num(h.usedHours), `of ${num(h.plannedHours)} planned`)}
      </div>
      <h3>Jobs</h3>
      ${table([{t: 'Job'}, {t: 'Status', phone: false}, {t: 'Quoted', num: true, phone: false}, {t: 'Planned', num: true}, {t: 'Booked', num: true}, {t: 'Used of plan'}, {t: ''}],
        h.jobs.map(j => [`<b>${esc(j.jobNumber)}</b><small>${esc(j.name)}</small>`, esc(STATUS[j.status] || j.status), num(j.quotedHours), num(j.plannedHours),
          `${num(j.approvedHours + j.pendingHours)}${j.pendingHours ? `<small>${num(j.pendingHours)} not approved</small>` : ''}`, meter(j), flag(j)]),
        'No jobs in Scheduling yet.')}`;
  }

  const pct = v => v === null || v === undefined ? '–' : v + '%';
  const weekName = w => 'w/c ' + new Date(w + 'T12:00:00Z').toLocaleDateString('en-GB', {day: 'numeric', month: 'short'});
  const OUTCOME = {lost: 'Declined', expired: 'Ran out'};

  function winRate(w) {
    const groupBlock = (title, rows) => `<div><h3>${esc(title)}</h3>${table([{t: title.replace(/^By /, '')}, {t: 'Won', num: true}, {t: 'Lost', num: true}, {t: 'Win rate', num: true}, {t: 'Won value', num: true, phone: false}],
      rows.map(g => [esc(g.key), g.won, g.lost + g.expired, pct(g.rate), money(g.wonValue)]), 'No quotes with an answer yet.')}</div>`;
    const maxDecided = Math.max(1, ...w.byMonth.map(m => m.decided + m.open));
    return `<h2>Win rate</h2>
      <p class="lead">Quotes first sent since ${date(w.since)}, and what became of them. The win rate is quotes won out of those with an answer: won, declined, or ran out with no answer. Quotes still waiting are shown but left out of the rate. Values are ex VAT, at the accepted price for won jobs.</p>
      <div class="tiles">
        ${tile('Win rate', pct(w.rate), `${w.won} won of ${w.decided} answered`)}
        ${tile('Win rate by value', pct(w.valueRate), `${money(w.wonValue)} won of ${money(w.wonValue + w.lostValue + w.expiredValue)}`)}
        ${tile('Lost or ran out', w.lost + w.expired, `${money(w.lostValue + w.expiredValue)}; ${w.expired} with no answer`)}
        ${tile('Time to an answer', w.daysToWin === null ? '–' : `${Math.round(w.daysToWin)} days`, w.daysToLose === null ? 'typical time to a yes' : `typical time to a yes; ${Math.round(w.daysToLose)} days to a no`)}
      </div>
      <h3>By month first sent</h3>
      <div class="bars">${w.byMonth.map(m => `<div class="bar-row wide"><span>${esc(monthName(m.key))}</span><div class="track stack">
          <span class="seg won" data-w="${(100 * m.won / maxDecided).toFixed(1)}"></span><span class="seg lost" data-w="${(100 * (m.lost + m.expired) / maxDecided).toFixed(1)}"></span><span class="seg open" data-w="${(100 * m.open / maxDecided).toFixed(1)}"></span>
        </div><span class="amt">${m.decided ? `${m.won} of ${m.decided} · ${m.rate}%` : m.open ? `${m.open} waiting` : '–'}</span></div>`).join('')}
        <div class="legend"><span><i class="seg won"></i>Won</span><span><i class="seg lost"></i>Lost or ran out</span><span><i class="seg open"></i>Still waiting</span></div>
      </div>
      <p class="muted">Lost counts quotes declined and quotes that ran out with no answer.</p>
      <div class="grid2">${groupBlock('By lead source', w.byLeadSource)}${groupBlock('By job type', w.byJobType)}</div>
      <div class="grid2">${groupBlock('By customer', w.byCustomer.slice(0, 10))}${groupBlock('Firm or budget', w.byKind)}</div>
      <h3>Quotes lost or run out</h3>
      ${table([{t: 'Quote'}, {t: 'Customer'}, {t: 'What happened'}, {t: 'Lead source', phone: false}, {t: 'Sent', phone: false}, {t: 'Value', num: true}],
        w.lostQuotes.map(q => [`<b>${esc(q.reference)}</b><small>${esc(q.title)}</small>`, esc(q.customer || '–'),
          `${OUTCOME[q.outcome]}<small>${date(q.endedOn)}</small>`, esc(q.leadSource), date(q.sentOn), money(q.value)]), 'None lost in this time.')}`;
  }

  function capacity(c) {
    const over = c.weeks.filter(w => w.free < 0).length;
    const h = v => num(Math.round(v));
    const cell = x => x.available === 0 && x.booked === 0 ? '<span class="muted">–</span>'
      : `<span class="${x.booked > x.available ? 'pill over' : x.share !== null && x.share < 50 ? 'pill ok' : ''}">${h(x.booked)}/${h(x.available)}</span>`;
    return `<h2>Crew capacity</h2>
      <p class="lead">Crew hours free against hours booked in Scheduling, this week (from today) and the next seven. Each active worker has a ${num(c.dayHours)}-hour day, Monday to Friday (set for each firm), less holiday, sickness, training and other time booked away. Booked hours follow each job's daily times. Still to crew is the hours on jobs short of their minimum crew.</p>
      <div class="tiles">
        ${tile('Crew', c.crew, 'active workers in Scheduling')}
        ${tile('Booked', pct(c.share), `${h(c.booked)} of ${h(c.available)} hours`)}
        ${tile(c.free >= 0 ? 'Free hours' : 'Over-booked', h(Math.abs(c.free)), over ? `${over} week${over > 1 ? 's' : ''} over-booked` : 'over the 8 weeks', over ? 'warn' : '')}
        ${tile('Still to crew', h(c.unfilled), c.short.length ? `hours on ${c.short.length} job${c.short.length > 1 ? 's' : ''}` : 'every job has its crew', c.unfilled ? 'warn' : '')}
      </div>
      <h3>Week by week</h3>
      ${table([{t: 'Week'}, {t: 'Available', num: true}, {t: 'Booked', num: true}, {t: 'Free', num: true}, {t: 'Booked share'}, {t: 'Still to crew', num: true, phone: false}, {t: 'Away', num: true, phone: false}],
        c.weeks.map((w, i) => [`<span class="nowrap">${i === 0 ? 'This week' : weekName(w.week)}</span>`, h(w.available), h(w.booked),
          w.free < 0 ? `<span class="pill over">${h(-w.free)} over</span>` : h(w.free),
          w.share === null ? '–' : `<span class="meter ${w.share > 100 ? 'over' : ''}"><span data-w="${Math.min(100, w.share)}"></span></span>${w.share}%`,
          w.unfilled ? `<span class="pill near">${h(w.unfilled)}</span>` : '0', h(w.away)]), 'No crew in Scheduling.')}
      ${c.short.length ? `<h3>Jobs short of crew</h3>${table([{t: 'Job'}, {t: 'Dates'}, {t: 'Crew', num: true}, {t: 'Needs', num: true}, {t: 'Hours to crew', num: true}],
        c.short.map(j => [`<b>${esc(j.jobNumber)}</b><small>${esc(j.name)}</small>`, `<span class="nowrap">${date(j.starts)}</span> to <span class="nowrap">${date(j.ends)}</span>`, j.crew, j.needed, h(j.hours)]), '')}` : ''}
      <h3>By worker</h3>
      <p class="muted">Hours booked of hours available each week. Least booked first.</p>
      ${table([{t: 'Worker'}, ...c.weeks.map((w, i) => ({t: i === 0 ? 'This wk' : weekName(w.week).slice(4), num: true, phone: i < 3})), {t: 'Booked', num: true}],
        c.workers.map(p => [`<b>${esc(p.name)}</b><small>${esc(p.jobTitle)}${p.clashes ? ` · <span class="pill over">booked on ${p.clashes} day${p.clashes > 1 ? 's' : ''} away</span>` : ''}</small>`,
          ...p.weeks.map(cell), pct(p.share)]), 'No active workers in Scheduling.')}`;
  }

  function hoursWent(r) {
    const max = Math.max(1, ...r.weeks.map(w => w.all));
    const seg = (cls, v) => `<span class="seg ${cls}" data-w="${(100 * v / max).toFixed(1)}"></span>`;
    const leave = r.holiday + r.sickness;
    return `<h2>Where the hours went</h2>
      <p class="lead">Hours in Timesheets over the last 12 weeks (${date(r.from)} to ${date(r.to)}), split between customer jobs, internal work and leave. Includes timesheets not yet approved; drafts are left out.</p>
      <div class="tiles">
        ${tile('Hours worked', num(Math.round(r.worked)), `${num(Math.round(leave))} more on leave`)}
        ${tile('On customer jobs', pct(r.customerShare), `${num(Math.round(r.customer))} hours`)}
        ${tile('Internal', num(Math.round(r.internal)), 'hours on yards, vans, office and other own work', r.customerShare !== null && r.customerShare < 75 ? 'warn' : '')}
        ${tile('Holiday and sickness', num(Math.round(leave)), `${num(Math.round(r.holiday))} holiday, ${num(Math.round(r.sickness))} sickness`)}
      </div>
      <h3>Week by week</h3>
      <div class="bars">${r.weeks.map(w => `<div class="bar-row wide"><span>${esc(weekName(w.week).slice(4))}</span><div class="track stack">
          ${seg('won', w.customer)}${seg('internal', w.internal)}${seg('leave', w.holiday + w.sickness)}
        </div><span class="amt">${num(Math.round(w.all))} h${w.customerShare === null ? '' : ` · ${w.customerShare}%`}</span></div>`).join('')}
        <div class="legend"><span><i class="seg won"></i>Customer jobs</span><span><i class="seg internal"></i>Internal</span><span><i class="seg leave"></i>Holiday and sickness</span><span class="muted">% is the share of worked hours on customer jobs</span></div>
      </div>
      <div class="grid2">
        <div><h3>Customer jobs</h3>${table([{t: 'Job'}, {t: 'Weeks', num: true}, {t: 'Hours', num: true}],
          r.customerJobs.map(j => [`<b>${esc(j.jobNumber)}</b><small>${esc(j.name)}</small>`, j.weeks, num2(j.hours)]), 'No hours on customer jobs.')}</div>
        <div><h3>Internal work</h3>${table([{t: 'Job'}, {t: 'Weeks', num: true}, {t: 'Hours', num: true}],
          r.internalJobs.map(j => [`<b>${esc(j.jobNumber)}</b><small>${esc(j.name)}</small>`, j.weeks, num2(j.hours)]), 'No internal hours.')}</div>
      </div>
      <h3>By worker</h3>
      ${table([{t: 'Worker'}, {t: 'Customer', num: true}, {t: 'Internal', num: true}, {t: 'Leave', num: true, phone: false}, {t: 'On customer jobs'}],
        r.workers.map(p => [esc(p.name), num2(p.customer), num2(p.internal), num2(p.holiday + p.sickness),
          p.customerShare === null ? '–' : `<span class="meter"><span data-w="${p.customerShare}"></span></span>${p.customerShare}%`]), 'No hours in these weeks.')}`;
  }

  function fixes(list) {
    const apps = ['Quoting', 'Scheduling', 'Timesheets'];
    return `<h2>Things to fix</h2>
      <p class="lead">Gaps in the data that make the other reports less accurate. Each one says where to put it right.</p>
      ${list.length ? apps.filter(a => list.some(f => f.app === a)).map(a => `<h3>In ${a}</h3>${table([{t: 'Problem'}, {t: 'Job'}, {t: 'What to do'}],
        list.filter(f => f.app === a).map(f => [esc(f.problem), `<b>${esc(f.reference)}</b><small>${esc(f.detail)}</small>`, esc(f.fix)]), '')}`).join('')
        : '<div class="table-wrap"><p class="empty">Nothing to fix. 👍</p></div>'}`;
  }

  // ---- Timesheet report: the Timesheets app's own report, for the whole firm ----
  const TS_STATUS = {draft: 'Draft', submitted: 'Awaiting supervisor', supervisor_approved: 'Awaiting payroll', payroll_approved: 'Payroll approved',
    supervisor_returned: 'Returned by supervisor', payroll_returned: 'Returned by payroll', exported: 'Exported'};
  let ts = null; // {firm, ref, filters, report, error, busy}
  const firmId = () => $('#firm').value;
  const tsQuery = f => new URLSearchParams({firm: firmId(), from: f.from, to: f.to, approval: f.approval, workerId: f.workerId, jobId: f.jobId}).toString();

  async function tsLoad() {
    if (ts && ts.firm === firmId()) return;
    ts = {firm: firmId(), busy: true};
    try {
      const ref = await get('/api/timesheet-report/reference?firm=' + encodeURIComponent(firmId()));
      const iso = data.today, period = ref.periods.find(p => p.date_from <= iso && p.date_to >= iso);
      const back = new Date(iso + 'T12:00:00Z'); back.setUTCDate(back.getUTCDate() - 27);
      ts.ref = ref;
      ts.filters = {from: period ? period.date_from : back.toISOString().slice(0, 10), to: period ? period.date_to : iso, approval: 'all', workerId: '', jobId: ''};
      await tsRun(false);
    } catch (e) { ts.error = e.message; ts.busy = false; }
    if (tab === 'timesheet') render();
  }

  async function tsRun(draw = true) {
    ts.busy = true; ts.error = null;
    if (draw) render();
    try { ts.report = await get('/api/timesheet-report?' + tsQuery(ts.filters)); } catch (e) { ts.error = e.message; ts.report = null; }
    ts.busy = false;
    if (draw) render();
  }

  function timesheet() {
    if (!ts || ts.firm !== firmId()) { tsLoad(); return '<h2>Timesheet report</h2><p class="muted">Loading…</p>'; }
    if (!ts.ref) return `<h2>Timesheet report</h2><p class="note">${esc(ts.error || 'Loading…')}</p>`;
    const f = ts.filters, r = ts.report;
    const opt = (list, all, chosen) => `<option value="">${all}</option>` + list.map(x => `<option value="${esc(x.id)}" ${x.id === chosen ? 'selected' : ''}>${esc((x.reference ? x.reference + ' · ' : '') + x.name + (x.active ? '' : ' (retired)'))}</option>`).join('');
    const money2 = v => new Intl.NumberFormat('en-GB', {style: 'currency', currency: 'GBP'}).format(v || 0);
    const amounts = [{t: 'Hours', num: true, v: x => num2(x.hours)}, {t: 'Subsistence', num: true, v: x => money2(x.subsistence)},
      {t: 'Expenses incl. mileage', num: true, v: x => money2(x.expenses)}, {t: 'Mileage', num: true, v: x => money2(x.mileage), phone: false}, {t: 'Miles', num: true, v: x => num2(x.miles), phone: false}];
    const block = (title, rows, cols, note = '') => `<div><h3>${esc(title)}</h3>${note ? `<p class="muted">${esc(note)}</p>` : ''}${table(cols, rows.map(x => cols.map(c => c.v(x))), 'Nothing matches these filters.')}</div>`;
    let results = '';
    if (ts.busy) results = '<p class="muted">Running…</p>';
    else if (ts.error) results = `<p class="note">${esc(ts.error)}</p>`;
    else if (r) {
      const csv = view => '/api/timesheet-report?' + tsQuery(f) + '&format=csv&view=' + view;
      results = `<div class="tiles">
          ${tile('Total hours', num2(r.totals.hours))}${tile('Subsistence', money2(r.totals.subsistence))}
          ${tile('Expenses incl. mileage', money2(r.totals.expenses), `${money2(r.totals.mileage)} mileage, ${num2(r.totals.miles)} miles`)}
          ${tile('Workers with activity', r.workerCount, `${r.lineCount} lines`)}
        </div>
        <div class="downloads"><span class="muted">Download CSV:</span>
          ${[['detail', 'All detail'], ['workers', 'By worker'], ['jobs', 'By job'], ['codes', 'By code'], ['activities', 'By activity'], ['categories', 'By expense category'], ['statuses', 'By approval status']]
            .map(([v, label]) => `<a href="${esc(csv(v))}">${label}</a>`).join('')}
        </div>
        ${block('By worker', r.byWorker, [{t: 'Reference', v: x => esc(x.reference)}, {t: 'Worker', v: x => esc(x.name)}, ...amounts])}
        ${block('By job', r.byJob, [{t: 'Job', v: x => `<b>${esc(x.reference)}</b><small>${esc(x.name + (x.site ? ' · ' + x.site : ''))}</small>`}, ...amounts])}
        <div class="grid2">
          ${block('Hours by allocation code', r.byCode, [{t: 'Code', v: x => esc(x.reference)}, {t: 'Meaning', v: x => esc(x.name)}, {t: 'Hours', num: true, v: x => num2(x.hours)}])}
          ${block('Hours by activity', r.byActivity, [{t: 'Activity', v: x => esc(x.name)}, {t: 'Hours', num: true, v: x => num2(x.hours)}], `${num2(r.hoursWithoutActivity)} hours have no activity recorded.`)}
        </div>
        ${block('Expenses by category', r.byExpenseCategory, [{t: 'Reference', v: x => esc(x.reference)}, {t: 'Category', v: x => esc(x.name)}, {t: 'Gross', num: true, v: x => money2(x.expenses)},
          {t: 'VAT', num: true, v: x => money2(x.vat)}, {t: 'Net', num: true, v: x => money2(x.net)}, {t: 'Miles', num: true, v: x => num2(x.miles), phone: false}])}
        ${block('By approval status', r.byStatus, [{t: 'Status', v: x => esc(TS_STATUS[x.name] || x.name)}, ...amounts])}`;
    }
    return `<h2>Timesheet report</h2>
      <p class="lead">The Timesheets app's report, for everyone in the firm. Hours use the work date, subsistence the claim date, and expenses and mileage the receipt or journey date. Rejected and removed claims are left out. No pay rates or labour costs.</p>
      <form id="ts-form" class="filters">
        <label>From<input name="from" type="date" value="${esc(f.from)}" required></label>
        <label>To<input name="to" type="date" value="${esc(f.to)}" required></label>
        <label>Approval<select name="approval">${[['all', 'All approval stages'], ['approved', 'Payroll approved / exported'], ['pending', 'Not payroll approved']].map(([v, l]) => `<option value="${v}" ${v === f.approval ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label>Worker<select name="workerId">${opt(ts.ref.workers, 'All workers', f.workerId)}</select></label>
        <label>Job<select name="jobId">${opt(ts.ref.jobs, 'All jobs', f.jobId)}</select></label>
        <button ${ts.busy ? 'disabled' : ''}>Run report</button>
      </form>
      ${results}`;
  }

  function wire() {
    const form = $('#ts-form');
    if (form) form.addEventListener('submit', e => {
      e.preventDefault();
      const el = form.elements;
      ts.filters = {from: el.from.value, to: el.to.value, approval: el.approval.value, workerId: el.workerId.value, jobId: el.jobId.value};
      tsRun();
    });
  }

  function render() {
    document.querySelectorAll('.tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    if (!data) return;
    const views = {pipeline: () => pipeline(data.pipeline), winRate: () => winRate(data.winRate), orderBook: () => orderBook(data.orderBook),
      capacity: () => capacity(data.capacity), hours: () => hours(data.hours), hoursWent: () => hoursWent(data.hoursWent), timesheet, fixes: () => fixes(data.fixes)};
    if (!views[tab]) tab = 'pipeline';
    const missing = ['quoting', 'scheduling', 'timesheets'].filter(a => !data.have?.[a]);
    $('#main').innerHTML = (missing.length ? `<p class="note">Not linked for this firm yet: ${missing.map(a => a[0].toUpperCase() + a.slice(1)).join(', ')}. Figures from ${missing.length > 1 ? 'those apps' : 'that app'} are missing.</p>` : '') + views[tab]();
    // Widths are set here, not in the markup, so the page needs no inline styles.
    document.querySelectorAll('[data-w]').forEach(el => { el.style.width = el.dataset.w + '%'; });
    wire();
    const n = data.fixes.length;
    $('#fix-count').hidden = !n; $('#fix-count').textContent = n;
    $('#foot').textContent = `Figures as of ${date(data.today)}. Refreshed when you open the page (at most a minute old).`;
  }

  async function get(url) {
    const r = await fetch(url, {credentials: 'same-origin'});
    const body = await r.json().catch(() => ({}));
    if (r.status === 401 && body.signIn) { location.href = body.signIn; throw new Error('signing in'); }
    if (!r.ok) throw new Error(body.error || 'Something went wrong.');
    return body;
  }

  async function loadFirm(id) {
    $('#main').innerHTML = '<p class="muted">Loading…</p>';
    try { data = await get('/api/reports?firm=' + encodeURIComponent(id)); render(); try { localStorage.setItem('mis-firm', id); } catch {} }
    catch (e) { $('#main').innerHTML = `<p class="note">${esc(e.message)}</p>`; }
  }

  async function start() {
    try { me = await get('/api/me'); } catch (e) { $('#main').innerHTML = `<p class="note">${esc(e.message)}</p>`; return; }
    $('#name').textContent = me.name;
    $('#signout').href = me.signOut; $('#password').href = me.password;
    // Back to the sign-in page's list of every app, in this tab.
    if (me.home) { $('#home').href = me.home; $('#home').hidden = false; }
    // Each app opens in its own tab, so figures can be checked side by side.
    $('#apps').innerHTML = (me.apps || []).map(a => `<a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.name)}</a>`).join('');
    if (!me.firms.length) {
      $('#main').innerHTML = '<p class="note">Your login has no firm set up in Management Information yet. Ask your Rule29 contact to add one.</p>';
      return;
    }
    let saved = null; try { saved = localStorage.getItem('mis-firm'); } catch {}
    const first = me.firms.find(f => f.id === saved) || me.firms[0];
    const sel = $('#firm');
    sel.innerHTML = me.firms.map(f => `<option value="${esc(f.id)}">${esc(f.name)}</option>`).join('');
    sel.value = first.id; sel.hidden = me.firms.length < 2;
    sel.addEventListener('change', () => loadFirm(sel.value));
    loadFirm(first.id);
  }

  document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => {
    tab = b.dataset.tab; try { localStorage.setItem('mis-tab', tab); } catch {}
    render(); window.scrollTo(0, 0);
  }));
  start();
})();
