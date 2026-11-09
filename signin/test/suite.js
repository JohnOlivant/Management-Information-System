'use strict';
// The behaviour tests, run against the in-memory store (unit) and PostgreSQL (integration).
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {start, seed, KEYS, PASSWORD} = require('./helpers');
const {createSignInClient} = require('../client');

function suite(name, makeStore) {
  async function fresh(options) {
    const store = await makeStore();
    const people = await seed(store);
    const svc = await start(store, options);
    return {store, people, svc};
  }

  test(`${name}: serves the page with strict headers on every screen`, async () => {
    const {svc} = await fresh();
    try {
      for (const p of ['/', '/signout', '/password']) {
        const r = await svc.call(p);
        assert.equal(r.status, 200);
        assert.match(r.body, /<title>Sign in<\/title>/);
        assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/);
      }
      assert.equal((await svc.call('/signin.css')).status, 200);
      assert.equal((await svc.call('/nope')).status, 404);
    } finally { await svc.close(); }
  });

  test(`${name}: shows the asking app's branding and only keeps its own return address`, async () => {
    const {svc} = await fresh();
    try {
      const good = await svc.call('/api/state?app=quoting&return=' + encodeURIComponent('http://localhost:3100/estimates/42'));
      assert.equal(good.body.app.name, 'Quoting');
      assert.equal(good.body.returnTo, 'http://localhost:3100/estimates/42');
      assert.equal(good.body.signedIn, null);
      assert.equal(good.body.allApps.length, 4);
      for (const evil of ['https://evil.example/', 'http://localhost:3000/', '//evil.example', 'javascript:alert(1)', 'http://user:pw@localhost:3100/']) {
        const r = await svc.call('/api/state?app=quoting&return=' + encodeURIComponent(evil));
        assert.equal(r.body.returnTo, null, evil);
      }
      assert.equal((await svc.call('/api/state?app=unknown')).body.app, null);
    } finally { await svc.close(); }
  });

  test(`${name}: refuses wrong passwords with one message whether or not the email exists`, async () => {
    const {svc} = await fresh();
    try {
      const a = await svc.signIn('owner@firm.test', 'wrong password!!');
      const b = await svc.signIn('nobody@firm.test', 'wrong password!!');
      assert.equal(a.status, 401); assert.equal(b.status, 401);
      assert.equal(a.body.error, b.body.error);
      assert.equal((await svc.signIn('', '')).status, 400);
    } finally { await svc.close(); }
  });

  test(`${name}: signs in, sets a shared HttpOnly cookie and sends the person back to the app`, async () => {
    const {svc} = await fresh({cookieDomain: 'firm.test', secure: true});
    try {
      const r = await svc.signIn('OWNER@firm.test ', PASSWORD, {app: 'quoting', return: 'http://localhost:3100/estimates/42'});
      assert.equal(r.status, 200);
      assert.equal(r.body.next, 'http://localhost:3100/estimates/42');
      const set = r.headers.get('set-cookie');
      for (const part of ['HttpOnly', 'SameSite=Lax', 'Domain=firm.test', 'Secure', 'Max-Age=28800']) assert.ok(set.includes(part), part);
      const state = await svc.call('/api/state?app=quoting');
      assert.equal(state.body.signedIn.email, 'owner@firm.test');
      assert.equal(state.body.signedIn.canOpenApp, true);
      assert.deepEqual(state.body.signedIn.apps.map(a => a.id), ['quoting', 'timesheets']);
      // A bad return address falls back to the app's home page.
      const again = await svc.signIn('owner@firm.test', PASSWORD, {app: 'quoting', return: 'https://evil.example/'});
      assert.equal(again.body.next, 'http://localhost:3100/');
    } finally { await svc.close(); }
  });

  test(`${name}: an account without access to the app stays on the sign-in page`, async () => {
    const {svc} = await fresh();
    try {
      const r = await svc.signIn('crew@firm.test', PASSWORD, {app: 'quoting'});
      assert.equal(r.status, 200);
      assert.equal(r.body.next, null);
      const state = await svc.call('/api/state?app=quoting');
      assert.equal(state.body.signedIn.canOpenApp, false);
      assert.deepEqual(state.body.signedIn.apps.map(a => a.id), ['timesheets']);
    } finally { await svc.close(); }
  });

  test(`${name}: refuses browser posts from another site`, async () => {
    const {svc} = await fresh();
    try {
      const r = await svc.call('/api/login', {body: {email: 'owner@firm.test', password: PASSWORD}, headers: {Origin: 'https://evil.example'}});
      assert.equal(r.status, 403);
      assert.equal(svc.jar.cookie, '');
    } finally { await svc.close(); }
  });

  test(`${name}: a temporary password must be changed before any app opens`, async () => {
    const {svc} = await fresh();
    try {
      const r = await svc.signIn('new@firm.test', PASSWORD, {app: 'quoting'});
      assert.equal(r.body.next, null);
      assert.equal((await svc.call('/api/state')).body.signedIn.mustChangePassword, true);
      assert.equal((await svc.call('/api/password', {body: {currentPassword: 'nope', newPassword: 'a much longer password'}})).status, 400);
      assert.equal((await svc.call('/api/password', {body: {currentPassword: PASSWORD, newPassword: 'short'}})).status, 400);
      const ok = await svc.call('/api/password', {body: {currentPassword: PASSWORD, newPassword: 'a much longer password', app: 'quoting'}});
      assert.equal(ok.status, 200);
      assert.equal(ok.body.next, 'http://localhost:3100/');
      assert.equal((await svc.call('/api/state')).body.signedIn.mustChangePassword, false);
    } finally { await svc.close(); }
  });

  test(`${name}: changing a password signs the account out on other devices`, async () => {
    const {store, svc} = await fresh();
    const other = await start(store);
    try {
      await svc.signIn('owner@firm.test'); await other.signIn('owner@firm.test');
      assert.ok((await other.call('/api/state')).body.signedIn);
      assert.equal((await svc.call('/api/password', {body: {currentPassword: PASSWORD, newPassword: 'another long password'}})).status, 200);
      assert.equal((await other.call('/api/state')).body.signedIn, null);
      assert.ok((await svc.call('/api/state')).body.signedIn);
    } finally { await svc.close(); await other.close(); }
  });

  test(`${name}: signing out needs the CSRF token and ends the session`, async () => {
    const {svc} = await fresh();
    try {
      await svc.signIn('owner@firm.test');
      const csrf = svc.jar.csrf; svc.jar.csrf = '';
      assert.equal((await svc.call('/api/logout', {body: {}})).status, 403);
      svc.jar.csrf = csrf;
      const r = await svc.call('/api/logout', {body: {}});
      assert.equal(r.status, 200);
      assert.match(r.headers.get('set-cookie'), /Max-Age=0/);
      assert.equal(svc.jar.cookie, '');
    } finally { await svc.close(); }
  });

  test(`${name}: locks an account after five wrong passwords`, async () => {
    const {svc} = await fresh();
    try {
      for (let i = 0; i < 5; i++) assert.equal((await svc.signIn('owner@firm.test', 'wrong password ' + i)).status, 401);
      assert.equal((await svc.signIn('owner@firm.test')).status, 429);
      assert.equal((await svc.signIn('crew@firm.test')).status, 200, 'other accounts on the same address still work');
    } finally { await svc.close(); }
  });

  test(`${name}: apps check sessions with their key and see only their own access`, async () => {
    const {svc} = await fresh();
    try {
      await svc.signIn('owner@firm.test');
      const token = svc.token();
      const verify = (key, t = token) => svc.call('/api/service/verify', {body: {token: t}, headers: {Authorization: 'Bearer ' + key}, bare: true});
      assert.equal((await verify('wrong-key')).status, 401);
      const q = await verify(KEYS.quoting);
      assert.equal(q.status, 200);
      assert.equal(q.body.session.email, 'owner@firm.test');
      assert.deepEqual(q.body.session.access, [{tenantId: 'company-1', tenantName: 'Firm One', role: 'approver'}]);
      assert.equal(q.body.session.csrfToken, svc.jar.csrf);
      const t = await verify(KEYS.timesheets);
      assert.deepEqual(t.body.session.access, [{tenantId: 'client-1', tenantName: 'Firm One', role: 'payroll'}]);
      assert.equal((await verify(KEYS.quoting, 'f'.repeat(64))).body.session, null);
      assert.equal((await verify(KEYS.quoting, 'not-a-token')).body.session, null);
      const end = await svc.call('/api/service/end-session', {body: {token}, headers: {Authorization: 'Bearer ' + KEYS.quoting}, bare: true});
      assert.equal(end.status, 200);
      assert.equal((await verify(KEYS.quoting)).body.session, null);
    } finally { await svc.close(); }
  });

  test(`${name}: an app's user admin can add, change and remove access for its own firm`, async () => {
    const {svc} = await fresh();
    try {
      const svcCall = (path, body, key = KEYS.timesheets) => svc.call(path, {body, headers: {Authorization: 'Bearer ' + key}, bare: true});
      // New login: needs a temporary password, must change it at first sign-in.
      assert.equal((await svcCall('/api/service/provision', {email: 'jo@firm.test', tenantId: 'client-1', role: 'worker'})).status, 400);
      const made = await svcCall('/api/service/provision', {email: 'Jo@firm.test', displayName: 'Jo', tenantId: 'client-1', tenantName: 'Firm One', role: 'worker', temporaryPassword: 'temporary password 1'});
      assert.equal(made.status, 200); assert.equal(made.body.created, true);
      let r = await svc.signIn('jo@firm.test', 'temporary password 1', {app: 'timesheets'});
      assert.equal(r.body.next, null, 'temporary password must be changed first');
      // Existing login from another app: access is added, the password is left alone.
      const again = await svcCall('/api/service/provision', {email: 'owner@firm.test', tenantId: 'client-1', role: 'supervisor', temporaryPassword: 'would overwrite!!'});
      assert.equal(again.body.created, false);
      assert.equal((await svc.signIn('owner@firm.test', PASSWORD)).status, 200);
      // Role change, and the quoting key can't see or touch timesheet access.
      await svcCall('/api/service/provision', {email: 'jo@firm.test', tenantId: 'client-1', role: 'supervisor'});
      await svcCall('/api/service/provision', {email: 'jo@firm.test', tenantId: 'company-9', role: 'estimator'}, KEYS.quoting);
      svc.jar.cookie = ''; svc.jar.csrf = '';
      await svc.signIn('jo@firm.test', 'temporary password 1');
      const v = await svcCall('/api/service/verify', {token: svc.token()});
      assert.deepEqual(v.body.session.access.map(a => a.role), ['supervisor']);
      // Reset: only for someone with access at this firm; ends their sessions.
      assert.equal((await svcCall('/api/service/reset-password', {email: 'jo@firm.test', tenantId: 'client-2', temporaryPassword: 'another temp pass'})).status, 404);
      assert.equal((await svcCall('/api/service/reset-password', {email: 'jo@firm.test', tenantId: 'client-1', temporaryPassword: 'another temp pass'})).status, 200);
      assert.equal((await svcCall('/api/service/verify', {token: svc.token()})).body.session, null);
      assert.equal((await svc.signIn('jo@firm.test', 'temporary password 1')).status, 401);
      assert.equal((await svc.signIn('jo@firm.test', 'another temp pass')).status, 200);
      // Remove: access goes and the person is signed out.
      await svcCall('/api/service/provision', {email: 'jo@firm.test', tenantId: 'client-1', active: false});
      const after = await svcCall('/api/service/verify', {token: svc.token()});
      assert.equal(after.body.session, null);
      await svc.signIn('jo@firm.test', 'another temp pass');
      assert.deepEqual((await svcCall('/api/service/verify', {token: svc.token()})).body.session.access, []);
    } finally { await svc.close(); }
  });

  test(`${name}: only a setup administrator can open the setup page`, async () => {
    const {svc} = await fresh();
    try {
      assert.equal((await svc.call('/setup')).status, 200);
      assert.equal((await svc.call('/api/setup')).status, 401);
      await svc.signIn('crew@firm.test');
      assert.equal((await svc.call('/api/state')).body.signedIn.setupAdmin, false);
      assert.equal((await svc.call('/api/setup')).status, 403);
      assert.equal((await svc.call('/api/setup/person', {body: {email: 'x@firm.test', temporaryPassword: 'temporary password 1'}})).status, 403);
      svc.jar.cookie = ''; svc.jar.csrf = '';
      await svc.signIn('new@firm.test');
      assert.equal((await svc.call('/api/setup')).status, 403, 'not before a temporary password is changed');
      svc.jar.cookie = ''; svc.jar.csrf = '';
      await svc.signIn('owner@firm.test');
      assert.equal((await svc.call('/api/state')).body.signedIn.setupAdmin, true);
      const r = await svc.call('/api/setup');
      assert.equal(r.status, 200);
      assert.deepEqual(r.body.people.map(p => p.email), ['crew@firm.test', 'new@firm.test', 'owner@firm.test']);
      const ts = r.body.apps.find(a => a.id === 'timesheets');
      assert.deepEqual(ts.roles.map(x => x.id), ['worker', 'supervisor', 'payroll', 'admin']);
      assert.deepEqual(ts.firms, [{tenantId: 'client-1', tenantName: 'Firm One'}]);
      assert.equal(r.body.apps.find(a => a.id === 'quoting').multipleRoles, true);
      assert.equal(r.body.people.find(p => p.email === 'owner@firm.test').access.length, 2);
      // Writes need the CSRF token, like every other change.
      const csrf = svc.jar.csrf; svc.jar.csrf = '';
      assert.equal((await svc.call('/api/setup/person', {body: {email: 'x@firm.test', temporaryPassword: 'temporary password 1'}})).status, 403);
      svc.jar.csrf = csrf;
    } finally { await svc.close(); }
  });

  test(`${name}: the setup page adds people and sets their apps, firms and roles`, async () => {
    const {svc} = await fresh();
    try {
      await svc.signIn('owner@firm.test');
      const post = (path, body) => svc.call('/api/setup/' + path, {body});
      assert.equal((await post('person', {email: 'bad', temporaryPassword: 'temporary password 1'})).status, 400);
      assert.equal((await post('person', {email: 'Crew@firm.test', temporaryPassword: 'temporary password 1'})).status, 409);
      assert.equal((await post('person', {email: 'pat@firm.test', temporaryPassword: 'short'})).status, 400);
      const made = await post('person', {email: 'Pat@Firm.test', displayName: 'Pat Admin', temporaryPassword: 'temporary password 1'});
      assert.equal(made.status, 200);
      const pat = made.body.people.find(p => p.email === 'pat@firm.test');
      assert.deepEqual([pat.displayName, pat.active, pat.setupAdmin, pat.mustChangePassword, pat.access], ['Pat Admin', true, false, true, []]);

      // Roles are checked against each app's list; Quoting takes several, kept in its own order.
      assert.equal((await post('access', {accountId: pat.id, app: 'timesheets', tenantId: 'client-1', role: 'boss'})).status, 400);
      assert.equal((await post('access', {accountId: pat.id, app: 'timesheets', tenantId: 'client-1', role: ['admin', 'payroll']})).status, 400);
      assert.equal((await post('access', {accountId: pat.id, app: 'timesheets', tenantId: 'client-1', role: ''})).status, 400);
      assert.equal((await post('access', {accountId: pat.id, app: 'nope', tenantId: 'client-1', role: 'admin'})).status, 400);
      assert.equal((await post('access', {accountId: pat.id, app: 'timesheets', tenantId: 'client-1', tenantName: 'Firm One', role: 'admin'})).status, 200);
      const allQuoting = ['admin', 'operations', 'accounts', 'rate_admin', 'approver', 'estimator'];
      const q = await post('access', {accountId: pat.id, app: 'quoting', tenantId: 'company-1', tenantName: 'Firm One', role: allQuoting});
      assert.equal(q.status, 200);
      const role = q.body.people.find(p => p.id === pat.id).access.find(x => x.app === 'quoting').role;
      assert.equal(role, 'estimator,approver,rate_admin,accounts,operations,admin');
      assert.ok(role.length > 40, 'a full Quoting role list is longer than the old 40-character limit');

      // The apps see what the setup page set.
      svc.jar.cookie = ''; svc.jar.csrf = '';
      await svc.signIn('pat@firm.test', 'temporary password 1');
      const patToken = svc.token();
      const verify = key => svc.call('/api/service/verify', {body: {token: patToken}, headers: {Authorization: 'Bearer ' + key}, bare: true});
      assert.deepEqual((await verify(KEYS.timesheets)).body.session.access, [{tenantId: 'client-1', tenantName: 'Firm One', role: 'admin'}]);
      assert.equal((await verify(KEYS.quoting)).body.session.access[0].role, role);

      // Changing a role keeps them signed in; removing access signs them out everywhere.
      svc.jar.cookie = ''; svc.jar.csrf = '';
      await svc.signIn('owner@firm.test');
      await post('access', {accountId: pat.id, app: 'timesheets', tenantId: 'client-1', tenantName: 'Firm One', role: 'payroll'});
      assert.equal((await verify(KEYS.timesheets)).body.session.access[0].role, 'payroll');
      const removed = await post('access', {accountId: pat.id, app: 'quoting', tenantId: 'company-1', remove: true});
      assert.deepEqual(removed.body.people.find(p => p.id === pat.id).access.map(x => x.app), ['timesheets']);
      assert.equal((await verify(KEYS.timesheets)).body.session, null);

      // A new firm can be typed in, and then appears in that app's firm list.
      const added = await post('access', {accountId: pat.id, app: 'mis', tenantId: 'firm-9', tenantName: 'Firm Nine', role: 'viewer'});
      assert.deepEqual(added.body.apps.find(a => a.id === 'mis').firms, [{tenantId: 'firm-9', tenantName: 'Firm Nine'}]);

      // Make them a setup administrator, then switch their login off: they're signed out and can't sign in.
      const promoted = await post('person', {id: pat.id, displayName: 'Pat A.', active: true, setupAdmin: true});
      assert.deepEqual(['displayName', 'setupAdmin'].map(k => promoted.body.people.find(p => p.id === pat.id)[k]), ['Pat A.', true]);
      const off = await post('person', {id: pat.id, displayName: 'Pat A.', active: false, setupAdmin: false});
      assert.equal(off.body.people.find(p => p.id === pat.id).active, false);
      assert.equal((await svc.call('/api/login', {body: {email: 'pat@firm.test', password: 'temporary password 1'}, bare: true})).status, 401);
      await post('person', {id: pat.id, displayName: 'Pat A.', active: true, setupAdmin: false});

      // Reset password: a new temporary password, which must be changed.
      assert.equal((await post('reset-password', {accountId: pat.id, temporaryPassword: 'short'})).status, 400);
      assert.equal((await post('reset-password', {accountId: pat.id, temporaryPassword: 'new temporary pass'})).status, 200);
      const back = await svc.call('/api/login', {body: {email: 'pat@firm.test', password: 'new temporary pass'}, bare: true});
      assert.equal(back.status, 200);

      // Nobody can lock themselves out.
      const me = (await svc.call('/api/setup')).body.me;
      assert.equal((await post('person', {id: me, displayName: 'Owner', active: false, setupAdmin: true})).status, 400);
      assert.equal((await post('person', {id: me, displayName: 'Owner', active: true, setupAdmin: false})).status, 400);
      assert.equal((await post('reset-password', {accountId: me, temporaryPassword: 'new temporary pass'})).status, 400);
      assert.equal((await post('person', {id: me, displayName: 'The Owner', active: true, setupAdmin: true})).status, 200);
    } finally { await svc.close(); }
  });

  test(`${name}: the app client authenticates, caches and builds sign-in links`, async () => {
    const {svc} = await fresh();
    try {
      let clock = 0, calls = 0;
      const counting = (...a) => { calls++; return fetch(...a); };
      const client = createSignInClient({signinUrl: svc.base, appId: 'quoting', serviceKey: KEYS.quoting, fetch: counting, now: () => clock});
      assert.equal(await client.authenticate({headers: {}}), null);
      await svc.signIn('owner@firm.test');
      const req = {headers: {cookie: 'other=1; ' + svc.jar.cookie}};
      const s = await client.authenticate(req);
      assert.equal(s.email, 'owner@firm.test');
      await client.authenticate(req);
      assert.equal(calls, 1, 'second check is cached');
      clock += 31000;
      await client.authenticate(req);
      assert.equal(calls, 2, 'cache expires');
      await client.endSession(req);
      assert.equal(await client.authenticate(req), null);

      await svc.signIn('crew@firm.test');
      assert.equal(await client.authenticate({headers: {cookie: svc.jar.cookie}}), null, 'no quoting access means no session for quoting');

      const url = new URL(client.signInUrl('http://localhost:3100/estimates/42'));
      assert.equal(url.pathname, '/');
      assert.equal(url.searchParams.get('app'), 'quoting');
      assert.equal(url.searchParams.get('return'), 'http://localhost:3100/estimates/42');
      assert.equal(new URL(client.signOutUrl()).pathname, '/signout');
    } finally { await svc.close(); }
  });
}

module.exports = {suite};
