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
