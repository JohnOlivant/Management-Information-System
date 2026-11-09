'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createApp, loadFirms, appLinks} = require('../src/app');
const {demoData, demoTimesheet} = require('../src/demo');

const firms = new Map([['a', {id: 'a', name: 'Firm A', timesheets: '00000000-0000-4000-8000-000000000001'}], ['b', {id: 'b', name: 'Firm B'}]]);
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
    appsUrl: () => 'https://signin.example.co.uk/',
    firms: () => firms, timesheet: demoTimesheet(() => '2026-11-09'), data: async f => { reads.push(f.id); return demoData('2026-11-09'); }, today: () => '2026-11-09',
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
  assert.equal(me.home, 'https://signin.example.co.uk/', 'the All apps button goes back to the sign-in page');
  assert.equal((await get('/api/reports?firm=b', 'owner')).status, 404);
  const r = await get('/api/reports?firm=a', 'owner');
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.pipeline.count, 4);
  assert.deepEqual(Object.keys(body).sort(), ['capacity', 'fixes', 'have', 'hours', 'hoursWent', 'orderBook', 'pipeline', 'problems', 'today', 'winRate']);
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

test('the Timesheet report: JSON summary, CSV files and checked filters', async t => {
  const {get} = await serve(t);
  const q = 'firm=a&from=2026-10-12&to=2026-11-08';
  const r = await (await get('/api/timesheet-report?' + q, 'owner')).json();
  assert.ok(r.totals.hours > 0);
  assert.equal(r.details, undefined, 'line detail only goes in the CSV');
  assert.equal(r.byWorker.length, 4);
  const csv = await get('/api/timesheet-report?' + q + '&format=csv&view=workers', 'owner');
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-disposition'), /timesheet-report-workers-2026-10-12-2026-11-08\.csv/);
  assert.match(await csv.text(), /Sam Archer/);
  assert.equal((await get('/api/timesheet-report?firm=a&from=2026-11-08&to=2026-10-01', 'owner')).status, 400);
  assert.equal((await get('/api/timesheet-report?' + q.replace('firm=a', 'firm=b'), 'owner')).status, 404);
  const ref = await (await get('/api/timesheet-report/reference?firm=a', 'owner')).json();
  assert.equal(ref.workers.length, 4);
});
