'use strict';
// The setup page: everyone's login, and which apps, firms and roles each person has.
(() => {
  const $ = id => document.getElementById(id);
  let state = null, csrf = '', openId = null;

  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === false || v == null) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'style') for (const [p, val] of Object.entries(v)) el.style.setProperty(p, val);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
    for (const c of children.flat()) if (c != null && c !== false) el.append(c);
    return el;
  }

  async function api(path, body) {
    const res = await fetch('/api' + path, body === undefined ? {credentials: 'same-origin'} : {
      method: 'POST', credentials: 'same-origin',
      headers: {'Content-Type': 'application/json', 'X-CSRF-Token': csrf}, body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(data.error || 'Something went wrong. Try again.'); e.status = res.status; throw e; }
    return data;
  }

  const show = id => { for (const s of ['loading', 'blocked', 'list']) $(s).hidden = s !== id; };
  const appById = id => state.apps.find(a => a.id === id);
  const personById = id => state.people.find(p => p.id === id);
  const roleNames = (app, role) => role.split(',').filter(Boolean).map(r => app?.roles.find(x => x.id === r)?.name || r).join(', ') || 'No role';
  const firmLabel = x => x.tenantName || x.tenantId;
  const nameOf = p => p.displayName || p.email;
  function tempPassword() {
    const words = ['amber', 'brook', 'cedar', 'delta', 'ember', 'fern', 'grove', 'harbour', 'iris', 'juniper', 'kestrel', 'linden',
      'meadow', 'north', 'oak', 'pebble', 'quarry', 'river', 'slate', 'thistle', 'upland', 'violet', 'willow', 'yarrow'];
    const pick = () => words[crypto.getRandomValues(new Uint32Array(1))[0] % words.length];
    return `${pick()}-${pick()}-${pick()}-${crypto.getRandomValues(new Uint32Array(1))[0] % 90 + 10}`;
  }

  function notice(id, text) { $(id).textContent = text || ''; $(id).hidden = !text; }

  // ---- The list of people ----
  function renderList() {
    const q = $('search').value.trim().toLowerCase(), appFilter = $('app-filter').value;
    const people = state.people.filter(p => (!q || (p.email + ' ' + p.displayName).toLowerCase().includes(q))
      && (!appFilter || p.access.some(x => x.app === appFilter)));
    $('people-empty').hidden = people.length > 0;
    $('people').replaceChildren(...people.map(p => {
      const tags = [];
      if (!p.active) tags.push(h('span', {class: 'tag off'}, 'Switched off'));
      if (p.setupAdmin) tags.push(h('span', {class: 'tag'}, 'Setup'));
      if (p.mustChangePassword && p.active) tags.push(h('span', {class: 'tag'}, 'Temporary password'));
      const access = p.access.length ? p.access.map(x => {
        const app = appById(x.app);
        return h('li', {class: 'chip'},
          h('span', {class: 'chip-mark', style: app ? {background: app.accent, color: app.accentInk} : {}, 'aria-hidden': 'true'}, app ? app.mark : '?'),
          h('span', null, h('strong', null, app ? app.name : x.app), ` · ${firmLabel(x)} · ${roleNames(app, x.role)}`));
      }) : [h('li', {class: 'muted none'}, 'No apps yet')];
      return h('li', {class: 'person' + (p.active ? '' : ' inactive')},
        h('button', {type: 'button', class: 'person-open', onclick: () => openPerson(p.id), 'aria-label': `Change ${nameOf(p)}`},
          h('span', {class: 'person-who'}, h('strong', null, nameOf(p)), p.displayName ? h('small', null, p.email) : null, tags.length ? h('span', {class: 'tags'}, tags) : null),
          h('ul', {class: 'chips'}, access),
          h('span', {class: 'person-edit', 'aria-hidden': 'true'}, 'Change')));
    }));
  }

  // ---- One person ----
  function openPerson(id, message) {
    openId = id;
    renderPerson();
    notice('person-notice', message);
    for (const f of ['details-form', 'reset-form']) $(f).querySelector('.error').hidden = true;
    $('reset-password').value = '';
    if (!$('person-dialog').open) $('person-dialog').showModal();
  }

  function renderPerson() {
    const p = personById(openId);
    if (!p) { $('person-dialog').close(); return; }
    const self = p.id === state.me;
    $('person-title').textContent = nameOf(p);
    $('person-email').textContent = p.email + (p.mustChangePassword ? ' · has a temporary password' : '');
    $('person-name').value = p.displayName;
    $('person-active').checked = p.active; $('person-active').disabled = self;
    $('person-admin').checked = p.setupAdmin; $('person-admin').disabled = self;
    $('reset-form').hidden = self;
    $('person-apps').replaceChildren(...state.apps.map(app => appBlock(p, app)));
  }

  function roleInput(app, current, name) {
    const chosen = current ? current.split(',') : [];
    if (app.multipleRoles) {
      return h('fieldset', {class: 'roles'}, h('legend', null, 'Roles'),
        app.roles.map(r => h('label', {class: 'check'}, h('input', {type: 'checkbox', name, value: r.id, checked: chosen.includes(r.id)}), ' ' + r.name)));
    }
    const id = `${name}-select`;
    return h('div', null, h('label', {for: id}, 'Role'),
      h('select', {id, name}, current ? null : h('option', {value: ''}, 'Choose a role'),
        app.roles.map(r => h('option', {value: r.id, selected: chosen[0] === r.id}, r.name))));
  }
  const readRole = (form, app, name) => app.multipleRoles
    ? [...form.querySelectorAll(`input[name="${name}"]:checked`)].map(i => i.value)
    : form.querySelector(`select[name="${name}"]`).value;

  function appBlock(p, app) {
    const rows = p.access.filter(x => x.app === app.id);
    const mark = h('span', {class: 'chip-mark', style: {background: app.accent, color: app.accentInk}, 'aria-hidden': 'true'}, app.mark);
    const existing = rows.map((x, i) => {
      const name = `role-${app.id}-${i}`;
      const err = h('p', {class: 'error', role: 'alert', hidden: true});
      const form = h('form', {class: 'access', novalidate: true},
        h('p', {class: 'access-firm'}, h('strong', null, firmLabel(x)), x.tenantName ? h('small', null, ` ${x.tenantId}`) : null),
        roleInput(app, x.role, name), err,
        h('div', {class: 'row tight'},
          h('button', {type: 'submit', class: 'secondary'}, 'Save role'),
          h('button', {type: 'button', class: 'danger-link', onclick: () => change(err, '/setup/access',
            {accountId: p.id, app: app.id, tenantId: x.tenantId, remove: true}, `${nameOf(p)} can no longer open ${app.name} for ${firmLabel(x)}.`)},
            `Remove ${app.name} access`)));
      form.addEventListener('submit', e => { e.preventDefault(); change(err, '/setup/access',
        {accountId: p.id, app: app.id, tenantId: x.tenantId, tenantName: x.tenantName, role: readRole(form, app, name)}, `${app.name} role saved.`); });
      return form;
    });

    // Give access at another firm: one the app already has people at, or a new one by its id.
    const taken = new Set(rows.map(x => x.tenantId));
    const firms = app.firms.filter(f => !taken.has(f.tenantId));
    const name = `role-${app.id}-new`, firmId = `firm-${app.id}`;
    const otherId = h('input', {type: 'text', id: `${firmId}-id`, autocomplete: 'off'});
    const otherName = h('input', {type: 'text', id: `${firmId}-name`, autocomplete: 'off'});
    const other = h('div', {class: 'other-firm', hidden: firms.length > 0},
      h('label', {for: `${firmId}-id`}, `Firm id in ${app.name}`), otherId,
      h('p', {class: 'hint'}, app.id === 'quoting' ? 'The company id from Quoting.' : 'The client id the app uses for this firm.'),
      h('label', {for: `${firmId}-name`}, 'Firm name'), otherName);
    const select = h('select', {id: firmId, onchange: () => { other.hidden = select.value !== '*'; }},
      firms.map(f => h('option', {value: f.tenantId}, firmLabel(f))), h('option', {value: '*'}, 'Another firm…'));
    if (!firms.length) select.value = '*';
    const err = h('p', {class: 'error', role: 'alert', hidden: true});
    const add = h('form', {class: 'access add', novalidate: true},
      h('p', {class: 'access-firm'}, h('strong', null, rows.length ? `Give ${app.name} access at another firm` : `Give ${app.name} access`)),
      h('label', {for: firmId}, 'Firm'), select, other, roleInput(app, '', name), err,
      h('button', {type: 'submit', class: 'secondary'}, `Give ${app.name} access`));
    add.addEventListener('submit', e => {
      e.preventDefault();
      const isOther = select.value === '*', firm = firms.find(f => f.tenantId === select.value);
      const tenantId = isOther ? otherId.value.trim() : select.value, tenantName = isOther ? otherName.value.trim() : firm.tenantName;
      if (!tenantId) { err.textContent = 'Enter the firm id.'; err.hidden = false; return; }
      change(err, '/setup/access', {accountId: p.id, app: app.id, tenantId, tenantName, role: readRole(add, app, name)}, `${nameOf(p)} can now open ${app.name}.`);
    });

    return h('section', {class: 'app-block', 'aria-label': app.name},
      h('h4', null, mark, app.name, rows.length ? null : h('small', null, 'No access')),
      existing, h('details', {class: 'add-wrap'}, h('summary', null, rows.length ? 'Add another firm' : `Give ${app.name} access`), add));
  }

  async function change(errorBox, path, body, done) {
    errorBox.hidden = true;
    try {
      state = await api(path, body);
      renderList(); renderPerson(); notice('person-notice', done);
      $('person-dialog').scrollTop = 0;
    } catch (e) { errorBox.textContent = e.message; errorBox.hidden = false; }
  }

  $('details-form').addEventListener('submit', e => {
    e.preventDefault();
    change($('details-form').querySelector('.error'), '/setup/person',
      {id: openId, displayName: $('person-name').value, active: $('person-active').checked, setupAdmin: $('person-admin').checked}, 'Login saved.');
  });
  $('reset-form').addEventListener('submit', e => {
    e.preventDefault();
    const pw = $('reset-password').value;
    const err = $('reset-form').querySelector('.error');
    if (pw.length < state.passwordMin) { err.textContent = `Use at least ${state.passwordMin} characters.`; err.hidden = false; return; }
    change(err, '/setup/reset-password', {accountId: openId, temporaryPassword: pw}, `Password reset. Give ${pw} to them; they choose their own when they next sign in.`);
  });
  $('reset-generate').addEventListener('click', () => { $('reset-password').value = tempPassword(); });

  // ---- Adding someone ----
  $('add-person').addEventListener('click', () => {
    for (const id of ['new-email', 'new-name']) $(id).value = '';
    $('new-password').value = tempPassword();
    $('new-form').querySelector('.error').hidden = true;
    $('new-dialog').showModal();
    $('new-email').focus();
  });
  $('new-generate').addEventListener('click', () => { $('new-password').value = tempPassword(); });
  $('new-form').addEventListener('submit', async e => {
    e.preventDefault();
    const err = $('new-form').querySelector('.error'), email = $('new-email').value.trim().toLowerCase(), pw = $('new-password').value;
    err.hidden = true;
    try {
      if (!email) throw new Error('Enter their email.');
      if (pw.length < state.passwordMin) throw new Error(`Use a temporary password of at least ${state.passwordMin} characters.`);
      state = await api('/setup/person', {email, displayName: $('new-name').value, temporaryPassword: pw});
      $('new-dialog').close();
      renderList();
      const p = state.people.find(x => x.email === email);
      if (p) openPerson(p.id, `Added. Their temporary password is ${pw}. Now choose their apps.`);
    } catch (ex) { err.textContent = ex.message; err.hidden = false; }
  });

  for (const b of document.querySelectorAll('[data-close]')) b.addEventListener('click', () => b.closest('dialog').close());
  $('search').addEventListener('input', renderList);
  $('app-filter').addEventListener('change', renderList);

  async function load() {
    const s = await api('/state');
    if (s.suiteMark) $('suite-mark').textContent = s.suiteMark;
    if (!s.signedIn) {
      $('blocked-text').textContent = 'Sign in first, then come back to this page from your list of apps.';
      return show('blocked');
    }
    csrf = s.signedIn.csrf;
    $('who').textContent = s.signedIn.displayName || s.signedIn.email;
    if (s.signedIn.mustChangePassword || !s.signedIn.setupAdmin) {
      $('blocked-text').textContent = s.signedIn.mustChangePassword
        ? 'Choose your own password first.'
        : "Your login can't change people's access. Ask whoever looks after logins for your firm.";
      $('blocked-link').textContent = 'Back to your apps';
      return show('blocked');
    }
    state = await api('/setup');
    $('app-filter').replaceChildren(h('option', {value: ''}, 'Every app'), ...state.apps.map(a => h('option', {value: a.id}, a.name)));
    renderList();
    show('list');
  }
  load().catch(e => { $('loading').querySelector('p').textContent = e.message; });
})();
