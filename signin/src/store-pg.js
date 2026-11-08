'use strict';
// PostgreSQL storage for the sign-in service (schema `identity`, db/001-identity.sql).

function pgStore(pool) {
  const one = async (sql, params) => (await pool.query(sql, params)).rows[0] || null;
  async function transaction(fn) {
    const db = await pool.connect();
    try { await db.query('BEGIN'); const r = await fn(db); await db.query('COMMIT'); return r; }
    catch (e) { await db.query('ROLLBACK'); throw e; } finally { db.release(); }
  }
  return {
    accountByEmail: email => one('SELECT * FROM identity.accounts WHERE email=$1 AND active', [email]),
    accountById: id => one('SELECT * FROM identity.accounts WHERE id=$1 AND active', [id]),
    access: async accountId => (await pool.query(
      'SELECT app, tenant_id, tenant_name, role FROM identity.app_access WHERE account_id=$1 ORDER BY app, tenant_name, tenant_id',
      [accountId])).rows,

    /** Counts one attempt against every key; says 'blocked' (and counts nothing) when any key is at its limit. */
    beginAttempt: (limits, windowMinutes) => transaction(async db => {
      for (const {key} of [...limits].sort((a, b) => a.key.localeCompare(b.key))) {
        await db.query('INSERT INTO identity.login_limits (identity_hash) VALUES ($1) ON CONFLICT DO NOTHING', [key]);
        await db.query(`UPDATE identity.login_limits SET attempts=0, window_start=now()
          WHERE identity_hash=$1 AND window_start < now() - make_interval(mins => $2)`, [key, windowMinutes]);
      }
      const rows = (await db.query('SELECT identity_hash, attempts FROM identity.login_limits WHERE identity_hash = ANY($1) FOR UPDATE',
        [limits.map(l => l.key)])).rows;
      if (limits.some(l => (rows.find(r => r.identity_hash === l.key)?.attempts ?? 0) >= l.max)) return 'blocked';
      await db.query('UPDATE identity.login_limits SET attempts=attempts+1 WHERE identity_hash = ANY($1)', [limits.map(l => l.key)]);
      return 'ok';
    }),
    /** A good password clears the account's count and takes its attempt back off the address (shared office IPs). */
    loginSucceeded: async (accountKey, ipKey) => {
      await pool.query('UPDATE identity.login_limits SET attempts=0 WHERE identity_hash=$1', [accountKey]);
      await pool.query('UPDATE identity.login_limits SET attempts=greatest(attempts-1,0) WHERE identity_hash=$1', [ipKey]);
    },
    clearLimit: key => pool.query('DELETE FROM identity.login_limits WHERE identity_hash=$1', [key]),

    createSession: ({tokenHash, accountId, csrf, hours}) => pool.query(
      `INSERT INTO identity.sessions (token_hash, account_id, csrf_token, expires_at)
       VALUES ($1, $2, $3, now() + make_interval(hours => $4))`, [tokenHash, accountId, csrf, hours]),
    session: tokenHash => one(
      `SELECT s.token_hash, s.account_id, s.csrf_token, s.expires_at, a.email, a.display_name, a.must_change_password
         FROM identity.sessions s JOIN identity.accounts a ON a.id = s.account_id
        WHERE s.token_hash=$1 AND s.expires_at > now() AND a.active`, [tokenHash]),
    deleteSession: tokenHash => pool.query('DELETE FROM identity.sessions WHERE token_hash=$1', [tokenHash]),
    deleteOtherSessions: (accountId, keepHash) => pool.query(
      'DELETE FROM identity.sessions WHERE account_id=$1 AND token_hash<>$2', [accountId, keepHash]),
    deleteExpiredSessions: () => pool.query('DELETE FROM identity.sessions WHERE expires_at <= now()'),
    setPassword: (accountId, hash, mustChange) => pool.query(
      'UPDATE identity.accounts SET password_hash=$2, must_change_password=$3 WHERE id=$1', [accountId, hash, mustChange]),

    // Used by scripts/add-account.js (run as the owner role, not the app role).
    createAccount: async ({email, displayName = '', passwordHash, mustChangePassword = true}) => one(
      `INSERT INTO identity.accounts (email, display_name, password_hash, must_change_password) VALUES ($1,$2,$3,$4)
       ON CONFLICT (email) DO UPDATE SET display_name=EXCLUDED.display_name RETURNING *`,
      [email, displayName, passwordHash, mustChangePassword]),
    grantAccess: ({accountId, app, tenantId, tenantName = '', role = ''}) => pool.query(
      `INSERT INTO identity.app_access (account_id, app, tenant_id, tenant_name, role) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (account_id, app, tenant_id) DO UPDATE SET tenant_name=EXCLUDED.tenant_name, role=EXCLUDED.role`,
      [accountId, app, tenantId, tenantName, role]),
  };
}

module.exports = {pgStore};
