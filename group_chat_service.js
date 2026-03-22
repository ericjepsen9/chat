/* group_chat_service.js — Group chat business logic */

const MAX_GROUP_MEMBERS = 500;
const MAX_GROUP_NAME_LEN = 32;
const MAX_NICKNAME_LEN = 20;
const MAX_ANNOUNCEMENT_LEN = 500;
const INVITE_CONFIRM_THRESHOLD = 40;

function createGroupChat({ authUser, memberIds, name, uid, db, index, addToMapArray, indexNewConversation, schedulePersist, broadcastToUser, broadcastToConversation }) {
  if (!Array.isArray(memberIds) || memberIds.length < 2) {
    return { ok: false, status: 400, error: '至少选择2个好友创建群聊' };
  }
  // Deduplicate and validate members
  const memberSet = new Set([authUser.id]);
  for (const id of memberIds) {
    if (!id || !index.usersById.has(id)) continue;
    if (id === authUser.id) continue;
    memberSet.add(id);
  }
  if (memberSet.size < 3) {
    return { ok: false, status: 400, error: '群聊至少需要3个成员' };
  }
  if (memberSet.size > MAX_GROUP_MEMBERS) {
    return { ok: false, status: 400, error: `群成员不能超过${MAX_GROUP_MEMBERS}人` };
  }

  const members = Array.from(memberSet);
  // Build default name from first few members
  let groupName = '';
  if (name && String(name).trim()) {
    groupName = String(name).trim().slice(0, MAX_GROUP_NAME_LEN);
  } else {
    const names = [];
    for (const mid of members) {
      if (names.length >= 4) break;
      const u = index.usersById.get(mid);
      if (u) names.push(u.displayName || u.username || '用户');
    }
    groupName = names.join('、');
    if (groupName.length > MAX_GROUP_NAME_LEN) groupName = groupName.slice(0, MAX_GROUP_NAME_LEN);
  }

  const now = Date.now();
  const conv = {
    id: uid('gc'),
    type: 'group',
    name: groupName,
    avatarUrl: '',
    ownerId: authUser.id,
    admins: [],
    members,
    memberNicknames: {},
    announcement: '',
    inviteConfirm: false,
    mutedMembers: [],
    mutedBy: [],
    pinnedBy: [],
    lastRead: {},
    clearedAt: {},
    maxMembers: MAX_GROUP_MEMBERS,
    createdAt: now,
    lastMessageAt: now,
  };

  db.conversations.push(conv);
  indexNewConversation(conv);

  // Create system message
  const senderName = authUser.displayName || authUser.username || '用户';
  const invitedNames = [];
  for (const mid of members) {
    if (mid === authUser.id) continue;
    const u = index.usersById.get(mid);
    invitedNames.push(u?.displayName || u?.username || '用户');
  }
  const sysMsg = {
    id: uid('m'),
    conversationId: conv.id,
    senderId: authUser.id,
    type: 'system',
    text: `${senderName} 创建了群聊`,
    deletedBy: [],
    createdAt: now,
  };
  db.messages.push(sysMsg);
  addToMapArray(index.messagesByConv, conv.id, sysMsg);
  index.messagesById.set(sysMsg.id, sysMsg);

  schedulePersist('group_chat_create', { conversationId: conv.id });
  for (const mid of members) {
    broadcastToUser(mid, 'conversation_updated', {});
  }

  return { ok: true, status: 201, payload: { conversation: conv } };
}

function getGroupChatDetail({ convId, authUser, index }) {
  const conv = index.convById.get(convId);
  if (!conv || conv.type !== 'group') return { ok: false, status: 404, error: 'not_found' };
  if (!conv._memberSet || !conv._memberSet.has(authUser.id)) return { ok: false, status: 403, error: 'forbidden' };

  // Build member list with user info
  const memberList = [];
  for (const mid of conv.members) {
    const u = index.usersById.get(mid);
    if (!u) continue;
    memberList.push({
      id: u.id,
      displayName: u.displayName || u.username,
      avatarUrl: u.avatarUrl,
      appNumberId: u.appNumberId,
      nickname: (conv.memberNicknames && conv.memberNicknames[mid]) || '',
      isOwner: mid === conv.ownerId,
      isAdmin: Array.isArray(conv.admins) && conv.admins.includes(mid),
    });
  }

  return {
    ok: true, status: 200,
    payload: {
      id: conv.id,
      name: conv.name,
      avatarUrl: conv.avatarUrl || '',
      ownerId: conv.ownerId,
      admins: conv.admins || [],
      members: memberList,
      memberCount: conv.members.length,
      announcement: conv.announcement || '',
      inviteConfirm: !!conv.inviteConfirm,
      myNickname: (conv.memberNicknames && conv.memberNicknames[authUser.id]) || '',
      muted: conv._mutedBySet ? conv._mutedBySet.has(authUser.id) : false,
      pinned: conv._pinnedBySet ? conv._pinnedBySet.has(authUser.id) : false,
      createdAt: conv.createdAt,
    }
  };
}

function updateGroupChat({ convId, authUser, body, index, uid, db, addToMapArray, invalidateConvMeta, schedulePersist, broadcastToConversation }) {
  const conv = index.convById.get(convId);
  if (!conv || conv.type !== 'group') return { ok: false, status: 404, error: 'not_found' };
  if (!conv._memberSet || !conv._memberSet.has(authUser.id)) return { ok: false, status: 403, error: 'forbidden' };

  const isOwner = conv.ownerId === authUser.id;
  const isAdmin = isOwner || (Array.isArray(conv.admins) && conv.admins.includes(authUser.id));
  const senderName = authUser.displayName || authUser.username || '用户';
  const now = Date.now();

  if (body.name !== undefined) {
    const newName = String(body.name).trim().slice(0, MAX_GROUP_NAME_LEN);
    if (!newName) return { ok: false, status: 400, error: '群名不能为空' };
    conv.name = newName;
    // System message
    const sysMsg = { id: uid('m'), conversationId: conv.id, senderId: authUser.id, type: 'system', text: `${senderName} 修改群名为 "${newName}"`, deletedBy: [], createdAt: now };
    db.messages.push(sysMsg);
    addToMapArray(index.messagesByConv, conv.id, sysMsg);
    index.messagesById.set(sysMsg.id, sysMsg);
    conv.lastMessageAt = now;
  }

  if (body.announcement !== undefined) {
    if (!isAdmin) return { ok: false, status: 403, error: '仅群主和管理员可修改群公告' };
    conv.announcement = String(body.announcement).trim().slice(0, MAX_ANNOUNCEMENT_LEN);
    const sysMsg = { id: uid('m'), conversationId: conv.id, senderId: authUser.id, type: 'system', text: `${senderName} 修改了群公告`, deletedBy: [], createdAt: now };
    db.messages.push(sysMsg);
    addToMapArray(index.messagesByConv, conv.id, sysMsg);
    index.messagesById.set(sysMsg.id, sysMsg);
    conv.lastMessageAt = now;
  }

  if (body.inviteConfirm !== undefined && isOwner) {
    conv.inviteConfirm = !!body.inviteConfirm;
  }

  if (typeof invalidateConvMeta === 'function') invalidateConvMeta(conv.id);
  schedulePersist('group_chat_update', { conversationId: conv.id });
  broadcastToConversation(conv.id, 'conversation_updated', { conversationId: conv.id });

  return { ok: true, status: 200, payload: { ok: true } };
}

function addGroupMembers({ convId, authUser, memberIds, index, uid, db, addToMapArray, invalidateConvMeta, schedulePersist, broadcastToUser, broadcastToConversation }) {
  const conv = index.convById.get(convId);
  if (!conv || conv.type !== 'group') return { ok: false, status: 404, error: 'not_found' };
  if (!conv._memberSet || !conv._memberSet.has(authUser.id)) return { ok: false, status: 403, error: 'forbidden' };

  const isOwner = conv.ownerId === authUser.id;
  const isAdmin = isOwner || (Array.isArray(conv.admins) && conv.admins.includes(authUser.id));

  // If inviteConfirm is on and user is not admin, deny
  if (conv.inviteConfirm && !isAdmin) {
    return { ok: false, status: 403, error: '需要群主或管理员确认才能邀请' };
  }
  // Over threshold, need admin
  if (conv.members.length >= INVITE_CONFIRM_THRESHOLD && !isAdmin) {
    return { ok: false, status: 403, error: '群成员超过40人，需群主或管理员邀请' };
  }

  if (!Array.isArray(memberIds) || !memberIds.length) {
    return { ok: false, status: 400, error: '请选择要邀请的成员' };
  }

  const added = [];
  for (const mid of memberIds) {
    if (!mid || !index.usersById.has(mid) || conv._memberSet.has(mid)) continue;
    if (conv.members.length >= (conv.maxMembers || MAX_GROUP_MEMBERS)) break;
    conv.members.push(mid);
    conv._memberSet.add(mid);
    // Add to convByUser index
    addToMapArray(index.convByUser, mid, conv);
    const u = index.usersById.get(mid);
    added.push(u?.displayName || u?.username || '用户');
  }

  if (!added.length) return { ok: true, status: 200, payload: { ok: true, added: 0 } };

  const senderName = authUser.displayName || authUser.username || '用户';
  const now = Date.now();
  const sysMsg = {
    id: uid('m'), conversationId: conv.id, senderId: authUser.id, type: 'system',
    text: `${senderName} 邀请 ${added.join('、')} 加入了群聊`,
    deletedBy: [], createdAt: now,
  };
  db.messages.push(sysMsg);
  addToMapArray(index.messagesByConv, conv.id, sysMsg);
  index.messagesById.set(sysMsg.id, sysMsg);
  conv.lastMessageAt = now;

  if (typeof invalidateConvMeta === 'function') invalidateConvMeta(conv.id);
  schedulePersist('group_member_add', { conversationId: conv.id });
  // Notify all members including new ones
  for (const mid of conv.members) {
    broadcastToUser(mid, 'conversation_updated', { conversationId: conv.id });
  }

  return { ok: true, status: 200, payload: { ok: true, added: added.length } };
}

function removeGroupMember({ convId, authUser, memberId, index, uid, db, addToMapArray, invalidateConvMeta, schedulePersist, broadcastToUser, broadcastToConversation }) {
  const conv = index.convById.get(convId);
  if (!conv || conv.type !== 'group') return { ok: false, status: 404, error: 'not_found' };
  if (!conv._memberSet || !conv._memberSet.has(authUser.id)) return { ok: false, status: 403, error: 'forbidden' };

  const isOwner = conv.ownerId === authUser.id;
  const isAdmin = isOwner || (Array.isArray(conv.admins) && conv.admins.includes(authUser.id));
  if (!isAdmin) return { ok: false, status: 403, error: '仅群主和管理员可移除成员' };
  if (memberId === conv.ownerId) return { ok: false, status: 403, error: '不能移除群主' };
  if (!isOwner && Array.isArray(conv.admins) && conv.admins.includes(memberId)) {
    return { ok: false, status: 403, error: '管理员不能移除其他管理员' };
  }
  if (!conv._memberSet.has(memberId)) return { ok: false, status: 400, error: '该用户不在群中' };

  // Remove from members
  conv.members = conv.members.filter(m => m !== memberId);
  conv._memberSet.delete(memberId);
  // Remove from admins if applicable
  if (Array.isArray(conv.admins)) conv.admins = conv.admins.filter(a => a !== memberId);
  // Remove from convByUser
  const userConvs = index.convByUser.get(memberId);
  if (userConvs) {
    const idx = userConvs.indexOf(conv);
    if (idx >= 0) userConvs.splice(idx, 1);
  }

  const removedUser = index.usersById.get(memberId);
  const removedName = removedUser?.displayName || removedUser?.username || '用户';
  const now = Date.now();
  const sysMsg = {
    id: uid('m'), conversationId: conv.id, senderId: authUser.id, type: 'system',
    text: `${removedName} 被移出了群聊`,
    deletedBy: [], createdAt: now,
  };
  db.messages.push(sysMsg);
  addToMapArray(index.messagesByConv, conv.id, sysMsg);
  index.messagesById.set(sysMsg.id, sysMsg);
  conv.lastMessageAt = now;

  if (typeof invalidateConvMeta === 'function') invalidateConvMeta(conv.id);
  schedulePersist('group_member_remove', { conversationId: conv.id });
  broadcastToUser(memberId, 'conversation_updated', {});
  broadcastToConversation(conv.id, 'conversation_updated', { conversationId: conv.id });

  return { ok: true, status: 200, payload: { ok: true } };
}

function leaveGroupChat({ convId, authUser, index, uid, db, addToMapArray, invalidateConvMeta, schedulePersist, broadcastToUser, broadcastToConversation }) {
  const conv = index.convById.get(convId);
  if (!conv || conv.type !== 'group') return { ok: false, status: 404, error: 'not_found' };
  if (!conv._memberSet || !conv._memberSet.has(authUser.id)) return { ok: false, status: 403, error: 'forbidden' };

  if (conv.ownerId === authUser.id) {
    return { ok: false, status: 400, error: '群主退出前请先转让群主' };
  }

  conv.members = conv.members.filter(m => m !== authUser.id);
  conv._memberSet.delete(authUser.id);
  if (Array.isArray(conv.admins)) conv.admins = conv.admins.filter(a => a !== authUser.id);
  const userConvs = index.convByUser.get(authUser.id);
  if (userConvs) {
    const idx = userConvs.indexOf(conv);
    if (idx >= 0) userConvs.splice(idx, 1);
  }

  const senderName = authUser.displayName || authUser.username || '用户';
  const now = Date.now();
  const sysMsg = {
    id: uid('m'), conversationId: conv.id, senderId: authUser.id, type: 'system',
    text: `${senderName} 退出了群聊`,
    deletedBy: [], createdAt: now,
  };
  db.messages.push(sysMsg);
  addToMapArray(index.messagesByConv, conv.id, sysMsg);
  index.messagesById.set(sysMsg.id, sysMsg);
  conv.lastMessageAt = now;

  if (typeof invalidateConvMeta === 'function') invalidateConvMeta(conv.id);
  schedulePersist('group_member_leave', { conversationId: conv.id });
  broadcastToUser(authUser.id, 'conversation_updated', {});
  broadcastToConversation(conv.id, 'conversation_updated', { conversationId: conv.id });

  return { ok: true, status: 200, payload: { ok: true } };
}

function dismissGroupChat({ convId, authUser, index, uid, db, addToMapArray, invalidateConvMeta, schedulePersist, broadcastToUser, broadcastToConversation }) {
  const conv = index.convById.get(convId);
  if (!conv || conv.type !== 'group') return { ok: false, status: 404, error: 'not_found' };
  if (conv.ownerId !== authUser.id) return { ok: false, status: 403, error: '仅群主可解散群聊' };

  const now = Date.now();
  const sysMsg = {
    id: uid('m'), conversationId: conv.id, senderId: authUser.id, type: 'system',
    text: '群主已解散该群聊',
    deletedBy: [], createdAt: now,
  };
  db.messages.push(sysMsg);
  addToMapArray(index.messagesByConv, conv.id, sysMsg);
  index.messagesById.set(sysMsg.id, sysMsg);
  conv.lastMessageAt = now;

  // Notify all members before removing
  const membersCopy = [...conv.members];
  for (const mid of membersCopy) {
    broadcastToUser(mid, 'conversation_updated', { conversationId: conv.id, dismissed: true });
  }

  // Remove members from convByUser
  for (const mid of membersCopy) {
    const userConvs = index.convByUser.get(mid);
    if (userConvs) {
      const idx = userConvs.indexOf(conv);
      if (idx >= 0) userConvs.splice(idx, 1);
    }
  }

  // Mark as dismissed rather than deleting (keep history)
  conv.members = [];
  conv._memberSet = new Set();
  conv.dismissed = true;

  if (typeof invalidateConvMeta === 'function') invalidateConvMeta(conv.id);
  schedulePersist('group_chat_dismiss', { conversationId: conv.id });

  return { ok: true, status: 200, payload: { ok: true } };
}

function transferGroupOwner({ convId, authUser, newOwnerId, index, uid, db, addToMapArray, schedulePersist, broadcastToConversation }) {
  const conv = index.convById.get(convId);
  if (!conv || conv.type !== 'group') return { ok: false, status: 404, error: 'not_found' };
  if (conv.ownerId !== authUser.id) return { ok: false, status: 403, error: '仅群主可转让' };
  if (!conv._memberSet || !conv._memberSet.has(newOwnerId)) return { ok: false, status: 400, error: '目标用户不在群中' };

  const oldOwnerName = authUser.displayName || authUser.username || '用户';
  const newOwner = index.usersById.get(newOwnerId);
  const newOwnerName = newOwner?.displayName || newOwner?.username || '用户';

  conv.ownerId = newOwnerId;
  // Remove new owner from admins if they were one
  if (Array.isArray(conv.admins)) conv.admins = conv.admins.filter(a => a !== newOwnerId);

  const now = Date.now();
  const sysMsg = {
    id: uid('m'), conversationId: conv.id, senderId: authUser.id, type: 'system',
    text: `${oldOwnerName} 将群主转让给了 ${newOwnerName}`,
    deletedBy: [], createdAt: now,
  };
  db.messages.push(sysMsg);
  addToMapArray(index.messagesByConv, conv.id, sysMsg);
  index.messagesById.set(sysMsg.id, sysMsg);
  conv.lastMessageAt = now;

  schedulePersist('group_owner_transfer', { conversationId: conv.id });
  broadcastToConversation(conv.id, 'conversation_updated', { conversationId: conv.id });

  return { ok: true, status: 200, payload: { ok: true } };
}

function setGroupAdmin({ convId, authUser, targetId, isAdmin, index, schedulePersist, broadcastToConversation }) {
  const conv = index.convById.get(convId);
  if (!conv || conv.type !== 'group') return { ok: false, status: 404, error: 'not_found' };
  if (conv.ownerId !== authUser.id) return { ok: false, status: 403, error: '仅群主可设置管理员' };
  if (!conv._memberSet || !conv._memberSet.has(targetId)) return { ok: false, status: 400, error: '该用户不在群中' };
  if (targetId === conv.ownerId) return { ok: false, status: 400, error: '群主不需要设置为管理员' };

  if (!Array.isArray(conv.admins)) conv.admins = [];
  const idx = conv.admins.indexOf(targetId);

  if (isAdmin && idx < 0) {
    conv.admins.push(targetId);
  } else if (!isAdmin && idx >= 0) {
    conv.admins.splice(idx, 1);
  }

  schedulePersist('group_admin_set', { conversationId: conv.id });
  broadcastToConversation(conv.id, 'conversation_updated', { conversationId: conv.id });

  return { ok: true, status: 200, payload: { ok: true } };
}

function setGroupNickname({ convId, authUser, nickname, index, schedulePersist, broadcastToConversation }) {
  const conv = index.convById.get(convId);
  if (!conv || conv.type !== 'group') return { ok: false, status: 404, error: 'not_found' };
  if (!conv._memberSet || !conv._memberSet.has(authUser.id)) return { ok: false, status: 403, error: 'forbidden' };

  if (!conv.memberNicknames) conv.memberNicknames = {};
  const trimmed = String(nickname || '').trim().slice(0, MAX_NICKNAME_LEN);
  if (trimmed) {
    conv.memberNicknames[authUser.id] = trimmed;
  } else {
    delete conv.memberNicknames[authUser.id];
  }

  schedulePersist('group_nickname_set', { conversationId: conv.id });
  broadcastToConversation(conv.id, 'conversation_updated', { conversationId: conv.id });

  return { ok: true, status: 200, payload: { ok: true } };
}

function muteGroupMember({ convId, authUser, targetId, mute, index, schedulePersist, broadcastToConversation }) {
  const conv = index.convById.get(convId);
  if (!conv || conv.type !== 'group') return { ok: false, status: 404, error: 'not_found' };
  const isOwner = conv.ownerId === authUser.id;
  const isAdmin = isOwner || (Array.isArray(conv.admins) && conv.admins.includes(authUser.id));
  if (!isAdmin) return { ok: false, status: 403, error: '仅群主和管理员可禁言' };
  if (targetId === conv.ownerId) return { ok: false, status: 400, error: '不能禁言群主' };

  if (!Array.isArray(conv.mutedMembers)) conv.mutedMembers = [];
  const idx = conv.mutedMembers.indexOf(targetId);

  if (mute && idx < 0) {
    conv.mutedMembers.push(targetId);
  } else if (!mute && idx >= 0) {
    conv.mutedMembers.splice(idx, 1);
  }

  schedulePersist('group_mute_member', { conversationId: conv.id });
  broadcastToConversation(conv.id, 'conversation_updated', { conversationId: conv.id });

  return { ok: true, status: 200, payload: { ok: true } };
}

module.exports = {
  createGroupChat,
  getGroupChatDetail,
  updateGroupChat,
  addGroupMembers,
  removeGroupMember,
  leaveGroupChat,
  dismissGroupChat,
  transferGroupOwner,
  setGroupAdmin,
  setGroupNickname,
  muteGroupMember,
};
