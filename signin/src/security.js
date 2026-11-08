'use strict';
// The same security model the timesheet, scheduler and quoting already use: scrypt password hashes,
// hashed random session tokens with a CSRF token, 8-hour sessions and per-account and per-IP login limits.
const {randomBytes, scrypt, timingSafeEqual, createHash} = require('node:crypto');
const {promisify} = require('node:util');

const derive = promisify(scrypt);
const SCRYPT = {N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024};
const PASSWORD_MIN = 12, PASSWORD_MAX = 128;

class HttpError extends Error {
  constructor(status, message, code) { super(message); this.status = status; if (code) this.code = code; }
}
function need(condition, status, message, code) { if (!condition) throw new HttpError(status, message, code); }

const sha = value => createHash('sha256').update(value).digest('hex');
const token = () => randomBytes(32).toString('hex');

async function hashPassword(password, min = PASSWORD_MIN) {
  need(typeof password === 'string' && password.length >= min && password.length <= PASSWORD_MAX, 400,
    `Use a password of ${min} to ${PASSWORD_MAX} characters.`);
  const salt = randomBytes(16).toString('hex');
  return `scrypt:${salt}:${(await derive(password, salt, 64, SCRYPT)).toString('hex')}`;
}

/** Reads the `scrypt:salt:hash` format all three apps store, so existing hashes can be copied across. */
async function verifyPassword(password, stored) {
  if (typeof password !== 'string' || password.length > PASSWORD_MAX) return false;
  const [method, salt, hash] = String(stored).split(':');
  if (method !== 'scrypt' || !/^[a-f0-9]{32}$/.test(salt) || !/^[a-f0-9]{128}$/.test(hash)) return false;
  return timingSafeEqual(await derive(password, salt, 64, SCRYPT), Buffer.from(hash, 'hex'));
}

/** Constant-time comparison of two strings of any length. */
function sameSecret(a, b) {
  const x = Buffer.from(sha(String(a))), y = Buffer.from(sha(String(b)));
  return timingSafeEqual(x, y) && String(a).length > 0;
}

function readCookie(header, name) {
  const raw = String(header || '').split(';').map(x => x.trim()).find(x => x.startsWith(name + '='));
  const value = raw ? raw.slice(name.length + 1) : '';
  return /^[0-9a-f]{64}$/.test(value) ? value : null;
}

module.exports = {HttpError, need, sha, token, hashPassword, verifyPassword, sameSecret, readCookie, PASSWORD_MIN, PASSWORD_MAX};
