'use strict';
// Demo accounts for running the sign-in page locally without a database. Never used in production.
const {hashPassword} = require('../src/security');

const PASSWORD = 'demo-password-1';

async function seed(store, config) {
  const hash = await hashPassword(PASSWORD);
  const owner = await store.createAccount({email: 'owner@example.com', displayName: 'Sam Owner', passwordHash: hash, mustChangePassword: false});
  for (const a of config.apps) await store.grantAccess({accountId: owner.id, app: a.id, tenantId: 'demo-firm', tenantName: 'Demo Builders Ltd', role: 'admin'});
  const crew = await store.createAccount({email: 'crew@example.com', displayName: 'Alex Crew', passwordHash: hash, mustChangePassword: false});
  await store.grantAccess({accountId: crew.id, app: 'timesheets', tenantId: 'demo-firm', tenantName: 'Demo Builders Ltd', role: 'worker'});
  const fresh = await store.createAccount({email: 'new@example.com', displayName: 'New Starter', passwordHash: hash, mustChangePassword: true});
  await store.grantAccess({accountId: fresh.id, app: 'quoting', tenantId: 'demo-firm', tenantName: 'Demo Builders Ltd', role: 'estimator'});
  return [
    `Demo accounts (password "${PASSWORD}"):`,
    '  owner@example.com  every app',
    '  crew@example.com   Timesheets only',
    '  new@example.com    Quoting, must change the temporary password',
  ];
}

module.exports = {seed, PASSWORD};
