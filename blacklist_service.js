function updateBlacklist({ authUser, targetId, action, index, rebuildBlacklistViewsIndex, schedulePersist }) {
  if (action !== 'add' && action !== 'remove') return { ok: false, status: 400, error: 'invalid_action' };
  const target = index.usersById.get(targetId);
  if (!target) return { ok: false, status: 404, error: 'not_found' };
  if (target.id === authUser.id) return { ok: false, status: 400, error: 'cannot_blacklist_self' };

  if (!Array.isArray(authUser.blacklist)) authUser.blacklist = [];
  if (!authUser._blacklistSet) authUser._blacklistSet = new Set(authUser.blacklist);
  if (action === 'add') {
    if (!authUser._blacklistSet.has(target.id)) {
      authUser.blacklist.push(target.id);
      authUser._blacklistSet.add(target.id);
    }
  } else {
    if (authUser._blacklistSet.has(target.id)) {
      authUser._blacklistSet.delete(target.id);
      authUser.blacklist = Array.from(authUser._blacklistSet);
    }
  }

  rebuildBlacklistViewsIndex();
  schedulePersist('blacklist_update', { userId: authUser.id, targetId: target.id, action });
  return { ok: true, status: 200, payload: { ok: true } };
}

module.exports = {
  updateBlacklist,
};
