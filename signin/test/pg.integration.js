'use strict';
// Runs the same behaviour tests against PostgreSQL. Needs TEST_DATABASE_URL pointing at a throwaway
// database; each test gets a freshly created `identity` schema from db/001-identity.sql.
const fs = require('node:fs');
const path = require('node:path');
const {after} = require('node:test');
const {Pool} = require('pg');
const {suite} = require('./suite');
const {pgStore} = require('../src/store-pg');

const url = process.env.TEST_DATABASE_URL;
if (!url) { console.log('TEST_DATABASE_URL not set; skipping PostgreSQL tests.'); process.exit(0); }
const migration = fs.readFileSync(path.join(__dirname, '..', 'db', '001-identity.sql'), 'utf8');
// The service itself runs as the narrow rule29_signin_app role, so the grants are tested too;
// accounts are created as the owner, as scripts/add-account.js would be.
const pool = new Pool({connectionString: url, max: 5});
const appUrl = new URL(url); appUrl.username = 'rule29_signin_app'; appUrl.password = process.env.TEST_APP_PASSWORD || '';
const appPool = new Pool({connectionString: appUrl.href, max: 5});
after(() => Promise.all([pool.end(), appPool.end()]));

suite('postgres', async () => {
  await pool.query('DROP SCHEMA IF EXISTS identity CASCADE');
  await pool.query(migration);
  const owner = pgStore(pool), app = pgStore(appPool);
  return {...app, createAccount: owner.createAccount, grantAccess: owner.grantAccess};
});
