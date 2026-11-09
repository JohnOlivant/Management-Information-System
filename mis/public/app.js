'use strict';
(() => {
  const $ = s => document.querySelector(s);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const gbp = new Intl.NumberFormat('en-GB', {style: 'currency', currency: 'GBP', maximumFractionDigits: 0});
  const money = v => gbp.format(v || 0);
  const num = v => v === null || v === undefined ? '–' : new Intl.NumberFormat('en-GB', {maximumFractionDigits: 1}).format(v);
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

  function fixes(list) {
    const apps = ['Quoting', 'Scheduling', 'Timesheets'];
    return `<h2>Things to fix</h2>
      <p class="lead">Gaps in the data that make the other reports less accurate. Each one says where to put it right.</p>
      ${list.length ? apps.filter(a => list.some(f => f.app === a)).map(a => `<h3>In ${a}</h3>${table([{t: 'Problem'}, {t: 'Job'}, {t: 'What to do'}],
        list.filter(f => f.app === a).map(f => [esc(f.problem), `<b>${esc(f.reference)}</b><small>${esc(f.detail)}</small>`, esc(f.fix)]), '')}`).join('')
        : '<div class="table-wrap"><p class="empty">Nothing to fix. 👍</p></div>'}`;
  }

  function render() {
    document.querySelectorAll('.tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    if (!data) return;
    const views = {pipeline: () => pipeline(data.pipeline), orderBook: () => orderBook(data.orderBook), hours: () => hours(data.hours), fixes: () => fixes(data.fixes)};
    const missing = ['quoting', 'scheduling', 'timesheets'].filter(a => !data.have?.[a]);
    $('#main').innerHTML = (missing.length ? `<p class="note">Not linked for this firm yet: ${missing.map(a => a[0].toUpperCase() + a.slice(1)).join(', ')}. Figures from ${missing.length > 1 ? 'those apps' : 'that app'} are missing.</p>` : '') + views[tab]();
    // Widths are set here, not in the markup, so the page needs no inline styles.
    document.querySelectorAll('[data-w]').forEach(el => { el.style.width = el.dataset.w + '%'; });
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
