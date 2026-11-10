'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {validateApps, safeReturn, normaliseRole} = require('../src/apps');
const base = {id: 'quoting', name: 'Quoting', tagline: 'x', mark: 'Q', accent: '#000000', accentInk: '#ffffff', homeUrl: 'https://quoting.firm.test/'};

test('the shipped apps file lists the five apps', () => {
  const cfg = validateApps(require('../apps.json'));
  assert.deepEqual(cfg.apps.map(a => a.id), ['mis', 'quoting', 'scheduling', 'timesheets', 'finance']);
});

test('apps must use https away from this computer, and ids must be unique', () => {
  assert.throws(() => validateApps({apps: [{...base, homeUrl: 'http://quoting.firm.test/'}]}), /https/);
  assert.throws(() => validateApps({apps: [base, base]}), /twice/);
  assert.throws(() => validateApps({apps: [{...base, accent: 'red'}]}), /colours/);
  assert.throws(() => validateApps({apps: [{...base, origins: ['https://a.test/path']}]}), /scheme, host and port/);
  assert.doesNotThrow(() => validateApps({apps: [{...base, homeUrl: 'http://localhost:3100/'}]}));
});

test('return addresses must belong to the app', () => {
  const app = validateApps({apps: [{...base, origins: ['https://quotes.firm.test']}]}).apps[0];
  assert.equal(safeReturn(app, 'https://quoting.firm.test/a?b=1'), 'https://quoting.firm.test/a?b=1');
  assert.equal(safeReturn(app, 'https://quotes.firm.test/x'), 'https://quotes.firm.test/x');
  assert.equal(safeReturn(app, 'https://quoting.firm.test.evil.example/'), null);
  assert.equal(safeReturn(app, '/relative'), null);
  assert.equal(safeReturn(null, 'https://quoting.firm.test/'), null);
});

test('each app gets its roles from the apps file, or the built-in list when the file has none', () => {
  const cfg = validateApps(require('../apps.json'));
  const roles = Object.fromEntries(cfg.apps.map(a => [a.id, a.roles.map(r => r.id).join(' ')]));
  assert.deepEqual(roles, {mis: 'admin viewer', quoting: 'estimator approver rate_admin accounts operations admin',
    scheduling: 'scheduler admin', timesheets: 'worker supervisor payroll admin', finance: 'director office advisor viewer'});
  assert.deepEqual(cfg.apps.filter(a => a.multipleRoles).map(a => a.id), ['quoting']);
  const own = validateApps({apps: [{...base, roles: [{id: 'sales', name: 'Sales'}], multipleRoles: false}]}).apps[0];
  assert.deepEqual([own.roles, own.multipleRoles], [[{id: 'sales', name: 'Sales'}], false]);
  assert.throws(() => validateApps({apps: [{...base, roles: [{id: 'Bad Id', name: 'x'}]}]}), /role/);
});

test('roles chosen on the setup page are checked and stored in the app\'s order', () => {
  const [, quoting, , timesheets] = validateApps(require('../apps.json')).apps;
  assert.equal(normaliseRole(timesheets, 'admin'), 'admin');
  assert.match(normaliseRole(timesheets, 'admin,payroll').error, /one role/);
  assert.match(normaliseRole(timesheets, 'owner').error, /no role "owner"/);
  assert.match(normaliseRole(timesheets, '').error, /Choose a role/);
  assert.equal(normaliseRole(quoting, ['admin', 'estimator', 'admin']), 'estimator,admin');
  assert.equal(normaliseRole(quoting, 'approver, estimator'), 'estimator,approver');
});
