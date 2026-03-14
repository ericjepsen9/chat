const crypto = require('crypto');
const { promisify } = require('util');
const { normalizeUserRole } = require('./server_roles');

const scryptAsync = promisify(crypto.scrypt);
// Pre-compiled regexes to avoid re-creation on every call
const RE_PHONE = /^1\d{10}$/;
const RE_NON_DIGIT = /\D+/g;
const RE_IP_CHARS = /^[0-9a-fA-F:.]+$/;

function uid(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function makeSalt() {
  return crypto.randomBytes(16).toString('hex');
}

function hashPassword(password, salt = makeSalt()) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (typeof stored !== 'string' || !stored) return false;
  if (!stored.includes(':')) return String(password) === stored;
  const [salt, hash] = stored.split(':');
  const actual = crypto.scryptSync(String(password), salt, 64).toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(actual, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function hashPasswordAsync(password, salt = makeSalt()) {
  const hash = (await scryptAsync(String(password), salt, 64)).toString('hex');
  return `${salt}:${hash}`;
}

async function verifyPasswordAsync(password, stored) {
  if (typeof stored !== 'string' || !stored) return false;
  if (!stored.includes(':')) return String(password) === stored;
  const [salt, hash] = stored.split(':');
  const actual = (await scryptAsync(String(password), salt, 64)).toString('hex');
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
  return provided === expected;
}
const TRUST_PROXY = process.env.TRUST_PROXY === '1';

function normalizePhone(phone) {
  const raw = String(phone || '').trim();
  const digits = raw.replace(RE_NON_DIGIT, '');
  let normalized = digits;
  if (normalized.length === 13 && normalized[0] === '8' && normalized[1] === '6' && normalized[2] === '1') {
    normalized = normalized.slice(2);
  }
  if (!RE_PHONE.test(normalized)) return '';
  return normalized;
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

function cleanupExpiredPhoneCodeState() {
  cleanupExpiredMap(phoneCodeStore, (_k, r, n) => !r || r.expiresAt < n);
  cleanupExpiredMap(phoneCodeCooldownStore, (_k, v, n) => !v || v < n);
  cleanupExpiredMap(phoneCodeIpCooldownStore, (_k, v, n) => !v || v < n);
  cleanupExpiredMap(phoneCodeVerifyAttempts, isRateLimitEntryStale);
  cleanupExpiredMap(phoneCodeVerifyIpAttempts, isRateLimitEntryStale);
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
  const code = '1234'; // Mock code for testing (SMS service not configured)
  phoneCodeStore.set(key, { code, expiresAt: now + 5 * 60 * 1000 });
  phoneCodeCooldownStore.set(key, now + PHONE_CODE_COOLDOWN_MS);
  phoneCodeVerifyAttempts.delete(key);
  return { ok: true, code, expiresInSec: 300 };
}

function ensureUserActiveForAuth(user) {
  return String(user?.status || 'active') === 'active';
}

function consumePhoneCode(phone, code, scene = 'login') {
  cleanupExpiredPhoneCodeState();
  const normalized = normalizePhone(phone);
  if (!normalized) return { ok: false, error: '验证码错误或已过期' };
  const key = `${scene}:${normalized}`;
  const now = Date.now();
  const attemptState = phoneCodeVerifyAttempts.get(key) || { count: 0, windowStart: now, blockedUntil: 0 };
  if (attemptState.blockedUntil && attemptState.blockedUntil > now) {
    return { ok: false, error: '验证码尝试过多，请稍后再试', retryAfterSec: Math.ceil((attemptState.blockedUntil - now) / 1000) };
  }
  if (now - Number(attemptState.windowStart || now) > 10 * 60 * 1000) {
    attemptState.count = 0;
    attemptState.windowStart = now;
    attemptState.blockedUntil = 0;
  }
  const record = phoneCodeStore.get(key);
  if (!record || record.expiresAt < now) {
    phoneCodeStore.delete(key);
    return { ok: false, error: '验证码错误或已过期' };
  }
  if (String(record.code) !== String(code || '').trim()) {
    const nextCount = Number(attemptState.count || 0) + 1;
    const next = { ...attemptState, count: nextCount, windowStart: attemptState.windowStart || now };
    if (nextCount >= PHONE_CODE_MAX_VERIFY_ATTEMPTS) {
      next.blockedUntil = now + PHONE_CODE_VERIFY_BLOCK_MS;
      phoneCodeStore.delete(key);
    }
    phoneCodeVerifyAttempts.set(key, next);
    return { ok: false, error: '验证码错误或已过期' };
  }
  phoneCodeStore.delete(key);
  phoneCodeVerifyAttempts.delete(key);
  return { ok: true };
}

function maskPhone(phone) {
  const p = String(phone || '');
  if (p.length < 7) return p ? p.replace(/.(?=.{2})/g, '*') : '';
  return p.slice(0, 3) + '****' + p.slice(-4);
}
function sanitizePublicUser(user, { includePhone = false } = {}) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    signature: user.signature,
    avatarUrl: user.avatarUrl,
    appNumberId: user.appNumberId,
    customGroups: user.customGroups,
    role: normalizeUserRole(user),
    status: user.status || 'active',
    paymentCodes: user.paymentCodes || { wechat:'', alipay:'', cloudpay:'' },
    phone: includePhone ? (user.phone || '') : maskPhone(user.phone),
  };
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
  for (const [token, session] of sessions.entries()) {
    if (session?.expiresAt && Number(session.expiresAt) < now) {
      sessions.delete(token);
      csrfTokens.delete(token);
    }
  }
  cleanupExpiredMap(sseSessionTokens, (_k, e, n) => !e?.expiresAt || Number(e.expiresAt) < n);
  cleanupExpiredMap(loginAttempts, isRateLimitEntryStale);
  cleanupExpiredPhoneCodeState();
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
};
