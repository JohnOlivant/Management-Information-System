'use strict';
// Creates an account with a temporary password and gives it access to apps.
//   DATABASE_URL=... node scripts/add-account.js someone@firm.co.uk "Their Name" quoting:<company_id>:estimator timesheets:<client_id>:worker
// Each grant is app:tenantId[:role[:tenant name]]. The person must change the password at first sign-in.
const {randomBytes} = require('node:crypto');
const {Pool} = require('pg');
const {pgStore} = require('../src/store-pg');
const {hashPassword} = require('../src/security');

async function main() {
  const [email, displayName, ...grants] = process.argv.slice(2);
  if (!email || !grants.length) throw new Error('Usage: add-account.js email "Name" app:tenantId[:role[:tenant name]] ...');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
  const pool = new Pool({connectionString: process.env.DATABASE_URL});
  try {
    const store = pgStore(pool);
    const temporary = randomBytes(9).toString('base64url');
    const existing = await store.accountByEmail(email.toLowerCase());
    const account = existing || await store.createAccount({email: email.toLowerCase(), displayName: displayName || '',
      passwordHash: await hashPassword(temporary), mustChangePassword: true});
    for (const g of grants) {
      const [app, tenantId, role = '', ...name] = g.split(':');
      if (!app || !tenantId) throw new Error(`Grant "${g}" must be app:tenantId[:role[:tenant name]].`);
      await store.grantAccess({accountId: account.id, app, tenantId, role, tenantName: name.join(':')});
    }
    console.log(existing ? `Updated access for ${email}.` : `Created ${email}. Temporary password: ${temporary}`);
  } finally { await pool.end(); }
}

main().catch(e => { console.error(e.message); process.exit(1); });
