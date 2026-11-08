'use strict';
const path = require('node:path');
const {createApp} = require('./app');
const {loadApps} = require('./apps');

const env = process.env;
const origin = env.SIGNIN_ORIGIN || 'http://localhost:3900';
if (env.NODE_ENV === 'production' && !origin.startsWith('https://')) throw new Error('Production requires an https SIGNIN_ORIGIN.');
const trustedProxy = env.TRUSTED_PROXY || 'none';
if (!['none', 'loopback'].includes(trustedProxy)) throw new Error('TRUSTED_PROXY must be none or loopback.');

const config = loadApps(env.APPS_FILE || path.join(__dirname, '..', 'apps.json'));
// Each app's key: SIGNIN_KEY_QUOTING, SIGNIN_KEY_SCHEDULING, ... (at least 32 characters).
const serviceKeys = {};
for (const a of config.apps) {
  const key = env['SIGNIN_KEY_' + a.id.toUpperCase().replace(/-/g, '_')];
  if (key && key.length < 32) throw new Error(`SIGNIN_KEY_${a.id.toUpperCase()} must be at least 32 characters.`);
  if (key) serviceKeys[a.id] = key;
}

let store, pool;
if (env.DATABASE_URL) {
  const {Pool} = require('pg');
  pool = new Pool({connectionString: env.DATABASE_URL, max: 10});
  store = require('./store-pg').pgStore(pool);
} else {
  if (env.NODE_ENV === 'production') throw new Error('DATABASE_URL is required in production.');
  store = require('./store-memory').memoryStore();
  require('../scripts/demo-accounts').seed(store, config).then(lines => console.log(lines.join('\n')));
}

const server = createApp({store, config, serviceKeys, origin, cookieDomain: env.COOKIE_DOMAIN || '',
  secure: origin.startsWith('https://'), trustedProxy: trustedProxy === 'loopback'});
server.listen(Number(env.PORT || 3900), env.HOST || '127.0.0.1', () => console.log('Sign-in: ' + origin));
const sweep = setInterval(() => store.deleteExpiredSessions().catch(e => console.error(e)), 3600000);
sweep.unref();
function close() { server.close(async () => { if (pool) await pool.end(); process.exit(0); }); }
process.on('SIGTERM', close); process.on('SIGINT', close);
