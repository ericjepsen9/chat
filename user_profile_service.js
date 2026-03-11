function normalizeText(value, maxLen) {
  return String(value || '').trim().slice(0, maxLen);
}

function normalizeAvatarUrl(value) {
  if (value === null || value === undefined || value === '') return null;
  const url = String(value).trim().slice(0, 512);
  if (!url) return null;
  if (/^https?:\/\//i.test(url) || url.startsWith('/uploads/')) return url;
  return null;
}


function normalizePaymentCodes(value) {
  const src = value && typeof value === 'object' ? value : {};
  const keep = (v) => {
    const t = String(v || '').trim().slice(0, 512);
    if (!t) return '';
    if (/^https?:\/\//i.test(t) || t.startsWith('/uploads/')) return t;
    return '';
  };
  return {
    wechat: keep(src.wechat),
    alipay: keep(src.alipay),
    cloudpay: keep(src.cloudpay),
  };
}

function updateUserProfile({ authUser, body, normalizeUserCustomGroups, normalizePhone, findUserByPhone, rebuildFriendViewsIndex, rebuildConversationBaseIndex, rebuildRequestViewsIndex, rebuildBlacklistViewsIndex, rebuildMallIndex, schedulePersist, broadcastToUser, broadcastAll, sanitizePublicUser }) {
  if (body.displayName !== undefined) {
    const next = normalizeText(body.displayName, 40);
    authUser.displayName = next || authUser.displayName;
  }
  if (body.signature !== undefined) authUser.signature = normalizeText(body.signature, 160);
  if (body.avatarUrl !== undefined) authUser.avatarUrl = normalizeAvatarUrl(body.avatarUrl);
  if (body.phone !== undefined) {
    const nextPhone = normalizePhone(body.phone || '');
    if (!nextPhone) return { ok: false, status: 400, error: '手机号格式错误' };
    const existing = findUserByPhone(nextPhone);
    if (existing && existing.id !== authUser.id) return { ok: false, status: 409, error: '该手机号已被注册' };
    authUser.phone = nextPhone;
  }
  if (Array.isArray(body.customGroups)) authUser.customGroups = normalizeUserCustomGroups(body.customGroups);
  if (body.paymentCodes !== undefined) authUser.paymentCodes = normalizePaymentCodes(body.paymentCodes);

  rebuildFriendViewsIndex();
  rebuildConversationBaseIndex();
  rebuildRequestViewsIndex();
  rebuildBlacklistViewsIndex();
  rebuildMallIndex();

  schedulePersist('user_update', { userId: authUser.id });
  broadcastToUser(authUser.id, 'profile_updated', {});
  broadcastAll('mall_updated', {});

  return { ok: true, status: 200, payload: { user: sanitizePublicUser(authUser, { includePhone: true }) } };
}

function buildUserProfileView({ authUser, targetId, usersById, friendshipByPair }) {
  const target = usersById.get(targetId);
  if (!target) return { ok: false, status: 404, error: 'not_found' };
  const rel = friendshipByPair.get(`${authUser.id}:${targetId}`);
  const profile = {
    id: target.id,
    username: target.username,
    nickname: target.displayName,
    avatarUrl: target.avatarUrl,
    signature: target.signature,
    appNumberId: target.appNumberId,
    phone: authUser.id === target.id ? (target.phone || '') : '',
    remarkName: rel?.remark || '',
    groupName: rel?.group || '',
    isFriend: !!rel,
    customGroups: authUser.customGroups,
    paymentCodes: authUser.id === target.id ? (target.paymentCodes || { wechat:'', alipay:'', cloudpay:'' }) : undefined,
  };
  return { ok: true, status: 200, payload: { profile } };
}

module.exports = {
  updateUserProfile,
  buildUserProfileView,
};
