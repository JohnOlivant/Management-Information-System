'use strict';
// The apps that use the shared sign-in, with the branding the sign-in page shows for each.
const fs = require('node:fs');

const COLOUR = /^#[0-9a-f]{6}$/i;

// The roles each app understands, shown on the setup page. An apps file can list its own "roles" (and
// "multipleRoles" when a person can hold several at one firm); otherwise these are used, so the server's
// existing /etc/signin/apps.json keeps working without edits.
const DEFAULT_ROLES = {
  mis: {roles: [['admin', 'Administrator'], ['viewer', 'Viewer']]},
  quoting: {multipleRoles: true, roles: [['estimator', 'Estimator'], ['approver', 'Approver'], ['rate_admin', 'Rates'],
    ['accounts', 'Accounts'], ['operations', 'Operations'], ['admin', 'Administrator']]},
  scheduling: {roles: [['scheduler', 'Scheduler'], ['admin', 'Administrator']]},
  timesheets: {roles: [['worker', 'Worker'], ['supervisor', 'Supervisor'], ['payroll', 'Payroll'], ['admin', 'Administrator']]},
  finance: {roles: [['director', 'Director'], ['office', 'Office'], ['advisor', 'Advisor'], ['viewer', 'Viewer']]},
};
const ROLE_ID = /^[a-z][a-z0-9_-]{0,39}$/;

function loadApps(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  return validateApps(raw);
}

function validateApps(raw) {
  const fail = m => { throw new Error('Apps file: ' + m); };
  if (!raw || !Array.isArray(raw.apps) || !raw.apps.length) fail('needs a non-empty "apps" list.');
  const seen = new Set();
  const apps = raw.apps.map(a => {
    if (!/^[a-z][a-z0-9-]{1,30}$/.test(a.id || '')) fail(`app id "${a.id}" must be lower-case letters, numbers and hyphens.`);
    if (seen.has(a.id)) fail(`app id "${a.id}" is listed twice.`); seen.add(a.id);
    for (const k of ['name', 'tagline', 'mark']) if (typeof a[k] !== 'string' || !a[k].trim()) fail(`${a.id}: "${k}" is required.`);
    if (a.mark.length > 3) fail(`${a.id}: "mark" is at most 3 characters.`);
    if (!COLOUR.test(a.accent || '') || !COLOUR.test(a.accentInk || '')) fail(`${a.id}: "accent" and "accentInk" must be #rrggbb colours.`);
    let home; try { home = new URL(a.homeUrl); } catch { fail(`${a.id}: "homeUrl" is not a full address.`); }
    const origins = [...new Set([home.origin, ...(a.origins || []).map(o => {
      let u; try { u = new URL(o); } catch { fail(`${a.id}: origin "${o}" is not a full address.`); }
      if (u.origin !== o.replace(/\/$/, '')) fail(`${a.id}: origin "${o}" must be scheme, host and port only.`);
      return u.origin;
    })])];
    for (const o of origins) if (!o.startsWith('https://') && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o)) fail(`${a.id}: ${o} must use https.`);
    const given = a.roles === undefined ? null : a.roles;
    if (given !== null && !Array.isArray(given)) fail(`${a.id}: "roles" must be a list.`);
    const roles = given ? given.map(r => {
      if (!ROLE_ID.test(r?.id || '') || typeof r.name !== 'string' || !r.name.trim()) fail(`${a.id}: each role needs an "id" (lower case) and a "name".`);
      return {id: r.id, name: r.name.trim()};
    }) : (DEFAULT_ROLES[a.id]?.roles || []).map(([id, name]) => ({id, name}));
    const multipleRoles = a.multipleRoles === undefined ? !!DEFAULT_ROLES[a.id]?.multipleRoles : a.multipleRoles === true;
    return {id: a.id, name: a.name.trim(), tagline: a.tagline.trim(), mark: a.mark.trim(), accent: a.accent, accentInk: a.accentInk,
      homeUrl: home.href, origins, roles, multipleRoles};
  });
  const suiteName = typeof raw.suiteName === 'string' && raw.suiteName.trim() ? raw.suiteName.trim() : 'Sign in';
  const suiteMark = typeof raw.suiteMark === 'string' && raw.suiteMark.trim() ? raw.suiteMark.trim().slice(0, 3) : suiteName.slice(0, 1).toUpperCase();
  return {suiteName, suiteMark, apps};
}

/** A return address is only followed when it belongs to the app asking; anything else is dropped (no open redirect). */
function safeReturn(app, value) {
  if (!app || typeof value !== 'string' || !value || value.length > 2000) return null;
  let u; try { u = new URL(value); } catch { return null; }
  if (u.username || u.password) return null;
  return app.origins.includes(u.origin) ? u.href : null;
}

const publicApp = a => a && ({id: a.id, name: a.name, tagline: a.tagline, mark: a.mark, accent: a.accent, accentInk: a.accentInk, homeUrl: a.homeUrl});

/**
 * Checks a role chosen on the setup page against the app's list and returns it as the sign-in stores it:
 * one role id, or for an app with multipleRoles a comma-separated list in the app's own order.
 */
function normaliseRole(app, value) {
  const picked = [...new Set((Array.isArray(value) ? value : String(value ?? '').split(',')).map(v => String(v).trim()).filter(Boolean))];
  if (!app.roles.length) return picked.join(',');
  const known = app.roles.map(r => r.id);
  const bad = picked.find(r => !known.includes(r));
  if (bad) return {error: `${app.name} has no role "${bad}".`};
  if (!picked.length) return {error: `Choose a role in ${app.name}.`};
  if (!app.multipleRoles && picked.length > 1) return {error: `${app.name} gives one role per person.`};
  return known.filter(r => picked.includes(r)).join(',');
}

module.exports = {loadApps, validateApps, safeReturn, publicApp, normaliseRole};
