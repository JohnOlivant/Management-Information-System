'use strict';
// What each app adds to use the shared sign-in. No dependencies; works from CommonJS and TypeScript.
//
//   const signin = createSignInClient({signinUrl: 'https://signin.example.co.uk', appId: 'quoting', serviceKey: process.env.SIGNIN_KEY});
//   const session = await signin.authenticate(req);   // null: send them to signin.signInUrl(currentAddress)
//   session.access -> [{tenantId, tenantName, role}] for this app only; check X-CSRF-Token against session.csrfToken.
const {createHash} = require('node:crypto');

const COOKIE = 'r29_signin';

function createSignInClient({signinUrl, appId, serviceKey, cacheSeconds = 30, fetch: fetchImpl = globalThis.fetch, now = () => Date.now()}) {
  if (!signinUrl || !appId || !serviceKey) throw new Error('signinUrl, appId and serviceKey are required.');
  const base = new URL(signinUrl).origin;
  const cache = new Map(); // sha(token) -> {until, session}

  function tokenFrom(cookieHeader) {
    const raw = String(cookieHeader || '').split(';').map(x => x.trim()).find(x => x.startsWith(COOKIE + '='));
    const t = raw ? raw.slice(COOKIE.length + 1) : '';
    return /^[0-9a-f]{64}$/.test(t) ? t : null;
  }

  async function call(path, token) {
    const res = await fetchImpl(base + path, {
      method: 'POST',
      headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + serviceKey},
      body: JSON.stringify({token}),
    });
    if (!res.ok) throw new Error(`Sign-in service answered ${res.status} on ${path}.`);
    return res.json();
  }

  /**
   * The visitor's session, or null when they are not signed in or this app is not one they may open.
   * Answers are cached for cacheSeconds, so a sign-out elsewhere takes up to that long to reach this app.
   */
  async function authenticate(req) {
    const token = tokenFrom(req.headers?.cookie);
    if (!token) return null;
    const key = createHash('sha256').update(token).digest('hex');
    const hit = cache.get(key);
    if (hit && hit.until > now()) return hit.session;
    const {session} = await call('/api/service/verify', token);
    const usable = session && session.access.length ? session : null;
    if (cache.size > 5000) cache.clear();
    cache.set(key, {until: now() + cacheSeconds * 1000, session: usable});
    return usable;
  }

  /** Ends the visitor's session everywhere (all four apps). The cookie itself is cleared by the sign-in page. */
  async function endSession(req) {
    const token = tokenFrom(req.headers?.cookie);
    if (!token) return;
    cache.delete(createHash('sha256').update(token).digest('hex'));
    await call('/api/service/end-session', token);
  }

  const withQuery = (path, returnTo) => {
    const u = new URL(path, base);
    u.searchParams.set('app', appId);
    if (returnTo) u.searchParams.set('return', returnTo);
    return u.href;
  };

  return {
    authenticate,
    endSession,
    /** Where to send someone who isn't signed in; they come back to returnTo afterwards. */
    signInUrl: returnTo => withQuery('/', returnTo),
    /** A link for the app's "Sign out" button. */
    signOutUrl: returnTo => withQuery('/signout', returnTo),
    /** A link for the app's "Change password" item. */
    passwordUrl: returnTo => withQuery('/password', returnTo),
  };
}

module.exports = {createSignInClient, COOKIE};
