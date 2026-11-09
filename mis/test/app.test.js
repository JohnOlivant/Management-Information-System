'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createApp, loadFirms, appLinks} = require('../src/app');
const {demoData} = require('../src/demo');

const firms = new Map([['a', {id: 'a', name: 'Firm A'}], ['b', {id: 'b', name: 'Firm B'}]]);
const sessions = {
  owner: {email: 'o@a.co', displayName: 'Owner', access: [{tenantId: 'a'}, {tenantId: 'gone'}]},
  fresh: {email: 'n@a.co', displayName: 'New', mustChangePassword: true, access: [{tenantId: 'a'}]},
};

async function serve(t) {
  const reads = [];
  const app = createApp({
    origin: 'https://management.example.co.uk',
    auth: async req => sessions[req.headers['x-test-user']] || null,
    signInUrl: r => `https://signin.example.co.uk/?app=mis&return=${encodeURIComponent(r)}`,
    signOutUrl: () => 'https://signin.example.co.uk/signout?app=mis', passwordUrl: () => 'https://signin.example.co.uk/password?app=mis',
    firms: () => firms, data: async f => { reads.push(f.id); return demoData('2026-11-09'); }, today: () => '2026-11-09',
    log: {error() {}},
  });
  const server = http.createServer(app).listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = (p, user) => fetch(base + p, {headers: user ? {'x-test-user': user} : {}, redirect: 'manual'});
  return {get, reads};
}

test('not signed in: the page goes to the sign-in, the API says 401', async t => {
  const {get} = await serve(t);
  const page = await get('/');
  assert.equal(page.status, 302);
  assert.match(page.headers.get('location'), /^https:\/\/signin\.example\.co\.uk\/\?app=mis&return=https%3A%2F%2Fmanagement\.example\.co\.uk%2F$/);
  const api = await get('/api/reports?firm=a');
  assert.equal(api.status, 401);
  assert.match((await api.json()).signIn, /app=mis/);
});

test('a temporary password is changed first', async t => {
  const {get} = await serve(t);
  const page = await get('/', 'fresh');
  assert.equal(page.status, 302);
  assert.match(page.headers.get('location'), /\/password\?app=mis/);
});

test('someone sees only the firms their MIS access names', async t => {
  const {get, reads} = await serve(t);
  const me = await (await get('/api/me', 'owner')).json();
  assert.deepEqual(me.firms, [{id: 'a', name: 'Firm A'}]);
  assert.equal((await get('/api/reports?firm=b', 'owner')).status, 404);
  const r = await get('/api/reports?firm=a', 'owner');
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.pipeline.count, 4);
  assert.deepEqual(Object.keys(body).sort(), ['fixes', 'have', 'hours', 'orderBook', 'pipeline', 'problems', 'today']);
  await get('/api/reports?firm=a', 'owner');
  assert.deepEqual(reads, ['a'], 'answers are cached for a minute');
});

test('the page is served with a strict content security policy, and only GET is allowed', async t => {
  const {get} = await serve(t);
  const page = await get('/', 'owner');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
  assert.match(await page.text(), /Management Information/);
  assert.equal((await get('/app.js')).status, 200);
});

test('firms.json is checked when read', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mis-'));
  const file = path.join(dir, 'firms.json');
  fs.writeFileSync(file, JSON.stringify([{id: 'ss', name: 'S&S', quoting: '11111111-1111-4111-8111-111111111111'}]));
  assert.equal(loadFirms(file).get('ss').name, 'S&S');
  fs.writeFileSync(file, JSON.stringify([{id: 'ss', name: 'S&S', quoting: 'not-an-id'}]));
  assert.throws(() => loadFirms(file), /quoting must be/);
});

test('the top bar links to the other apps under the same domain', () => {
  assert.deepEqual(appLinks('https://management.rule29.co.uk').map(a => [a.name, a.url]), [
    ['Quoting', 'https://quoting.rule29.co.uk/'], ['Scheduling', 'https://scheduling.rule29.co.uk/'], ['Timesheets', 'https://timesheets.rule29.co.uk/']]);
  assert.equal(appLinks('https://management.rule29.co.uk', 'quoting=https://q.example.com/').find(a => a.id === 'quoting').url, 'https://q.example.com/');
});
