'use strict';
// Runs the same behaviour tests against PostgreSQL. Needs TEST_DATABASE_URL pointing at a throwaway
// database; each test gets a freshly created `identity` schema from the files in db/.
const fs = require('node:fs');
const path = require('node:path');
const {after} = require('node:test');
const {Pool} = require('pg');
const {suite} = require('./suite');
const {pgStore} = require('../src/store-pg');

const url = process.env.TEST_DATABASE_URL;
if (!url) { console.log('TEST_DATABASE_URL not set; skipping PostgreSQL tests.'); process.exit(0); }
const dbDir = path.join(__dirname, '..', 'db');
const migrations = fs.readdirSync(dbDir).filter(f => f.endsWith('.sql')).sort().map(f => fs.readFileSync(path.join(dbDir, f), 'utf8'));
// The service itself runs as the narrow rule29_signin_app role, so the grants are tested too;
// accounts are created as the owner, as scripts/add-account.js would be.
const pool = new Pool({connectionString: url, max: 5});
const appUrl = new URL(url); appUrl.username = 'rule29_signin_app'; appUrl.password = process.env.TEST_APP_PASSWORD || '';
const appPool = new Pool({connectionString: appUrl.href, max: 5});
after(() => Promise.all([pool.end(), appPool.end()]));

suite('postgres', async () => {
  await pool.query('DROP SCHEMA IF EXISTS identity CASCADE');
  for (const m of migrations) await pool.query(m);
  const owner = pgStore(pool), app = pgStore(appPool);
  // Accounts are made as the owner (as the scripts do); setupAdmin is set as the service would.
  return {...app, grantAccess: owner.grantAccess, createAccount: async a => {
    const made = await owner.createAccount(a);
    if (a.setupAdmin) await owner.updateAccount({id: made.id, displayName: made.display_name, active: true, setupAdmin: true});
    return {...made, setup_admin: !!a.setupAdmin};
  }};
});
