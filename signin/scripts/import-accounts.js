'use strict';
// Copies an app's existing logins into the shared sign-in, keeping each person's password.
//   DATABASE_URL=<sign-in db, owner role> node scripts/import-accounts.js timesheets <timesheet db url>
//   DATABASE_URL=<sign-in db, owner role> node scripts/import-accounts.js quoting <quoting db url>
// All the apps store passwords as scrypt:salt:hash with the same settings, so the hash is copied as is.
// Someone already in the sign-in (from another app) keeps that password; only their access is added.
// Safe to run more than once.
const {Pool} = require('pg');

const SOURCES = {
  timesheets: `SELECT a.email, a.password_hash, a.must_change_password, a.active,
      coalesce(nullif(btrim(concat_ws(' ', w.first_name, w.last_name)), ''), '') AS display_name,
      m.client_id::text AS tenant_id, c.name AS tenant_name, m.role
    FROM timesheet.accounts a
    JOIN timesheet.memberships m ON m.account_id = a.id AND m.active
    JOIN timesheet.clients c ON c.id = m.client_id
    LEFT JOIN timesheet.workers w ON w.id = m.worker_id AND w.client_id = m.client_id
    ORDER BY a.email`,
  quoting: `SELECT a.email, a.password_hash, a.must_change_password, a.active, a.display_name,
      m.company_id::text AS tenant_id, c.name AS tenant_name, array_to_string(m.roles, ',') AS role
    FROM quoting.accounts a
    JOIN quoting.memberships m ON m.account_id = a.id AND m.active
    JOIN quoting.companies c ON c.id = m.company_id
    ORDER BY a.email`,
};

async function importAccounts(target, source, app) {
  const sql = SOURCES[app];
  if (!sql) throw new Error(`No import for "${app}". Choose ${Object.keys(SOURCES).join(' or ')}.`);
  const rows = (await source.query(sql)).rows;
  const tally = {created: 0, existing: 0, grants: 0, skippedInactive: 0};
  const db = await target.connect();
  try {
    await db.query('BEGIN');
    for (const r of rows) {
      if (!r.active) { tally.skippedInactive++; continue; }
      const inserted = (await db.query(
        `INSERT INTO identity.accounts (email, display_name, password_hash, must_change_password)
         VALUES ($1, $2, $3, $4) ON CONFLICT (email) DO NOTHING RETURNING id`,
        [r.email, r.display_name || '', r.password_hash, r.must_change_password])).rows[0];
      const id = inserted?.id || (await db.query('SELECT id FROM identity.accounts WHERE email=$1', [r.email])).rows[0].id;
      if (inserted) tally.created++; else tally.existing++;
      await db.query(
        `INSERT INTO identity.app_access (account_id, app, tenant_id, tenant_name, role) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (account_id, app, tenant_id) DO UPDATE SET tenant_name=EXCLUDED.tenant_name, role=EXCLUDED.role`,
        [id, app, r.tenant_id, r.tenant_name || '', r.role || '']);
      tally.grants++;
    }
    await db.query('COMMIT');
  } catch (e) { await db.query('ROLLBACK'); throw e; } finally { db.release(); }
  return tally;
}

if (require.main === module) {
  const [app, sourceUrl] = process.argv.slice(2);
  (async () => {
    if (!app || !sourceUrl || !process.env.DATABASE_URL) throw new Error('Usage: DATABASE_URL=<sign-in db> import-accounts.js timesheets|quoting <source db url>');
    const target = new Pool({connectionString: process.env.DATABASE_URL}), source = new Pool({connectionString: sourceUrl});
    try {
      const t = await importAccounts(target, source, app);
      console.log(`${app}: ${t.created} new logins, ${t.existing} already in the sign-in, ${t.grants} access rows, ${t.skippedInactive} switched-off logins skipped.`);
    } finally { await target.end(); await source.end(); }
  })().catch(e => { console.error(e.message); process.exit(1); });
}

module.exports = {importAccounts, SOURCES};
