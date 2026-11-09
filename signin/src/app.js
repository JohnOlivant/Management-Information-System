'use strict';
// The shared sign-in service: one sign-in page and one session for Quoting, Scheduling, Timesheets and the MIS.
// Browsers talk to /api/*; apps check a visitor's session server to server on /api/service/* with their key.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const {HttpError, need, sha, token, hashPassword, verifyPassword, sameSecret, readCookie, PASSWORD_MIN} = require('./security');
const {safeReturn, publicApp, normaliseRole} = require('./apps');

const COOKIE = 'r29_signin';
const SESSION_HOURS = 8, WINDOW_MINUTES = 15, ACCOUNT_LIMIT = 5, IP_LIMIT = 30;
const MAX_BODY = 16 * 1024;
const PUBLIC = path.join(__dirname, '..', 'public');
const PAGES = new Set(['/', '/signout', '/password']);
const ASSETS = {'/signin.css': 'text/css; charset=utf-8', '/signin.js': 'text/javascript; charset=utf-8',
  '/setup.css': 'text/css; charset=utf-8', '/setup.js': 'text/javascript; charset=utf-8'};
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * @param {object} o
 * @param {object} o.store          store-pg or store-memory
 * @param {{suiteName:string, apps:object[]}} o.config  from apps.js
 * @param {Record<string,string>} o.serviceKeys  app id -> the key that app sends to /api/service/*
 * @param {string} [o.origin]       this service's own address; browser POSTs from anywhere else are refused
 * @param {string} [o.cookieDomain] parent domain shared by the apps, e.g. "example.co.uk"
 * @param {boolean} [o.secure]      HTTPS: cookies are Secure
 * @param {boolean} [o.trustedProxy] read the client address from X-Forwarded-For (loopback proxy only)
 * @param {number} [o.passwordMin]
 */
function createApp({store, config, serviceKeys = {}, origin = '', cookieDomain = '', secure = false, trustedProxy = false, passwordMin = PASSWORD_MIN}) {
  const apps = new Map(config.apps.map(a => [a.id, a]));
  const dummyHash = hashPassword('x'.repeat(24), 1); // equal work for unknown emails
  const cookie = (value, maxAge) => `${COOKIE}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`
    + (cookieDomain ? `; Domain=${cookieDomain}` : '') + (secure ? '; Secure' : '');
  const clientIp = req => (trustedProxy && req.socket.remoteAddress === '127.0.0.1'
    ? String(req.headers['x-forwarded-for'] || '').split(',').pop().trim() : '') || req.socket.remoteAddress || 'unknown';

  async function currentSession(req) {
    const t = readCookie(req.headers.cookie, COOKIE);
    return t ? store.session(sha(t)) : null;
  }

  /** The apps this account may open, with the firms in each, in the order of the apps file. */
  async function openableApps(accountId) {
    const rows = await store.access(accountId);
    return config.apps.filter(a => rows.some(r => r.app === a.id)).map(a => ({
      ...publicApp(a), tenants: rows.filter(r => r.app === a.id).map(r => r.tenant_name || r.tenant_id),
    }));
  }

  async function login(body, ip) {
    const email = String(body.email || '').trim().toLowerCase();
    need(email && typeof body.password === 'string', 400, 'Enter your email and password.');
    need(email.length <= 254 && body.password.length <= 128, 401, 'Email or password not recognised.');
    const accountKey = sha('account:' + email), ipKey = sha('ip:' + ip);
    const gate = await store.beginAttempt([{key: accountKey, max: ACCOUNT_LIMIT}, {key: ipKey, max: IP_LIMIT}], WINDOW_MINUTES);
    need(gate !== 'blocked', 429, `Too many attempts. Wait ${WINDOW_MINUTES} minutes and try again.`);
    const account = await store.accountByEmail(email);
    const valid = await verifyPassword(body.password, account ? account.password_hash : await dummyHash);
    need(account && valid, 401, 'Email or password not recognised.');
    await store.loginSucceeded(accountKey, ipKey);
    const t = token();
    await store.createSession({tokenHash: sha(t), accountId: account.id, csrf: token(), hours: SESSION_HOURS});
    return {token: t, account};
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://local');
    const route = url.pathname, method = req.method;
    securityHeaders(res);

    if (method === 'GET' && PAGES.has(route)) return file(res, 'signin.html', 'text/html; charset=utf-8');
    if (method === 'GET' && route === '/setup') return file(res, 'setup.html', 'text/html; charset=utf-8');
    if (method === 'GET' && ASSETS[route]) return file(res, route.slice(1), ASSETS[route]);
    if (route === '/api/health' && method === 'GET') return send(res, {ok: true});

    // Server to server: an app checks the session cookie a visitor brought it.
    if (route.startsWith('/api/service/')) {
      need(method === 'POST', 405, 'Method not allowed.');
      const app = serviceApp(req.headers.authorization);
      const body = await readJson(req);
      const t = typeof body.token === 'string' && /^[0-9a-f]{64}$/.test(body.token) ? body.token : null;
      if (route === '/api/service/verify') {
        const s = t && await store.session(sha(t));
        if (!s) return send(res, {session: null});
        const access = (await store.access(s.account_id)).filter(r => r.app === app.id)
          .map(r => ({tenantId: r.tenant_id, tenantName: r.tenant_name, role: r.role}));
        return send(res, {session: {
          accountId: s.account_id, email: s.email, displayName: s.display_name, mustChangePassword: s.must_change_password,
          csrfToken: s.csrf_token, expiresAt: new Date(s.expires_at).toISOString(), access,
        }});
      }
      if (route === '/api/service/end-session') {
        if (t) await store.deleteSession(sha(t));
        return send(res, {ok: true});
      }
      // An app's own user admin (e.g. the timesheet's Workers screen) gives or removes access to that app
      // for one firm. It can create an account, but can't change the password of one that already exists.
      if (route === '/api/service/provision') {
        const email = String(body.email || '').trim().toLowerCase();
        need(/^[^\s@]+@[^\s@]+$/.test(email) && email.length <= 254, 400, 'Enter a valid login email.');
        const tenantId = String(body.tenantId || '');
        need(tenantId && tenantId.length <= 100, 400, 'Missing firm.');
        const role = String(body.role || '').slice(0, 400), tenantName = String(body.tenantName || '').slice(0, 200);
        const displayName = String(body.displayName || '').trim().slice(0, 120);
        let account = await store.accountByEmail(email), created = false;
        if (body.active === false) {
          if (account) { await store.revokeAccess(account.id, app.id, tenantId); await store.deleteSessions(account.id); }
          return send(res, {accountId: account?.id || null, created});
        }
        if (!account) {
          need(!(await store.accountByEmailAnyState(email)), 409, 'That login is switched off in the sign-in service. Ask the system administrator.');
          need(typeof body.temporaryPassword === 'string', 400, 'Give a temporary password for the new login.');
          account = await store.createAccount({email, displayName, passwordHash: await hashPassword(body.temporaryPassword, passwordMin), mustChangePassword: true});
          created = true;
        }
        await store.grantAccess({accountId: account.id, app: app.id, tenantId, tenantName, role});
        return send(res, {accountId: account.id, created});
      }
      // Only for someone who has access to this app at this firm, so one firm can't reset another's staff.
      if (route === '/api/service/reset-password') {
        const email = String(body.email || '').trim().toLowerCase();
        const account = await store.accountByEmail(email);
        need(account && await store.hasAccess(account.id, app.id, String(body.tenantId || '')), 404, 'No login with access to this firm.');
        const hash = await hashPassword(body.temporaryPassword, passwordMin);
        await store.setPassword(account.id, hash, true);
        await store.deleteSessions(account.id);
        await store.clearLimit(sha('account:' + email));
        return send(res, {ok: true});
      }
      throw new HttpError(404, 'Not found.');
    }

    if (route === '/api/state' && method === 'GET') {
      const app = apps.get(url.searchParams.get('app') || '') || null;
      const s = await currentSession(req);
      const openable = s ? await openableApps(s.account_id) : [];
      return send(res, {
        suiteName: config.suiteName, suiteMark: config.suiteMark, passwordMin, app: publicApp(app), allApps: config.apps.map(publicApp),
        returnTo: safeReturn(app, url.searchParams.get('return')),
        signedIn: s && {email: s.email, displayName: s.display_name, mustChangePassword: s.must_change_password,
          csrf: s.csrf_token, apps: openable, canOpenApp: !!app && openable.some(a => a.id === app.id), setupAdmin: !!s.setup_admin},
      });
    }

    // The setup page: everyone's logins, and which apps, firms and roles each person has.
    if (route === '/api/setup' && method === 'GET') {
      const s = await currentSession(req);
      need(s, 401, 'Please sign in.');
      need(s.setup_admin && !s.must_change_password, 403, 'Only a setup administrator can open this page.');
      return send(res, await setupState(s));
    }

    need(method === 'POST', 404, 'Not found.');
    // Browser POSTs must come from this page: stops another site signing someone in or out.
    need(!origin || req.headers.origin === origin, 403, 'Request refused.');
    const body = await readJson(req);

    if (route === '/api/login') {
      const {token: t, account} = await login(body, clientIp(req));
      res.setHeader('Set-Cookie', cookie(t, SESSION_HOURS * 3600));
      const app = apps.get(String(body.app || '')) || null;
      const allowed = app && (await store.access(account.id)).some(r => r.app === app.id);
      const next = !account.must_change_password && allowed ? (safeReturn(app, body.return) || app.homeUrl) : null;
      return send(res, {next});
    }

    const s = await currentSession(req);
    need(s, 401, 'Please sign in.');
    need(sameSecret(req.headers['x-csrf-token'] || '', s.csrf_token), 403, 'Request verification failed. Reload the page.');

    if (route === '/api/logout') {
      await store.deleteSession(s.token_hash);
      res.setHeader('Set-Cookie', cookie('', 0));
      return send(res, {ok: true});
    }
    if (route === '/api/password') {
      need(typeof body.currentPassword === 'string', 400, 'Enter your current password.');
      need(typeof body.newPassword === 'string' && body.newPassword !== body.currentPassword, 400, 'Choose a password you have not just used.');
      const hash = await hashPassword(body.newPassword, passwordMin);
      const account = await store.accountById(s.account_id);
      need(account && await verifyPassword(body.currentPassword, account.password_hash), 400, 'Your current password is not correct.');
      await store.setPassword(s.account_id, hash, false);
      await store.deleteOtherSessions(s.account_id, s.token_hash);
      await store.clearLimit(sha('account:' + s.email));
      const app = apps.get(String(body.app || '')) || null;
      const allowed = app && (await store.access(s.account_id)).some(r => r.app === app.id);
      return send(res, {next: allowed ? (safeReturn(app, body.return) || app.homeUrl) : null});
    }
    if (route.startsWith('/api/setup/')) {
      need(s.setup_admin && !s.must_change_password, 403, 'Only a setup administrator can do this.');
      await setupChange(route, body, s);
      return send(res, await setupState(s));
    }
    throw new HttpError(404, 'Not found.');
  }

  async function setupState(s) {
    const [people, firms] = await Promise.all([store.people(), store.firms()]);
    return {
      me: s.account_id, passwordMin,
      apps: config.apps.map(a => ({...publicApp(a), roles: a.roles, multipleRoles: a.multipleRoles,
        firms: firms.filter(f => f.app === a.id).map(f => ({tenantId: f.tenant_id, tenantName: f.tenant_name}))})),
      people: people.map(p => ({id: p.id, email: p.email, displayName: p.display_name, active: p.active, setupAdmin: p.setup_admin,
        mustChangePassword: p.must_change_password,
        access: p.access.map(x => ({app: x.app, tenantId: x.tenant_id, tenantName: x.tenant_name, role: x.role}))})),
    };
  }

  /** One change from the setup page. Anything that takes access away also signs the person out everywhere. */
  async function setupChange(route, body, s) {
    if (route === '/api/setup/person') {
      const displayName = String(body.displayName ?? '').trim();
      need(displayName.length <= 120, 400, 'Use a name of up to 120 characters.');
      const active = body.active !== false, setupAdmin = body.setupAdmin === true;
      if (!body.id) {
        const email = String(body.email || '').trim().toLowerCase();
        need(EMAIL.test(email) && email.length <= 254, 400, 'Enter a valid email.');
        need(!(await store.accountByEmailAnyState(email)), 409, 'Someone already has that email. Find them in the list instead.');
        need(typeof body.temporaryPassword === 'string', 400, 'Give a temporary password for the new login.');
        const account = await store.createAccount({email, displayName, passwordHash: await hashPassword(body.temporaryPassword, passwordMin), mustChangePassword: true});
        if (setupAdmin) await store.updateAccount({id: account.id, displayName, active: true, setupAdmin});
        return;
      }
      const account = await store.accountByIdAnyState(String(body.id));
      need(account, 404, 'That person is no longer here. Reload the page.');
      if (account.id === s.account_id) need(active && setupAdmin, 400, "You can't switch off your own login or setup access.");
      await store.updateAccount({id: account.id, displayName, active, setupAdmin});
      if (!active && account.active) await store.deleteSessions(account.id);
      return;
    }
    if (route === '/api/setup/access') {
      const account = await store.accountByIdAnyState(String(body.accountId || ''));
      need(account, 404, 'That person is no longer here. Reload the page.');
      const app = apps.get(String(body.app || ''));
      need(app, 400, 'Choose an app.');
      const tenantId = String(body.tenantId || '').trim();
      need(tenantId && tenantId.length <= 100, 400, 'Choose a firm.');
      if (body.remove === true) {
        await store.revokeAccess(account.id, app.id, tenantId);
        await store.deleteSessions(account.id);
        return;
      }
      const role = normaliseRole(app, body.role);
      need(typeof role === 'string', 400, role.error);
      const tenantName = String(body.tenantName ?? '').trim().slice(0, 200);
      await store.grantAccess({accountId: account.id, app: app.id, tenantId, tenantName, role});
      return;
    }
    if (route === '/api/setup/reset-password') {
      const account = await store.accountByIdAnyState(String(body.accountId || ''));
      need(account, 404, 'That person is no longer here. Reload the page.');
      need(account.id !== s.account_id, 400, 'Change your own password with Change password.');
      await store.setPassword(account.id, await hashPassword(body.temporaryPassword, passwordMin), true);
      await store.deleteSessions(account.id);
      await store.clearLimit(sha('account:' + account.email));
      return;
    }
    throw new HttpError(404, 'Not found.');
  }

  function serviceApp(header) {
    const key = /^Bearer (.+)$/.exec(String(header || ''))?.[1] || '';
    const match = Object.entries(serviceKeys).find(([, k]) => k && sameSecret(key, k));
    need(match && apps.has(match[0]), 401, 'Unknown service key.');
    return apps.get(match[0]);
  }

  return http.createServer((req, res) => {
    handle(req, res).catch(e => {
      if (e instanceof HttpError) return send(res, {error: e.message}, e.status);
      console.error(e);
      send(res, {error: 'Something went wrong. Try again.'}, 500);
    });
  });
}

function securityHeaders(res) {
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; frame-ancestors 'none'; form-action 'self'; base-uri 'none'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Cache-Control', 'no-store');
}

function send(res, body, status = 200) {
  if (res.headersSent) return res.end();
  res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8'});
  res.end(JSON.stringify(body));
}

function file(res, name, type) {
  res.writeHead(200, {'Content-Type': type});
  fs.createReadStream(path.join(PUBLIC, name)).pipe(res);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) { reject(new HttpError(413, 'Request too large.')); req.destroy(); } else chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { const v = JSON.parse(Buffer.concat(chunks).toString('utf8')); resolve(v && typeof v === 'object' && !Array.isArray(v) ? v : {}); }
      catch { reject(new HttpError(400, 'Invalid request.')); }
    });
    req.on('error', reject);
  });
}

module.exports = {createApp, COOKIE, SESSION_HOURS};
