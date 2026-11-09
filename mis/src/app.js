'use strict';
// The MIS web app: the reports page and its one data call. Sign-in is the shared sign-in; which firms
// someone may see is their MIS access there (identity.app_access rows for app "mis"), and firms.json
// says which Quoting, Scheduling and Timesheets ids make up each MIS firm.
const fs = require('node:fs');
const path = require('node:path');
const {allReports} = require('./reports');
const ts = require('./timesheet-report');

const PUBLIC = path.join(__dirname, '..', 'public');
const FILES = {'/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/app.css': ['app.css', 'text/css; charset=utf-8']};
const HEADERS = {
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
};

/** Reads firms.json: [{id, name, quoting?, scheduling?, timesheets?}], each app id the firm's id in that app. */
function loadFirms(file) {
  const list = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(list)) throw new Error(`${file} must hold a list of firms.`);
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  for (const f of list) {
    if (!f || typeof f.id !== 'string' || !f.id || typeof f.name !== 'string') throw new Error(`Each firm in ${file} needs an id and a name.`);
    for (const app of ['quoting', 'scheduling', 'timesheets']) {
      if (f[app] !== undefined && f[app] !== null && !UUID.test(f[app])) throw new Error(`Firm ${f.id}: ${app} must be that app's firm id.`);
    }
  }
  return new Map(list.map(f => [f.id, f]));
}

/**
 * The other apps for the top bar, named as on the sign-in page. Each is at <app>.<the MIS's parent domain>
 * (management.rule29.co.uk -> quoting.rule29.co.uk), or where `override` says: "quoting=https://...,timesheets=https://...".
 */
function appLinks(misOrigin, override = '') {
  const listed = require(path.join(__dirname, '..', '..', 'signin', 'apps.json')).apps.filter(a => a.id !== 'mis');
  const set = Object.fromEntries(override.split(',').map(x => x.trim().split('=')).filter(([k, v]) => k && v));
  return listed.map(a => {
    let url = set[a.id];
    if (!url && misOrigin) { const u = new URL(misOrigin); u.hostname = u.hostname.replace(/^[^.]+/, a.id); url = u.origin + '/'; }
    return {id: a.id, name: a.name, mark: a.mark, url: url || a.homeUrl};
  });
}

/**
 * auth(req) -> {email, displayName, access: [{tenantId, tenantName, role}]} or null
 * timesheet: {reference(firm), lines(firm, filters)} reads the Timesheets report, or null for a firm with no Timesheets
 * apps: [{id, name, mark, url}] the other apps, linked from the top bar; firms() -> Map(id -> firm); data(firm) -> the firm's data (sources.firmData or the demo); today() -> 'YYYY-MM-DD'
 */
function createApp({origin, apps = [], auth, signInUrl, signOutUrl, passwordUrl, appsUrl = () => null, firms, data, timesheet, today, cacheSeconds = 60, log = console}) {
  const cache = new Map();

  const send = (res, status, body, type = 'application/json; charset=utf-8', extra = {}) => {
    res.writeHead(status, {...HEADERS, 'Content-Type': type, 'Cache-Control': 'no-store', ...extra});
    res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
  };

  const myFirms = session => {
    const all = firms();
    return session.access.map(a => all.get(a.tenantId)).filter(Boolean)
      .map(f => ({id: f.id, name: f.name}))
      .filter((f, i, list) => list.findIndex(x => x.id === f.id) === i);
  };

  async function reportsFor(firm) {
    const key = firm.id, hit = cache.get(key);
    if (hit && hit.until > Date.now()) return hit.value;
    const d = await data(firm);
    const value = {...allReports(d, today()), problems: d.problems || []};
    cache.set(key, {until: Date.now() + cacheSeconds * 1000, value});
    return value;
  }

  return async function handle(req, res) {
    try {
      const url = new URL(req.url, 'http://mis.local');
      const route = url.pathname;
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, {error: 'Method not allowed.'});
      if (route === '/api/health') return send(res, 200, {ok: true});

      // Where to come back to after signing in. The sign-in only follows addresses listed for the MIS.
      const here = origin ? `${origin}/` : `${req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http'}://${req.headers.host}/`;
      const session = await auth(req);
      if (!session) {
        if (route.startsWith('/api/')) return send(res, 401, {error: 'Please sign in.', signIn: signInUrl(here)});
        if (route === '/') return send(res, 302, '', 'text/plain', {Location: signInUrl(here)});
      }
      if (session && session.mustChangePassword && route === '/') return send(res, 302, '', 'text/plain', {Location: passwordUrl(here)});

      if (FILES[route]) {
        const [file, type] = FILES[route];
        return send(res, 200, fs.readFileSync(path.join(PUBLIC, file)), type, {'Cache-Control': route === '/' ? 'no-store' : 'max-age=300'});
      }

      if (route === '/api/me') {
        return send(res, 200, {name: session.displayName || session.email, email: session.email, firms: myFirms(session),
          signOut: signOutUrl(here), password: passwordUrl(here), home: appsUrl(), apps});
      }

      if (route === '/api/reports') {
        const id = url.searchParams.get('firm') || '';
        if (!myFirms(session).some(f => f.id === id)) return send(res, 404, {error: 'You do not have that firm.'});
        return send(res, 200, await reportsFor(firms().get(id)));
      }

      // The Timesheets report, for the whole firm. JSON without the line detail, or one of its CSV files.
      if (route === '/api/timesheet-report' || route === '/api/timesheet-report/reference') {
        const id = url.searchParams.get('firm') || '';
        if (!myFirms(session).some(f => f.id === id)) return send(res, 404, {error: 'You do not have that firm.'});
        const firm = firms().get(id);
        if (!timesheet || !firm.timesheets) return send(res, 404, {error: 'Timesheets is not linked for this firm.'});
        if (route.endsWith('/reference')) return send(res, 200, await timesheet.reference(firm));
        const f = ts.filters(url.searchParams);
        const report = ts.build(await timesheet.lines(firm, f), f, firm.timesheets);
        if (url.searchParams.get('format') === 'csv') {
          const view = url.searchParams.get('view') || 'detail';
          return send(res, 200, ts.csv(report, view), 'text/csv; charset=utf-8',
            {'Content-Disposition': `attachment; filename="timesheet-report-${view}-${f.from}-${f.to}.csv"`});
        }
        const {details, ...summary} = report;
        return send(res, 200, summary);
      }

      return send(res, 404, {error: 'Not found.'});
    } catch (e) {
      if (e instanceof ts.HttpError) return send(res, e.status, {error: e.message});
      log.error(e);
      return send(res, 500, {error: 'Something went wrong. Try again in a moment.'});
    }
  };
}

module.exports = {createApp, loadFirms, appLinks};
