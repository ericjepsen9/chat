function updateBlacklist({ authUser, targetId, action, index, rebuildBlacklistViewsIndex, schedulePersist }) {
  const target = index.usersById.get(targetId);
  if (!target) return { ok: false, status: 404, error: 'not_found' };

  if (action === 'add') {
    if (!authUser.blacklist.includes(target.id)) authUser.blacklist.push(target.id);
  } else {
    authUser.blacklist = authUser.blacklist.filter((id) => id !== target.id);
  }

  rebuildBlacklistViewsIndex();
  schedulePersist('blacklist_update', { userId: authUser.id, targetId: target.id, action });
  return { ok: true, status: 200, payload: { ok: true } };
}

module.exports = {
  updateBlacklist,
};
