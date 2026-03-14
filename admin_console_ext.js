/* admin_console_ext.js — Extended admin pages: friends, sessions, system info, user create, order delete, data export */
/* Depends on admin_console.js globals: $, api, toast, openModal, closeModal, esc, fmtDate, money, statusBadge, state, PAGE_SIZE, renderTable, renderPager, loadTabData */

/* ═══════════════════════════════════════
   FRIENDS MANAGEMENT
   ═══════════════════════════════════════ */
state.friends = { items: [], total: 0, offset: 0, q: '' };
state.friendReqs = { items: [], total: 0, offset: 0, status: '' };

async function loadFriends() {
  const s = state.friends;
  const params = new URLSearchParams({ limit: PAGE_SIZE, offset: s.offset, q: s.q });
  try {
    const data = await api(`/api/admin/friends?${params}`);
    s.items = data.items || []; s.total = data.total || 0;
    renderFriendsTable();
  } catch (e) { toast('加载好友数据失败'); }
}

function renderFriendsTable() {
  const s = state.friends;
  const rows = s.items.map(f => `<tr>
    <td><span class="user-cell-name">${esc(f.userName)}</span></td>
    <td><span class="user-cell-name">${esc(f.friendName)}</span></td>
    <td>${esc(f.group)}</td>
    <td>${esc(f.remark || '-')}</td>
    <td><button class="btn-action danger" onclick="adminRemoveFriend('${esc(f.userId)}','${esc(f.friendId)}','${esc(f.userName)}','${esc(f.friendName)}')">解除</button></td>
  </tr>`);
  renderTable('friendsTable', [
    { label: '用户' }, { label: '好友' }, { label: '分组' }, { label: '备注' }, { label: '操作' },
  ], rows);
  renderPager('friendsPager', s.total, s.offset, off => { s.offset = off; loadFriends(); });
}

window.adminRemoveFriend = function(userId, friendId, userName, friendName) {
  const body = `<p>确定要解除「${esc(userName)}」和「${esc(friendName)}」的好友关系吗？</p>`;
  const footer = `<button class="btn-outline" onclick="closeModal()">取消</button><button class="btn-primary" style="background:#dc2626" onclick="doRemoveFriend('${esc(userId)}','${esc(friendId)}')">确认解除</button>`;
  openModal('解除好友关系', body, footer);
};

window.doRemoveFriend = async function(userId, friendId) {
  try {
    await api('/api/admin/friends/remove', { method: 'POST', body: JSON.stringify({ userId, friendId }) });
    closeModal(); toast('好友关系已解除'); loadFriends();
  } catch (e) { toast('操作失败: ' + e.message); }
};

/* ═══════════════════════════════════════
   FRIEND REQUESTS
   ═══════════════════════════════════════ */
async function loadFriendRequests() {
  const s = state.friendReqs;
  const params = new URLSearchParams({ limit: PAGE_SIZE, offset: s.offset, status: s.status });
  try {
    const data = await api(`/api/admin/friend-requests?${params}`);
    s.items = data.items || []; s.total = data.total || 0;
    renderFriendRequestsTable();
  } catch (e) { toast('加载好友请求失败'); }
}

function renderFriendRequestsTable() {
  const s = state.friendReqs;
  const statusMap = { pending: ['待处理', 'badge-yellow'], accepted: ['已接受', 'badge-green'], rejected: ['已拒绝', 'badge-red'] };
  const rows = s.items.map(r => {
    const [label, cls] = statusMap[r.status] || [r.status, 'badge-gray'];
    return `<tr>
      <td>${esc(r.senderName)}</td>
      <td>${esc(r.targetName)}</td>
      <td>${esc(r.greeting || '-')}</td>
      <td><span class="badge ${cls}">${esc(label)}</span></td>
      <td>${fmtDate(r.createdAt)}</td>
      <td><button class="btn-action danger" onclick="adminDeleteFriendReq('${esc(r.id)}')">删除</button></td>
    </tr>`;
  });
  renderTable('friendRequestsTable', [
    { label: '发送者' }, { label: '接收者' }, { label: '留言' },
    { label: '状态' }, { label: '时间' }, { label: '操作' },
  ], rows);
  renderPager('friendRequestsPager', s.total, s.offset, off => { s.offset = off; loadFriendRequests(); });
}

window.adminDeleteFriendReq = function(reqId) {
  const body = '<p>确定要删除此好友请求吗？</p>';
  const footer = `<button class="btn-outline" onclick="closeModal()">取消</button><button class="btn-primary" style="background:#dc2626" onclick="doDeleteFriendReq('${esc(reqId)}')">确认删除</button>`;
  openModal('删除好友请求', body, footer);
};
window.doDeleteFriendReq = async function(reqId) {
  try {
    await api(`/api/admin/friend-requests/${reqId}/delete`, { method: 'POST', body: '{}' });
    closeModal(); toast('请求已删除'); loadFriendRequests();
  } catch (e) { toast('删除失败: ' + e.message); }
};

/* ═══════════════════════════════════════
   SESSION MANAGEMENT
   ═══════════════════════════════════════ */
state.sessions = { items: [], total: 0, offset: 0, q: '' };

async function loadSessions() {
  const s = state.sessions;
  const params = new URLSearchParams({ limit: PAGE_SIZE, offset: s.offset, q: s.q });
  try {
    const data = await api(`/api/admin/sessions?${params}`);
    s.items = data.items || []; s.total = data.total || 0;
    renderSessionsTable();
  } catch (e) { toast('加载会话失败'); }
}

function renderSessionsTable() {
  const s = state.sessions;
  const rows = s.items.map(sess => `<tr>
    <td><div class="user-cell">
      <div><div class="user-cell-name">${esc(sess.displayName)}</div><div class="user-cell-sub">@${esc(sess.username)}</div></div>
    </div></td>
    <td><code style="font-size:12px;background:#f1f5f9;padding:2px 6px;border-radius:4px">${esc(sess.tokenPrefix)}</code></td>
    <td>${fmtDate(sess.createdAt)}</td>
    <td>${sess.remainingHours > 0 ? sess.remainingHours + 'h' : '已过期'}</td>
    <td><button class="btn-action danger" onclick="adminRevokeSession('${esc(sess.userId)}','${esc(sess.displayName)}')">强制下线</button></td>
  </tr>`);
  renderTable('sessionsTable', [
    { label: '用户' }, { label: 'Token' }, { label: '登录时间' },
    { label: '剩余' }, { label: '操作' },
  ], rows);
  renderPager('sessionsPager', s.total, s.offset, off => { s.offset = off; loadSessions(); });
}

window.adminRevokeSession = function(userId, name) {
  const body = `<p>确定要强制下线用户「${esc(name)}」的所有会话吗？</p>`;
  const footer = `<button class="btn-outline" onclick="closeModal()">取消</button><button class="btn-primary" style="background:#dc2626" onclick="doRevokeSession('${esc(userId)}')">确认下线</button>`;
  openModal('强制下线', body, footer);
};
window.doRevokeSession = async function(userId) {
  try {
    await api(`/api/admin/sessions/${userId}/revoke`, { method: 'POST', body: '{}' });
    closeModal(); toast('已强制下线'); loadSessions();
  } catch (e) { toast('操作失败: ' + e.message); }
};

/* ═══════════════════════════════════════
   ONLINE USERS
   ═══════════════════════════════════════ */
async function loadOnlineUsers() {
  if (document.hidden) return;
  try {
    const data = await api('/api/admin/online');
    const items = data.items || [];
    const el = $('onlineUsersPanel');
    if (!el) return;
    if (!items.length) { el.innerHTML = '<div class="empty">当前无在线用户</div>'; return; }
    el.innerHTML = `<div class="stats-row" style="margin-bottom:12px"><div class="stat-card highlight"><div class="stat-label">在线人数</div><div class="stat-val">${items.length}</div></div></div>` +
      items.map(u => `<div class="row-card" style="display:flex;align-items:center;gap:10px">
        <div class="avatar-sm">${u.avatarUrl ? `<img src="${esc(u.avatarUrl)}">` : esc((u.displayName || '?')[0])}</div>
        <div style="flex:1"><div class="user-cell-name">${esc(u.displayName)}</div><div class="user-cell-sub">@${esc(u.username)} · ${u.connections} 个连接</div></div>
      </div>`).join('');
  } catch (_) {}
}

/* ═══════════════════════════════════════
   SYSTEM INFO
   ═══════════════════════════════════════ */
async function loadSystemInfo() {
  try {
    const data = await api('/api/admin/system/info');
    const el = $('systemInfoPanel');
    if (!el) return;
    const upH = Math.floor(data.uptime / 3600);
    const upM = Math.floor((data.uptime % 3600) / 60);
    el.innerHTML = `
      <div class="detail-grid">
        <div class="detail-item"><div class="detail-label">Node.js</div><div class="detail-value">${esc(data.nodeVersion)}</div></div>
        <div class="detail-item"><div class="detail-label">运行平台</div><div class="detail-value">${esc(data.platform)}</div></div>
        <div class="detail-item"><div class="detail-label">运行时间</div><div class="detail-value">${upH}小时${upM}分钟</div></div>
        <div class="detail-item"><div class="detail-label">内存 (RSS)</div><div class="detail-value">${data.memoryMB.rss} MB</div></div>
        <div class="detail-item"><div class="detail-label">堆内存</div><div class="detail-value">${data.memoryMB.heapUsed} / ${data.memoryMB.heapTotal} MB</div></div>
        <div class="detail-item"><div class="detail-label">活跃会话</div><div class="detail-value">${data.activeSessions}</div></div>
        <div class="detail-item"><div class="detail-label">在线用户</div><div class="detail-value">${data.onlineUsers}</div></div>
      </div>
      <div class="detail-section-title" style="margin-top:14px">数据统计</div>
      <div class="detail-grid">
        <div class="detail-item"><div class="detail-label">用户</div><div class="detail-value">${data.dataStats.users}</div></div>
        <div class="detail-item"><div class="detail-label">订单</div><div class="detail-value">${data.dataStats.orders}</div></div>
        <div class="detail-item"><div class="detail-label">会话</div><div class="detail-value">${data.dataStats.conversations}</div></div>
        <div class="detail-item"><div class="detail-label">消息</div><div class="detail-value">${data.dataStats.messages}</div></div>
        <div class="detail-item"><div class="detail-label">好友关系</div><div class="detail-value">${data.dataStats.friendships}</div></div>
        <div class="detail-item"><div class="detail-label">好友请求</div><div class="detail-value">${data.dataStats.friendRequests}</div></div>
        <div class="detail-item"><div class="detail-label">系统广播</div><div class="detail-value">${data.dataStats.systemMessages}</div></div>
      </div>`;
  } catch (_) {}
}

/* ═══════════════════════════════════════
   USER CREATE
   ═══════════════════════════════════════ */
window.showCreateUser = function() {
  const body = `
    <div class="form-group"><label>用户名 *</label><input id="cu_username" placeholder="小写字母、数字、下划线，2-24位"></div>
    <div class="form-group"><label>密码 *</label><input id="cu_password" type="password" placeholder="4-64位"></div>
    <div class="form-group"><label>昵称</label><input id="cu_displayName" placeholder="可选，留空则使用用户名"></div>
    <div class="form-group"><label>手机号</label><input id="cu_phone" placeholder="可选"></div>
    <div class="form-group"><label>角色</label><select id="cu_role"><option value="user">普通用户</option><option value="admin">管理员</option></select></div>
  `;
  const footer = `<button class="btn-outline" onclick="closeModal()">取消</button><button class="btn-primary" onclick="doCreateUser()">创建用户</button>`;
  openModal('创建新用户', body, footer);
};

window.doCreateUser = async function() {
  const username = $('cu_username').value.trim();
  const password = $('cu_password').value;
  if (!username) { toast('请输入用户名'); return; }
  if (!password) { toast('请输入密码'); return; }
  try {
    await api('/api/admin/users/create', {
      method: 'POST',
      body: JSON.stringify({
        username,
        password,
        displayName: $('cu_displayName').value.trim() || username,
        phone: $('cu_phone').value.trim(),
        role: $('cu_role').value,
      }),
    });
    closeModal(); toast('用户创建成功');
    if (state.tab === 'users') loadUsers();
  } catch (e) { toast('创建失败: ' + e.message); }
};

/* ═══════════════════════════════════════
   USER DELETE
   ═══════════════════════════════════════ */
window.deleteUser = function(userId, name) {
  const body = `<p style="color:#dc2626;font-weight:700">警告：此操作不可恢复！</p><p>确定要删除用户「${esc(name)}」吗？将同时删除该用户的所有好友关系和好友请求。</p>`;
  const footer = `<button class="btn-outline" onclick="closeModal()">取消</button><button class="btn-primary" style="background:#dc2626" onclick="doDeleteUser('${esc(userId)}')">确认删除</button>`;
  openModal('删除用户', body, footer);
};

window.doDeleteUser = async function(userId) {
  try {
    await api(`/api/admin/users/${userId}/delete`, { method: 'POST', body: '{}' });
    closeModal(); toast('用户已删除'); loadUsers();
  } catch (e) { toast('删除失败: ' + e.message); }
};

/* ═══════════════════════════════════════
   ORDER DELETE
   ═══════════════════════════════════════ */
window.deleteOrder = function(orderId) {
  const body = `<p>确定要删除订单 #${esc(String(orderId).slice(-6))} 吗？此操作不可恢复。</p>`;
  const footer = `<button class="btn-outline" onclick="closeModal()">取消</button><button class="btn-primary" style="background:#dc2626" onclick="doDeleteOrder('${esc(orderId)}')">确认删除</button>`;
  openModal('删除订单', body, footer);
};

window.doDeleteOrder = async function(orderId) {
  try {
    await api(`/api/admin/orders/${orderId}/delete`, { method: 'POST', body: '{}' });
    closeModal(); toast('订单已删除'); loadOrders();
  } catch (e) { toast('删除失败: ' + e.message); }
};

/* ═══════════════════════════════════════
   BLACKLIST REMOVE (from user detail)
   ═══════════════════════════════════════ */
window.adminRemoveBlacklist = function(userId, targetId, targetName) {
  const body = `<p>确定要将「${esc(targetName)}」从黑名单中移除吗？</p>`;
  const footer = `<button class="btn-outline" onclick="closeModal()">取消</button><button class="btn-primary" onclick="doRemoveBlacklist('${esc(userId)}','${esc(targetId)}')">确认移除</button>`;
  openModal('移除黑名单', body, footer);
};
window.doRemoveBlacklist = async function(userId, targetId) {
  try {
    await api(`/api/admin/users/${userId}/blacklist/remove`, { method: 'POST', body: JSON.stringify({ targetId }) });
    closeModal(); toast('已从黑名单移除');
    viewUser(userId); // refresh modal
  } catch (e) { toast('操作失败: ' + e.message); }
};

/* ═══════════════════════════════════════
   DATA EXPORT
   ═══════════════════════════════════════ */
window.exportUsers = function() {
  const token = getToken();
  window.open(`/api/admin/export/users?token=${encodeURIComponent(token)}`, '_blank');
};

window.exportOrders = function() {
  const token = getToken();
  window.open(`/api/admin/export/orders?token=${encodeURIComponent(token)}`, '_blank');
};

/* ═══════════════════════════════════════
   TAB LOADING (extends loadTabData)
   ═══════════════════════════════════════ */
const _origLoadTabData = window._loadTabData || loadTabData;
window._loadTabDataExt = function(tab) {
  if (tab === 'friends') { loadFriends(); loadFriendRequests(); }
  else if (tab === 'sessions') { loadSessions(); loadOnlineUsers(); }
  else if (tab === 'system') { loadSystemInfo(); }
  else return false;
  return true;
};

/* ═══════════════════════════════════════
   INIT EXTENSION (called from initApp)
   ═══════════════════════════════════════ */
window._initExtBindings = function() {
  bindSearch('friendSearch', 'friends', loadFriends);
  bindFilter('friendReqStatusFilter', 'friendReqs', 'status', loadFriendRequests);
  bindSearch('sessionSearch', 'sessions', loadSessions);
};
