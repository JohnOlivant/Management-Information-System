'use strict';
const {createApp} = require('../src/app');
const {validateApps} = require('../src/apps');
const {hashPassword} = require('../src/security');
const config = validateApps(require('../apps.json'));

const KEYS = {quoting: 'q'.repeat(40), timesheets: 't'.repeat(40)};
const PASSWORD = 'correct horse battery';

/** Starts the service on a free port with the given store. Returns helpers bound to it. */
async function start(store, options = {}) {
  let base;
  const server = createApp({store, config, serviceKeys: KEYS, origin: 'http://signin.test', ...options});
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const jar = {cookie: '', csrf: ''};
  async function call(path, {body, headers = {}, method, bare = false} = {}) {
    const res = await fetch(base + path, {
      method: method || (body === undefined ? 'GET' : 'POST'),
      headers: {...(body !== undefined ? {'Content-Type': 'application/json', Origin: 'http://signin.test'} : {}),
        ...(jar.cookie && !bare ? {Cookie: jar.cookie} : {}), ...(jar.csrf && !bare ? {'X-CSRF-Token': jar.csrf} : {}), ...headers},
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set && !bare) jar.cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
    const type = res.headers.get('content-type') || '';
    return {status: res.status, headers: res.headers, body: type.includes('json') ? await res.json() : await res.text()};
  }
  async function signIn(email, password = PASSWORD, extra = {}) {
    const r = await call('/api/login', {body: {email, password, ...extra}});
    if (r.status === 200) jar.csrf = (await call('/api/state')).body.signedIn.csrf;
    return r;
  }
  const token = () => jar.cookie.split('=')[1];
  return {base, call, signIn, jar, token, close: () => new Promise(r => server.close(r))};
}

async function seed(store) {
  const hash = await hashPassword(PASSWORD);
  const owner = await store.createAccount({email: 'owner@firm.test', displayName: 'Owner', passwordHash: hash, mustChangePassword: false, setupAdmin: true});
  await store.grantAccess({accountId: owner.id, app: 'quoting', tenantId: 'company-1', tenantName: 'Firm One', role: 'approver'});
  await store.grantAccess({accountId: owner.id, app: 'timesheets', tenantId: 'client-1', tenantName: 'Firm One', role: 'payroll'});
  const crew = await store.createAccount({email: 'crew@firm.test', displayName: 'Crew', passwordHash: hash, mustChangePassword: false});
  await store.grantAccess({accountId: crew.id, app: 'timesheets', tenantId: 'client-1', tenantName: 'Firm One', role: 'worker'});
  const fresh = await store.createAccount({email: 'new@firm.test', displayName: 'New', passwordHash: hash, mustChangePassword: true});
  await store.grantAccess({accountId: fresh.id, app: 'quoting', tenantId: 'company-1', tenantName: 'Firm One', role: 'estimator'});
  return {owner, crew, fresh};
}

module.exports = {start, seed, config, KEYS, PASSWORD};
