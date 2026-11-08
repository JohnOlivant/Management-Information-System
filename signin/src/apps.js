'use strict';
// The apps that use the shared sign-in, with the branding the sign-in page shows for each.
const fs = require('node:fs');

const COLOUR = /^#[0-9a-f]{6}$/i;

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
    return {id: a.id, name: a.name.trim(), tagline: a.tagline.trim(), mark: a.mark.trim(), accent: a.accent, accentInk: a.accentInk,
      homeUrl: home.href, origins};
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

module.exports = {loadApps, validateApps, safeReturn, publicApp};
