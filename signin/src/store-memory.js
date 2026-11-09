'use strict';
// In-memory storage with the same interface as store-pg.js, for unit tests and the local demo.
const {randomUUID} = require('node:crypto');

function memoryStore({now = () => Date.now()} = {}) {
  const accounts = new Map(), access = [], sessions = new Map(), limits = new Map();
  const live = a => (a && a.active ? {...a} : null);
  return {
    accountByEmail: async email => live([...accounts.values()].find(a => a.email === email)),
    accountByEmailAnyState: async email => { const a = [...accounts.values()].find(x => x.email === email); return a ? {...a} : null; },
    hasAccess: async (accountId, app, tenantId) => access.some(r => r.account_id === accountId && r.app === app && r.tenant_id === tenantId),
    revokeAccess: async (accountId, app, tenantId) => {
      const i = access.findIndex(r => r.account_id === accountId && r.app === app && r.tenant_id === tenantId);
      if (i >= 0) access.splice(i, 1);
    },
    deleteSessions: async accountId => { for (const [k, s] of sessions) if (s.account_id === accountId) sessions.delete(k); },
    accountById: async id => live(accounts.get(id)),
    access: async accountId => access.filter(r => r.account_id === accountId)
      .map(({app, tenant_id, tenant_name, role}) => ({app, tenant_id, tenant_name, role}))
      .sort((a, b) => a.app.localeCompare(b.app) || a.tenant_name.localeCompare(b.tenant_name)),

    beginAttempt: async (list, windowMinutes) => {
      for (const {key} of list) {
        const l = limits.get(key);
        if (!l || now() - l.windowStart > windowMinutes * 60000) limits.set(key, {attempts: 0, windowStart: now()});
      }
      if (list.some(l => limits.get(l.key).attempts >= l.max)) return 'blocked';
      for (const {key} of list) limits.get(key).attempts++;
      return 'ok';
    },
    loginSucceeded: async (accountKey, ipKey) => {
      if (limits.has(accountKey)) limits.get(accountKey).attempts = 0;
      if (limits.has(ipKey)) limits.get(ipKey).attempts = Math.max(0, limits.get(ipKey).attempts - 1);
    },
    clearLimit: async key => { limits.delete(key); },

    createSession: async ({tokenHash, accountId, csrf, hours}) => {
      sessions.set(tokenHash, {token_hash: tokenHash, account_id: accountId, csrf_token: csrf, expires_at: new Date(now() + hours * 3600000)});
    },
    session: async tokenHash => {
      const s = sessions.get(tokenHash), a = s && live(accounts.get(s.account_id));
      if (!s || !a || s.expires_at.getTime() <= now()) return null;
      return {...s, email: a.email, display_name: a.display_name, must_change_password: a.must_change_password, setup_admin: !!a.setup_admin};
    },
    deleteSession: async tokenHash => { sessions.delete(tokenHash); },
    deleteOtherSessions: async (accountId, keepHash) => {
      for (const [k, s] of sessions) if (s.account_id === accountId && k !== keepHash) sessions.delete(k);
    },
    deleteExpiredSessions: async () => { for (const [k, s] of sessions) if (s.expires_at.getTime() <= now()) sessions.delete(k); },
    setPassword: async (accountId, hash, mustChange) => {
      const a = accounts.get(accountId); a.password_hash = hash; a.must_change_password = mustChange;
    },

    createAccount: async ({email, displayName = '', passwordHash, mustChangePassword = true, active = true, setupAdmin = false}) => {
      const a = {id: randomUUID(), email, display_name: displayName, password_hash: passwordHash, must_change_password: mustChangePassword, active, setup_admin: setupAdmin};
      accounts.set(a.id, a); return {...a};
    },
    grantAccess: async ({accountId, app, tenantId, tenantName = '', role = ''}) => {
      const row = access.find(r => r.account_id === accountId && r.app === app && r.tenant_id === tenantId);
      if (row) Object.assign(row, {tenant_name: tenantName, role});
      else access.push({account_id: accountId, app, tenant_id: tenantId, tenant_name: tenantName, role});
    },
    deactivate: async id => { accounts.get(id).active = false; },

    // The setup page.
    accountByIdAnyState: async id => { const a = accounts.get(id); return a ? {...a} : null; },
    updateAccount: async ({id, displayName, active, setupAdmin}) => {
      Object.assign(accounts.get(id), {display_name: displayName, active, setup_admin: setupAdmin});
    },
    people: async () => [...accounts.values()].sort((a, b) => a.email.localeCompare(b.email)).map(a => ({
      id: a.id, email: a.email, display_name: a.display_name, active: a.active, setup_admin: !!a.setup_admin,
      must_change_password: a.must_change_password,
      access: access.filter(r => r.account_id === a.id).map(({app, tenant_id, tenant_name, role}) => ({app, tenant_id, tenant_name, role}))
        .sort((x, y) => x.app.localeCompare(y.app) || x.tenant_name.localeCompare(y.tenant_name)),
    })),
    firms: async () => {
      const seen = new Map();
      for (const r of access) if (!seen.has(r.app + '\0' + r.tenant_id) || r.tenant_name) seen.set(r.app + '\0' + r.tenant_id, {app: r.app, tenant_id: r.tenant_id, tenant_name: r.tenant_name});
      return [...seen.values()].sort((a, b) => a.app.localeCompare(b.app) || a.tenant_name.localeCompare(b.tenant_name));
    },
  };
}

module.exports = {memoryStore};
