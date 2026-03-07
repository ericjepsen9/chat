const ADMIN_USERNAMES = new Set(
  String(process.env.ADMIN_USERNAMES || 'alice')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
);

function isAdmin(user) {
  return !!(user && user.role === 'admin');
}

function normalizeUserRole(user) {
  if (!user || typeof user !== 'object') return 'user';
  if (ADMIN_USERNAMES.has(String(user.username || ''))) return 'admin';
  return user.role || 'user';
}

function canAccessConversation(userId, conv) {
  return !!(conv && Array.isArray(conv.members) && conv.members.includes(userId));
}

module.exports = {
  ADMIN_USERNAMES,
  isAdmin,
  normalizeUserRole,
  canAccessConversation,
};
