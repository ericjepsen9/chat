const crypto = require('crypto');
const { promisify } = require('util');
const { normalizeUserRole } = require('./server_roles');

const scryptAsync = promisify(crypto.scrypt);
// Pre-compiled regexes to avoid re-creation on every call
const RE_PHONE = /^1\d{10}$/;
const RE_NON_DIGIT = /\D+/g;
const RE_IP_CHARS = /^[0-9a-fA-F:.]+$/;

function uid(prefix) {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

function makeSalt() {
  return crypto.randomBytes(16).toString('hex');
}

const SCRYPT_OPTS = { N: 16384, r: 8, p: 1 };

function hashPassword(password, salt = makeSalt()) {
  const hash = crypto.scryptSync(String(password), salt, 64, SCRYPT_OPTS).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (typeof stored !== 'string' || !stored) return false;
  if (!stored.includes(':')) {
    // Legacy plaintext password: compare using timing-safe method, then force migration
    const a = Buffer.from(String(password));
    const b = Buffer.from(stored);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }
  const [salt, hash] = stored.split(':');
  const actual = crypto.scryptSync(String(password), salt, 64, SCRYPT_OPTS).toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(actual, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function hashPasswordAsync(password, salt = makeSalt()) {
  const hash = (await scryptAsync(String(password), salt, 64, SCRYPT_OPTS)).toString('hex');
  return `${salt}:${hash}`;
}

async function verifyPasswordAsync(password, stored) {
  if (typeof stored !== 'string' || !stored) return false;
  if (!stored.includes(':')) {
    const a = Buffer.from(String(password));
    const b = Buffer.from(stored);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }
  const [salt, hash] = stored.split(':');
  const actual = (await scryptAsync(String(password), salt, 64, SCRYPT_OPTS)).toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(actual, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const phoneCodeStore = new Map();
const phoneCodeCooldownStore = new Map();
const phoneCodeIpCooldownStore = new Map();
const phoneCodeVerifyAttempts = new Map();
const phoneCodeVerifyIpAttempts = new Map();
const PHONE_CODE_COOLDOWN_MS = 60 * 1000;
const PHONE_CODE_IP_COOLDOWN_MS = 3 * 1000;
const PHONE_CODE_MAX_VERIFY_ATTEMPTS = 6;
const PHONE_CODE_VERIFY_BLOCK_MS = 10 * 60 * 1000;
const EXPOSE_MOCK_PHONE_CODE = process.env.EXPOSE_MOCK_PHONE_CODE === '1';
const csrfTokens = new Map(); // token -> csrfSecret
function issueCsrfToken(sessionToken) {
  const secret = crypto.randomBytes(24).toString('hex');
  csrfTokens.set(sessionToken, secret);
  return secret;
}
function validateCsrf(req, sessionToken) {
  if (!sessionToken) return false;
  const expected = csrfTokens.get(sessionToken);
  if (!expected) return false;
  const provided = req.headers['x-csrf-token'] || '';
  if (!provided || provided.length !== expected.length) return false;
  try {
    const valid = crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
    if (valid) {
      // Rotate CSRF token after successful validation to prevent replay
      const newSecret = crypto.randomBytes(24).toString('hex');
      csrfTokens.set(sessionToken, newSecret);
      // Return both validity and new token so caller can send it in response header
      req._newCsrfToken = newSecret;
    }
    return valid;
  } catch (_) { return false; }
}
const TRUST_PROXY = process.env.TRUST_PROXY === '1';

function normalizePhone(phone) {
  if (!phone) return '';
  const digits = String(phone).trim().replace(RE_NON_DIGIT, '');
  if (digits.length < 11) return '';
  let normalized = digits;
  if (digits.length === 13 && digits[0] === '8' && digits[1] === '6' && digits[2] === '1') {
    normalized = digits.slice(2);
  }
  return RE_PHONE.test(normalized) ? normalized : '';
}

// Shared cleanup helpers
function cleanupExpiredMap(map, isExpired) {
  const now = Date.now();
  for (const [key, val] of map.entries()) {
    if (isExpired(key, val, now)) map.delete(key);
  }
}
function isRateLimitEntryStale(_key, state, now) {
  const expiredBlock = !state?.blockedUntil || Number(state.blockedUntil) < now;
  const staleWindow = !state?.windowStart || now - Number(state.windowStart) > 60 * 60 * 1000;
  return expiredBlock && staleWindow;
}

// Batch cleanup of all phone code maps; throttled to run at most once per 30s
let _lastPhoneCodeCleanup = 0;
function cleanupExpiredPhoneCodeState() {
  const now = Date.now();
  if (now - _lastPhoneCodeCleanup < 30000) return;
  _lastPhoneCodeCleanup = now;
  for (const [k, r] of phoneCodeStore.entries()) { if (!r || r.expiresAt < now) phoneCodeStore.delete(k); }
  for (const [k, v] of phoneCodeCooldownStore.entries()) { if (!v || v < now) phoneCodeCooldownStore.delete(k); }
  for (const [k, v] of phoneCodeIpCooldownStore.entries()) { if (!v || v < now) phoneCodeIpCooldownStore.delete(k); }
  for (const [k, s] of phoneCodeVerifyAttempts.entries()) { if (isRateLimitEntryStale(k, s, now)) phoneCodeVerifyAttempts.delete(k); }
  for (const [k, s] of phoneCodeVerifyIpAttempts.entries()) { if (isRateLimitEntryStale(k, s, now)) phoneCodeVerifyIpAttempts.delete(k); }
}

function issuePhoneCode(phone, scene = 'login') {
  cleanupExpiredPhoneCodeState();
  const normalized = normalizePhone(phone);
  if (!normalized) return { ok: false, error: '手机号格式错误' };
  const key = `${scene}:${normalized}`;
  const now = Date.now();
  const cooldownUntil = phoneCodeCooldownStore.get(key) || 0;
  if (cooldownUntil > now) {
    // If a valid code already exists, return success (user can re-use it)
    const existing = phoneCodeStore.get(key);
    if (existing && existing.expiresAt > now) {
      return { ok: true, code: existing.code, expiresInSec: Math.ceil((existing.expiresAt - now) / 1000) };
    }
    // No valid code exists but still in cooldown — issue a new code anyway
    // (previous code was consumed or expired, user needs a fresh one)
  }
  const code = String(crypto.randomInt(100000, 999999)); // 6-digit random code
  phoneCodeStore.set(key, { code, expiresAt: now + 5 * 60 * 1000 });
  phoneCodeCooldownStore.set(key, now + PHONE_CODE_COOLDOWN_MS);
  phoneCodeVerifyAttempts.delete(key);
  return { ok: true, code, expiresInSec: 300 };
}

function ensureUserActiveForAuth(user) {
  return String(user?.status || 'active') === 'active';
}

function consumePhoneCode(phone, code, scene = 'login') {
  const normalized = normalizePhone(phone);
  if (!normalized) return { ok: false, error: '手机号格式错误' };

  const codeStr = String(code || '').trim();
  if (!codeStr) return { ok: false, error: '请输入验证码' };

  // TODO: 验证码暂时不做校验，任意验证码均可通过
  const key = `${scene}:${normalized}`;
  phoneCodeStore.delete(key);
  phoneCodeVerifyAttempts.delete(key);
  return { ok: true };
}

function maskPhone(phone) {
  const p = String(phone || '');
  if (p.length < 7) return p ? p.replace(/.(?=.{2})/g, '*') : '';
  return p.slice(0, 3) + '****' + p.slice(-4);
}
function sanitizePublicUser(user, { includePhone = false, includePaymentCodes = false } = {}) {
  const result = {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    signature: user.signature,
    avatarUrl: user.avatarUrl,
    appNumberId: user.appNumberId,
    customGroups: user.customGroups,
    role: normalizeUserRole(user),
    status: user.status || 'active',
    phone: includePhone ? (user.phone || '') : maskPhone(user.phone),
  };
  if (includePaymentCodes) {
    result.paymentCodes = user.paymentCodes || { wechat:'', alipay:'', cloudpay:'' };
  }
  return result;
}

function normalizeIpForThrottle(raw) {
  const value = String(raw || '').trim().slice(0, 64);
  if (!value) return '';
  return RE_IP_CHARS.test(value) ? value : '';
}

function getClientIp(req) {
  const remoteIp = normalizeIpForThrottle(req.socket?.remoteAddress || '');
  if (!TRUST_PROXY) return remoteIp;
  const forwarded = normalizeIpForThrottle(String(req.headers['x-forwarded-for'] || '').split(',')[0]);
  return forwarded || remoteIp;
}

// Shared rate-limit state helpers (parameterized by map + thresholds)
function getRateLimitState(map, key) {
  const now = Date.now();
  if (!key) return { count: 0, windowStart: now, blockedUntil: 0 };
  const existing = map.get(key) || { count: 0, windowStart: now, blockedUntil: 0 };
  if (existing.blockedUntil && existing.blockedUntil > now) return existing;
  if (now - Number(existing.windowStart || now) > 10 * 60 * 1000) {
    const reset = { count: 0, windowStart: now, blockedUntil: 0 };
    map.set(key, reset);
    return reset;
  }
  return existing;
}

function recordRateLimitAttempt(map, key, success, maxAttempts, blockDurationMs) {
  if (!key) return;
  const now = Date.now();
  const state = getRateLimitState(map, key);
  if (success) { map.delete(key); return; }
  const next = {
    count: (state.count || 0) + 1,
    windowStart: state.windowStart || now,
    blockedUntil: state.blockedUntil || 0,
  };
  if (next.count >= maxAttempts) next.blockedUntil = now + blockDurationMs;
  map.set(key, next);
}

const loginAttempts = new Map();

function getLoginAttemptState(key) { return getRateLimitState(loginAttempts, key); }
function recordLoginAttempt(key, success) { recordRateLimitAttempt(loginAttempts, key, success, 8, 5 * 60 * 1000); }
function getPhoneCodeIpAttemptState(ip) { return getRateLimitState(phoneCodeVerifyIpAttempts, ip); }
function recordPhoneCodeIpAttempt(ip, success) { recordRateLimitAttempt(phoneCodeVerifyIpAttempts, ip, success, 20, 10 * 60 * 1000); }

function cleanupAuthState({ sessions, sseSessionTokens }) {
  const now = Date.now();
  const deletedTokens = [];
  for (const [token, session] of sessions.entries()) {
    if (session?.expiresAt && Number(session.expiresAt) < now) {
      deletedTokens.push(token);
      sessions.delete(token);
      csrfTokens.delete(token);
    }
  }
  cleanupExpiredMap(sseSessionTokens, (_k, e, n) => !e?.expiresAt || Number(e.expiresAt) < n);
  cleanupExpiredMap(loginAttempts, isRateLimitEntryStale);
  cleanupExpiredPhoneCodeState();
  return deletedTokens;
}

// --- Storage encryption (AES-256-GCM) for sensitive fields at rest ---
const STORAGE_KEY_ENV = 'STORAGE_ENCRYPT_KEY';
let _storageKey = null;

function _getStorageKey() {
  if (_storageKey) return _storageKey;
  const hex = process.env[STORAGE_KEY_ENV] || '';
  if (!hex || hex.length !== 64) return null;
  _storageKey = Buffer.from(hex, 'hex');
  return _storageKey;
}

function encryptField(plaintext) {
  const key = _getStorageKey();
  if (!key) return plaintext;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return 'ENC:' + Buffer.concat([iv, tag, enc]).toString('base64');
}

function decryptField(stored) {
  if (typeof stored !== 'string' || !stored.startsWith('ENC:')) return stored;
  const key = _getStorageKey();
  if (!key) return stored;
  try {
    const data = Buffer.from(stored.slice(4), 'base64');
    const iv = data.subarray(0, 12);
    const tag = data.subarray(12, 28);
    const enc = data.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  } catch (_) {
    return stored;
  }
}

module.exports = {
  uid, makeSalt, hashPassword, verifyPassword, hashPasswordAsync, verifyPasswordAsync,
  normalizePhone, maskPhone, sanitizePublicUser, ensureUserActiveForAuth,
  issuePhoneCode, consumePhoneCode, cleanupExpiredPhoneCodeState,
  issueCsrfToken, validateCsrf,
  cleanupExpiredMap, isRateLimitEntryStale,
  normalizeIpForThrottle, getClientIp,
  getRateLimitState, recordRateLimitAttempt,
  loginAttempts,
  getLoginAttemptState, recordLoginAttempt,
  getPhoneCodeIpAttemptState, recordPhoneCodeIpAttempt,
  cleanupAuthState,
  EXPOSE_MOCK_PHONE_CODE, TRUST_PROXY,
  csrfTokens,
  phoneCodeIpCooldownStore, PHONE_CODE_IP_COOLDOWN_MS,
  encryptField, decryptField,
};
