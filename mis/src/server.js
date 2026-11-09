'use strict';
// Starts the MIS. With SIGNIN_URL and SIGNIN_KEY it uses the shared sign-in and the apps' databases;
// without them it runs the demo (made-up data, no sign-in), which is refused in production.
const http = require('node:http');
const path = require('node:path');
const {createApp, loadFirms, appLinks: links} = require('./app');
const appLinks = origin => links(origin, process.env.APP_LINKS);
const {pools, firmData, ukToday} = require('./sources');
const {demoData, demoTimesheet} = require('./demo');
const ts = require('./timesheet-report');

const env = process.env;
const port = Number(env.PORT || 3400), host = env.HOST || '127.0.0.1';
let app;


if (env.SIGNIN_URL && env.SIGNIN_KEY) {
  const {createSignInClient} = require(path.join(__dirname, '..', '..', 'signin', 'client'));
  const {Pool} = require('pg');
  const signin = createSignInClient({signinUrl: env.SIGNIN_URL, appId: 'mis', serviceKey: env.SIGNIN_KEY});
  const firmsFile = env.FIRMS_FILE || '/etc/mis/firms.json';
  let firms = loadFirms(firmsFile), loaded = Date.now();
  const p = pools(env, Pool);
  app = createApp({
    origin: env.MIS_ORIGIN ? new URL(env.MIS_ORIGIN).origin : undefined,
    apps: appLinks(env.MIS_ORIGIN),
    auth: req => signin.authenticate(req),
    signInUrl: signin.signInUrl, signOutUrl: signin.signOutUrl, passwordUrl: signin.passwordUrl,
    // firms.json is read again at most once a minute, so a new firm shows without a restart.
    firms: () => {
      if (Date.now() - loaded > 60000) { try { firms = loadFirms(firmsFile); } catch (e) { console.error(e.message); } loaded = Date.now(); }
      return firms;
    },
    data: firm => firmData(p, firm),
    timesheet: p.timesheets ? {reference: firm => ts.reference(p.timesheets, firm.timesheets), lines: (firm, f) => ts.lines(p.timesheets, firm.timesheets, f)} : null,
    today: ukToday,
  });
  console.log(`MIS on http://${host}:${port}, sign-in ${env.SIGNIN_URL}; reading ${Object.entries(p).filter(([, v]) => v).map(([k]) => k).join(', ') || 'no app databases'}`);
} else {
  if (env.NODE_ENV === 'production') { console.error('Set SIGNIN_URL and SIGNIN_KEY: the demo does not run in production.'); process.exit(1); }
  const demoFirm = {id: 'demo', name: 'Demo Builders Ltd', timesheets: '00000000-0000-4000-8000-000000000001'};
  app = createApp({
    apps: appLinks(null),
    auth: async () => ({email: 'owner@example.com', displayName: 'Demo owner', access: [{tenantId: 'demo', tenantName: demoFirm.name, role: ''}]}),
    signInUrl: () => '/', signOutUrl: () => '/', passwordUrl: () => '/',
    firms: () => new Map([['demo', demoFirm]]),
    data: async () => demoData(ukToday()),
    timesheet: demoTimesheet(ukToday),
    today: ukToday,
  });
  console.log(`MIS demo on http://${host}:${port} (made-up data)`);
}

http.createServer(app).listen(port, host);
