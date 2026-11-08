'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {validateApps, safeReturn} = require('../src/apps');
const base = {id: 'quoting', name: 'Quoting', tagline: 'x', mark: 'Q', accent: '#000000', accentInk: '#ffffff', homeUrl: 'https://quoting.firm.test/'};

test('the shipped apps file lists the four apps', () => {
  const cfg = validateApps(require('../apps.json'));
  assert.deepEqual(cfg.apps.map(a => a.id), ['mis', 'quoting', 'scheduling', 'timesheets']);
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
