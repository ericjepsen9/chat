function updateBlacklist({ authUser, targetId, action, index, rebuildBlacklistViewsIndex, schedulePersist }) {
  const target = index.usersById.get(targetId);
  if (!target) return { ok: false, status: 404, error: 'not_found' };

  if (!Array.isArray(authUser.blacklist)) authUser.blacklist = [];
  if (action === 'add') {
    if (!authUser.blacklist.includes(target.id)) authUser.blacklist.push(target.id);
  } else {
    const idx = authUser.blacklist.indexOf(target.id);
    if (idx !== -1) authUser.blacklist.splice(idx, 1);
  }

  rebuildBlacklistViewsIndex();
  schedulePersist('blacklist_update', { userId: authUser.id, targetId: target.id, action });
  return { ok: true, status: 200, payload: { ok: true } };
}

module.exports = {
  updateBlacklist,
};
