function createGroup({ authUser, rawName, defaultGroup, normalizeSingleGroupName, normalizeUserCustomGroups, rebuildFriendViewsIndex, rebuildConversationBaseIndex, schedulePersist, broadcastToUser }) {
  const groupName = normalizeSingleGroupName(rawName);
  if (!groupName) return { ok: false, status: 400, error: 'invalid_group_name' };
  if (groupName === defaultGroup) return { ok: false, status: 400, error: 'reserved_group' };
  if (!Array.isArray(authUser.customGroups)) authUser.customGroups = [defaultGroup];
  const nextGroups = normalizeUserCustomGroups([...authUser.customGroups, groupName]);
  if (nextGroups.length === authUser.customGroups.length) return { ok: false, status: 400, error: 'group_exists' };
  authUser.customGroups = nextGroups;
  rebuildFriendViewsIndex();
  rebuildConversationBaseIndex();
  schedulePersist('group_create', { userId: authUser.id, groupName });
  broadcastToUser(authUser.id, 'friends_updated', {});
  return { ok: true, status: 200, payload: { groups: authUser.customGroups } };
}

function renameGroup({ authUser, groupNameRaw, newNameRaw, defaultGroup, normalizeSingleGroupName, normalizeUserCustomGroups, friendshipsByUser, rebuildFriendViewsIndex, rebuildConversationBaseIndex, schedulePersist, broadcastToUser }) {
  const groupName = normalizeSingleGroupName(groupNameRaw);
  const newName = normalizeSingleGroupName(newNameRaw);
  if (!groupName || groupName === defaultGroup) return { ok: false, status: 400, error: 'cannot_rename_default_group' };
  if (!newName || newName === defaultGroup) return { ok: false, status: 400, error: 'invalid_group_name' };
  if (!Array.isArray(authUser.customGroups)) authUser.customGroups = [defaultGroup];
  const groupsSet = new Set(authUser.customGroups);
  if (!groupsSet.has(groupName)) return { ok: false, status: 404, error: 'not_found' };
  if (groupsSet.has(newName) && newName !== groupName) return { ok: false, status: 400, error: 'group_exists' };
  authUser.customGroups = normalizeUserCustomGroups((authUser.customGroups || []).map((name) => name === groupName ? newName : name));
  for (const rel of friendshipsByUser.get(authUser.id) || []) {
    if (rel.group === groupName) rel.group = newName;
  }
  rebuildFriendViewsIndex();
  rebuildConversationBaseIndex();
  schedulePersist('group_rename', { userId: authUser.id, groupName, newName });
  broadcastToUser(authUser.id, 'friends_updated', {});
  return { ok: true, status: 200, payload: { groups: authUser.customGroups } };
}

function reorderGroup({ authUser, groupNameRaw, offsetRaw, defaultGroup, normalizeSingleGroupName, normalizeUserCustomGroups, schedulePersist, broadcastToUser }) {
  const groupName = normalizeSingleGroupName(groupNameRaw);
  const offset = Number(offsetRaw || 0);
  if (!groupName || groupName === defaultGroup) return { ok: false, status: 400, error: 'cannot_move_default_group' };
  if (!Array.isArray(authUser.customGroups)) authUser.customGroups = [defaultGroup];
  const groups = authUser.customGroups || [defaultGroup];
  const fromIndex = groups.indexOf(groupName);
  if (fromIndex < 0) return { ok: false, status: 404, error: 'not_found' };
  const toIndex = Math.max(1, Math.min(groups.length - 1, fromIndex + (offset < 0 ? -1 : 1)));
  if (toIndex === fromIndex) return { ok: true, status: 200, payload: { groups } };
  const next = groups.slice();
  const [picked] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, picked);
  authUser.customGroups = normalizeUserCustomGroups(next);
  schedulePersist('group_reorder', { userId: authUser.id, groupName, toIndex });
  broadcastToUser(authUser.id, 'friends_updated', {});
  return { ok: true, status: 200, payload: { groups: authUser.customGroups } };
}

function deleteGroup({ authUser, groupNameRaw, defaultGroup, normalizeSingleGroupName, normalizeUserCustomGroups, friendshipsByUser, rebuildFriendViewsIndex, rebuildConversationBaseIndex, schedulePersist, broadcastToUser }) {
  const groupName = normalizeSingleGroupName(groupNameRaw);
  if (!groupName || groupName === defaultGroup) return { ok: false, status: 400, error: 'cannot_delete_default_group' };
  if (!Array.isArray(authUser.customGroups)) authUser.customGroups = [defaultGroup];
  const groupIdx = authUser.customGroups.indexOf(groupName);
  if (groupIdx === -1) return { ok: false, status: 404, error: 'not_found' };
  // Splice + normalizeUserCustomGroups avoids allocating a full .filter() copy
  const nextGroups = authUser.customGroups.slice();
  nextGroups.splice(groupIdx, 1);
  authUser.customGroups = normalizeUserCustomGroups(nextGroups);
  for (const rel of friendshipsByUser.get(authUser.id) || []) {
    if (rel.group === groupName) rel.group = defaultGroup;
  }
  rebuildFriendViewsIndex();
  rebuildConversationBaseIndex();
  schedulePersist('group_delete', { userId: authUser.id, groupName });
  broadcastToUser(authUser.id, 'friends_updated', {});
  return { ok: true, status: 200, payload: { groups: authUser.customGroups } };
}

module.exports = {
  createGroup,
  renameGroup,
  reorderGroup,
  deleteGroup,
};
