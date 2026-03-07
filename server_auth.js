function purgeUserSessions(sessions, userId) {
  if (!userId) return;
  for (const [token, session] of sessions.entries()) {
    if (session?.userId === userId) sessions.delete(token);
  }
}

function parseAuthToken(req) {
  const auth = req.headers.authorization || '';
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || null;
}

function getAuthUser(req, searchParams, sessions, index) {
  const token = parseAuthToken(req);
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expiresAt && Number(session.expiresAt) < Date.now()) {
    sessions.delete(token);
    return null;
  }
  const user = index.usersById.get(session.userId) || null;
  if (!user) {
    purgeUserSessions(sessions, session.userId);
    return null;
  }
  return user;
}

function requireAuth(req, res, searchParams, sessions, index, sendJson) {
  const user = getAuthUser(req, searchParams, sessions, index);
  if (!user) {
    sendJson(res, 401, { error: 'unauthorized' });
    return null;
  }
  if (String(user.status || 'active') !== 'active') {
    purgeUserSessions(sessions, user.id);
    sendJson(res, 403, { error: 'account_disabled' });
    return null;
  }
  return user;
}

function requireAdmin(req, res, searchParams, sessions, index, sendJson, isAdmin) {
  const user = requireAuth(req, res, searchParams, sessions, index, sendJson);
  if (!user) return null;
  if (!isAdmin(user)) {
    sendJson(res, 403, { error: 'forbidden' });
    return null;
  }
  return user;
}

module.exports = {
  parseAuthToken,
  getAuthUser,
  requireAuth,
  requireAdmin,
};
