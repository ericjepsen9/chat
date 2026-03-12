/* server_routes_auth.js — Authentication route handlers */

module.exports = function createAuthRoutes(ctx) {
  const {
    matchRoute, sendJson, parseBody, getAuthedUser,
    issueSession, revokeSessionsForUser, parseAuthToken,
    normalizePhone, findUserByPhone, sanitizePublicUser,
    ensureUserActiveForAuth, issueCsrfToken, validateCsrf,
    hashPasswordAsync, verifyPasswordAsync,
    issuePhoneCode, consumePhoneCode,
    getClientIp, getLoginAttemptState, recordLoginAttempt,
    getPhoneCodeIpAttemptState, recordPhoneCodeIpAttempt,
    phoneCodeIpCooldownStore, PHONE_CODE_IP_COOLDOWN_MS,
    generateUniqueAppNumberId, indexNewUser, uid,
    db, sessions, csrfTokens,
    schedulePersistCritical, broadcastAll,
  } = ctx;

  return async function handleAuthRoutes(pathname, method, req, res, searchParams) {

    if (matchRoute(pathname, '/api/login') && method === 'POST') {
      const body = await parseBody(req);
      const username = String(body.username || body.phone || '').trim();
      const loginPhone = normalizePhone(body.phone || username);
      const user = ctx.index.usersByName.get(username) || (loginPhone ? findUserByPhone(loginPhone) : null);
      const attemptKey = `${username || loginPhone}:${getClientIp(req)}`;
      const attemptState = getLoginAttemptState(attemptKey);
      if (attemptState.blockedUntil && attemptState.blockedUntil > Date.now()) {
        return sendJson(res, 429, { error: '登录尝试过多，请稍后再试' });
      }
      if (!user || !(await verifyPasswordAsync(body.password, user.password))) {
        recordLoginAttempt(attemptKey, false);
        if (user && !user.password) {
          return sendJson(res, 401, { error: '该账号未设置密码，请使用手机验证码登录' });
        }
        return sendJson(res, 401, { error: '账号或密码错误' });
      }
      if (!ensureUserActiveForAuth(user)) {
        return sendJson(res, 403, { error: 'account_disabled' });
      }
      recordLoginAttempt(attemptKey, true);
      if (!user.password.includes(':')) {
        user.password = await hashPasswordAsync(body.password);
        await schedulePersistCritical('migrate_password', { userId: user.id });
      }
      const token = issueSession(user.id);
      const csrfToken = issueCsrfToken(token);
      return sendJson(res, 200, { token, csrfToken, user: sanitizePublicUser(user, { includePhone: true }) });
    }

    if (matchRoute(pathname, '/api/auth/send-code') && method === 'POST') {
      const body = await parseBody(req);
      const phone = normalizePhone(body.phone || '');
      const scene = String(body.scene || 'login');
      if (!phone) return sendJson(res, 400, { error: '手机号格式错误' });
      if (!['login','reset','register'].includes(scene)) return sendJson(res, 400, { error: '验证码场景不支持' });
      const clientIp = getClientIp(req);
      if (clientIp) {
        const ipCooldownUntil = Number(phoneCodeIpCooldownStore.get(clientIp) || 0);
        if (ipCooldownUntil > Date.now()) {
          return sendJson(res, 429, { error: '请求过于频繁，请稍后再试', retryAfterSec: Math.ceil((ipCooldownUntil - Date.now()) / 1000) });
        }
        phoneCodeIpCooldownStore.set(clientIp, Date.now() + PHONE_CODE_IP_COOLDOWN_MS);
      }
      const issueResult = issuePhoneCode(phone, scene);
      if (!issueResult.ok) {
        return sendJson(res, 429, { error: issueResult.error || '发送验证码失败', retryAfterSec: issueResult.retryAfterSec || 0 });
      }
      return sendJson(res, 200, { ok: true, expiresInSec: issueResult.expiresInSec });
    }

    if (matchRoute(pathname, '/api/login/phone-code') && method === 'POST') {
      const body = await parseBody(req);
      const phone = normalizePhone(body.phone || '');
      const code = String(body.code || '').trim();
      const clientIp = getClientIp(req);
      const ipAttempt = getPhoneCodeIpAttemptState(clientIp);
      if (ipAttempt.blockedUntil && ipAttempt.blockedUntil > Date.now()) {
        return sendJson(res, 429, { error: '验证码尝试过多，请稍后再试', retryAfterSec: Math.ceil((ipAttempt.blockedUntil - Date.now()) / 1000) });
      }
      if (!phone || !/^\d{4}$/.test(code)) return sendJson(res, 400, { error: '验证码错误或已过期' });
      const codeResult = consumePhoneCode(phone, code, 'login');
      if (!codeResult.ok) {
        recordPhoneCodeIpAttempt(clientIp, false);
        const statusCode = codeResult.retryAfterSec ? 429 : 400;
        return sendJson(res, statusCode, { error: codeResult.error || '验证码错误或已过期', retryAfterSec: codeResult.retryAfterSec || 0 });
      }
      recordPhoneCodeIpAttempt(clientIp, true);
      let user = findUserByPhone(phone);
      if (user && !ensureUserActiveForAuth(user)) return sendJson(res, 403, { error: 'account_disabled' });
      // Auto-register if phone is not registered
      if (!user) {
        user = {
          id: uid('u'),
          username: phone,
          password: '',
          displayName: `用户${phone.slice(-4)}`,
          signature: '暂未填写签名',
          avatarUrl: null,
          products: [],
          blacklist: [],
          customGroups: ['我的好友'],
          appNumberId: generateUniqueAppNumberId(),
          createdAt: Date.now(),
          role: 'user',
          status: 'active',
          paymentCodes: { wechat: '', alipay: '', cloudpay: '' },
          phone,
        };
        db.users.push(user);
        indexNewUser(user);
        await schedulePersistCritical('register', { userId: user.id });
        broadcastAll('users_updated', { userId: user.id });
      }
      const token = issueSession(user.id);
      const csrfToken = issueCsrfToken(token);
      return sendJson(res, 200, { token, csrfToken, user: sanitizePublicUser(user, { includePhone: true }) });
    }

    if (matchRoute(pathname, '/api/password/forgot') && method === 'POST') {
      const body = await parseBody(req);
      const phone = normalizePhone(body.phone || '');
      const code = String(body.code || '').trim();
      const nextPassword = String(body.newPassword || '');
      const clientIp = getClientIp(req);
      const ipAttempt = getPhoneCodeIpAttemptState(clientIp);
      if (ipAttempt.blockedUntil && ipAttempt.blockedUntil > Date.now()) {
        return sendJson(res, 429, { error: '验证码尝试过多，请稍后再试', retryAfterSec: Math.ceil((ipAttempt.blockedUntil - Date.now()) / 1000) });
      }
      if (!nextPassword) return sendJson(res, 400, { error: '参数不完整' });
      if (nextPassword.length < 8) return sendJson(res, 400, { error: '新密码至少8位' });
      if (nextPassword.length > 128) return sendJson(res, 400, { error: '密码长度不能超过128位' });
      if (!phone || !/^\d{4}$/.test(code)) return sendJson(res, 400, { error: '验证码错误或已过期' });
      const user = findUserByPhone(phone);
      if (!user) return sendJson(res, 400, { error: '验证码错误或已过期' });
      const codeResult = consumePhoneCode(phone, code, 'reset');
      if (!codeResult.ok) {
        recordPhoneCodeIpAttempt(clientIp, false);
        const statusCode = codeResult.retryAfterSec ? 429 : 400;
        return sendJson(res, statusCode, { error: codeResult.error || '验证码错误或已过期', retryAfterSec: codeResult.retryAfterSec || 0 });
      }
      recordPhoneCodeIpAttempt(clientIp, true);
      if (await verifyPasswordAsync(nextPassword, user.password)) {
        return sendJson(res, 400, { error: '新密码不能与旧密码相同' });
      }
      user.password = await hashPasswordAsync(nextPassword);
      revokeSessionsForUser(user.id);
      await schedulePersistCritical('password_forgot_reset', { userId: user.id });
      return sendJson(res, 200, { ok: true });
    }

    if (matchRoute(pathname, '/api/password/change') && method === 'POST') {
      const authUser = getAuthedUser(req, res, { searchParams });
      if (!authUser) return true;
      const body = await parseBody(req);
      if (!authUser.password) {
        return sendJson(res, 400, { error: '当前账号未设置密码，请通过忘记密码功能设置新密码' });
      }
      if (!(await verifyPasswordAsync(body.oldPassword, authUser.password))) {
        return sendJson(res, 400, { error: '旧密码错误' });
      }
      const nextPassword = String(body.newPassword || '');
      if (String(body.oldPassword || '') === nextPassword) {
        return sendJson(res, 400, { error: '新密码不能与旧密码相同' });
      }
      if (nextPassword.length < 8) return sendJson(res, 400, { error: '新密码至少8位' });
      if (nextPassword.length > 128) return sendJson(res, 400, { error: '密码长度不能超过128位' });
      authUser.password = await hashPasswordAsync(nextPassword);
      revokeSessionsForUser(authUser.id);
      const token = issueSession(authUser.id);
      const csrfToken = issueCsrfToken(token);
      await schedulePersistCritical('password_change', { userId: authUser.id });
      return sendJson(res, 200, { ok: true, token, csrfToken });
    }

    if (matchRoute(pathname, '/api/logout') && method === 'POST') {
      const authUser = getAuthedUser(req, res);
      if (!authUser) return true;
      const token = parseAuthToken(req, searchParams);
      if (token) { sessions.delete(token); csrfTokens.delete(token); }
      return sendJson(res, 200, { ok: true });
    }

    if (matchRoute(pathname, '/api/register') && method === 'POST') {
      const body = await parseBody(req);
      if (!body.displayName || !body.password) return sendJson(res, 400, { error: '请填写完整信息' });
      const displayName = String(body.displayName).trim();
      if (!displayName) return sendJson(res, 400, { error: '昵称不能为空' });
      if (String(body.password || '').length < 8) {
        return sendJson(res, 400, { error: '密码至少8位' });
      }
      const phone = normalizePhone(body.phone || '');
      if (!phone) return sendJson(res, 400, { error: '请填写有效手机号' });
      const username = phone;
      const regCode = String(body.code || '').trim();
      if (!regCode) return sendJson(res, 400, { error: '请输入验证码' });
      const codeResult = consumePhoneCode(phone, regCode, 'register');
      if (!codeResult.ok) {
        const fallbackResult = consumePhoneCode(phone, regCode, 'login');
        if (!fallbackResult.ok) {
          return sendJson(res, 400, { error: fallbackResult.error || '验证码错误或已过期' });
        }
      }
      if (ctx.index.usersByName.has(username)) return sendJson(res, 409, { error: '该手机号已被注册' });
      if (findUserByPhone(phone)) return sendJson(res, 409, { error: '该手机号已被注册' });
      if (String(body.password || '').length > 128) return sendJson(res, 400, { error: '密码长度不能超过128位' });
      const hashedPassword = await hashPasswordAsync(body.password);
      if (ctx.index.usersByName.has(username) || findUserByPhone(phone)) return sendJson(res, 409, { error: '该手机号已被注册' });
      const user = {
        id: uid('u'),
        username,
        password: hashedPassword,
        displayName,
        signature: '暂未填写签名',
        avatarUrl: null,
        products: [],
        blacklist: [],
        customGroups: ['我的好友'],
        appNumberId: generateUniqueAppNumberId(),
        createdAt: Date.now(),
        role: 'user',
        status: 'active',
        paymentCodes: { wechat:'', alipay:'', cloudpay:'' },
        phone,
      };
      db.users.push(user);
      indexNewUser(user);
      await schedulePersistCritical('register', { userId: user.id });
      const token = issueSession(user.id);
      const csrfToken = issueCsrfToken(token);
      broadcastAll('users_updated', { userId: user.id });
      return sendJson(res, 201, { token, csrfToken, user: sanitizePublicUser(user, { includePhone: true }) });
    }

    return false; // not handled
  };
};
