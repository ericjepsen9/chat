/* admin_console_adv.js — Advanced features: auto-refresh, message search, audit log, admin settings, keyboard, conv management, nav badges */
/* Depends on: admin_console.js, admin_console_ext.js globals */
const _RE_REGEX_ESCAPE = /[.*+?^${}()|[\]\\]/g;

/* ═══════════════════════════════════════
   KEYBOARD SHORTCUTS
   ═══════════════════════════════════════ */
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const modal = $('detailModal');
    if (modal && !modal.classList.contains('hidden')) { closeModal(); e.preventDefault(); }
  }
  // Ctrl+R or F5: refresh current tab (prevent default browser refresh)
  if ((e.ctrlKey && e.key === 'r') || e.key === 'F5') {
    if (!$('loginScreen').classList.contains('hidden')) return; // not logged in
    e.preventDefault();
    loadTabData(state.tab);
    toast('已刷新');
  }
});

/* ═══════════════════════════════════════
   AUTO-REFRESH
   ═══════════════════════════════════════ */
let _autoRefreshTimer = null;
let _autoRefreshEnabled = false;
const AUTO_REFRESH_MS = 30000; // 30 seconds

window.toggleAutoRefresh = function() {
  _autoRefreshEnabled = !_autoRefreshEnabled;
  const btn = $('autoRefreshBtn');
  if (btn) {
    btn.textContent = _autoRefreshEnabled ? '自动刷新:开' : '自动刷新:关';
    btn.classList.toggle('active-toggle', _autoRefreshEnabled);
  }
  if (_autoRefreshEnabled) {
    _autoRefreshTimer = setInterval(() => {
      if (state.tab === 'dashboard' || state.tab === 'sessions') {
        loadTabData(state.tab);
      }
    }, AUTO_REFRESH_MS);
    toast('自动刷新已开启 (30s)');
  } else {
    clearInterval(_autoRefreshTimer);
    _autoRefreshTimer = null;
    toast('自动刷新已关闭');
  }
};

/* ═══════════════════════════════════════
   SIDEBAR NAV BADGES
   ═══════════════════════════════════════ */
async function updateNavBadges() {
  try {
    const data = await api('/api/admin/badge-counts');
    setBadge('orders', data.pendingOrders);
    setBadge('friends', data.pendingRequests);
    setBadge('sessions', data.onlineCount);
  } catch (_) {}
}

const _badgeNavCache = {};
function setBadge(tab, count) {
  let navItem = _badgeNavCache[tab];
  if (!navItem) {
    navItem = document.querySelector(`.nav-item[data-tab="${tab}"]`);
    if (navItem) _badgeNavCache[tab] = navItem;
  }
  if (!navItem) return;
  let badge = navItem.querySelector('.nav-badge');
  if (!count) { if (badge) badge.remove(); return; }
  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'nav-badge';
    navItem.appendChild(badge);
  }
  badge.textContent = count > 99 ? '99+' : count;
}

/* ═══════════════════════════════════════
   GLOBAL MESSAGE SEARCH
   ═══════════════════════════════════════ */
state.msgSearch = { items: [], total: 0, offset: 0, q: '' };

async function loadMessageSearch() {
  const s = state.msgSearch;
  if (!s.q || s.q.length < 2) {
    $('msgSearchResults').innerHTML = '<div class="empty">请输入至少2个字符进行搜索</div>';
    return;
  }
  const params = new URLSearchParams({ q: s.q, limit: PAGE_SIZE, offset: s.offset });
  try {
    const data = await api(`/api/admin/messages/search?${params}`);
    s.items = data.items || []; s.total = data.total || 0;
    renderMsgSearchResults();
  } catch (e) { toast('搜索失败: ' + e.message); }
}

function renderMsgSearchResults() {
  const s = state.msgSearch;
  const el = $('msgSearchResults');
  if (!el) return;
  if (!s.items.length) { el.innerHTML = '<div class="empty">无匹配消息</div>'; return; }
  // Precompile highlight regex once per render pass instead of per row
  const qEsc = esc(s.q);
  const hlRe = new RegExp(`(${qEsc.replace(_RE_REGEX_ESCAPE, '\\$&')})`, 'gi');
  let html = s.items.map(m => `
    <div class="row-card">
      <div class="row-title">${esc(m.senderName)} <span class="badge badge-gray">${esc(m.type)}</span> <span class="user-cell-sub">${fmtDate(m.createdAt)}</span></div>
      <div class="row-sub" style="word-break:break-all">${esc(m.text).replace(hlRe, '<mark style="background:#fef08a;padding:0 2px;border-radius:2px">$1</mark>')}</div>
      <div class="user-cell-sub" style="margin-top:4px">会话: ${esc(m.conversationName)}</div>
    </div>
  `).join('');
  if (s.total > PAGE_SIZE) {
    html += `<div class="pager" style="margin-top:8px"><span>共 ${s.total} 条</span></div>`;
  }
  el.innerHTML = html;
}


/* ═══════════════════════════════════════
   CONVERSATION DELETE
   ═══════════════════════════════════════ */
window.deleteConversation = function(convId, name) {
  const body = `<p style="color:#dc2626;font-weight:700">警告：此操作不可恢复！</p><p>确定要删除会话「${esc(name)}」及其所有消息吗？</p>`;
  const footer = `<button class="btn-outline" onclick="closeModal()">取消</button><button class="btn-primary" style="background:#dc2626" onclick="doDeleteConversation('${esc(convId)}')">确认删除</button>`;
  openModal('删除会话', body, footer);
};

window.doDeleteConversation = async function(convId) {
  try {
    await api(`/api/admin/conversations/${convId}/delete`, { method: 'POST', body: '{}' });
    closeModal(); toast('会话已删除'); loadConversations();
  } catch (e) { toast('删除失败: ' + e.message); }
};

/* ═══════════════════════════════════════
   AUDIT LOG
   ═══════════════════════════════════════ */
async function loadAuditLog() {
  try {
    const data = await api('/api/admin/audit-log?limit=50');
    const el = $('auditLogPanel');
    if (!el) return;
    const items = data.items || [];
    if (!items.length) { el.innerHTML = '<div class="empty">暂无操作记录</div>'; return; }
    el.innerHTML = items.map(l => `
      <div class="row-card">
        <div class="row-title">${esc(l.adminName)} · <span class="badge badge-blue">${esc(l.action)}</span></div>
        <div class="row-sub">${esc(l.detail)} · ${fmtDate(l.createdAt)}</div>
      </div>
    `).join('');
  } catch (_) {}
}

/* ═══════════════════════════════════════
   ADMIN CHANGE PASSWORD
   ═══════════════════════════════════════ */
window.showChangePassword = function() {
  const body = `
    <div class="form-group"><label>当前密码</label><input id="cp_old" type="password" placeholder="输入当前密码"></div>
    <div class="form-group"><label>新密码</label><input id="cp_new" type="password" placeholder="4-64位"></div>
    <div class="form-group"><label>确认新密码</label><input id="cp_confirm" type="password" placeholder="再次输入新密码"></div>
  `;
  const footer = `<button class="btn-outline" onclick="closeModal()">取消</button><button class="btn-primary" onclick="doChangePassword()">修改密码</button>`;
  openModal('修改管理员密码', body, footer);
};

window.doChangePassword = async function() {
  const oldPw = $('cp_old').value;
  const newPw = $('cp_new').value;
  const confirm = $('cp_confirm').value;
  if (!oldPw || !newPw) { toast('请填写所有字段'); return; }
  if (newPw !== confirm) { toast('两次密码输入不一致'); return; }
  try {
    await api('/api/admin/change-password', { method: 'POST', body: JSON.stringify({ oldPassword: oldPw, newPassword: newPw }) });
    closeModal(); toast('密码修改成功');
  } catch (e) { toast('修改失败: ' + e.message); }
};

/* ═══════════════════════════════════════
   DATE RANGE FILTER (for orders)
   ═══════════════════════════════════════ */
window.applyOrderDateFilter = function() {
  const from = $('orderDateFrom')?.value;
  const to = $('orderDateTo')?.value;
  if (from) state.orders.dateFrom = new Date(from).getTime();
  else delete state.orders.dateFrom;
  if (to) state.orders.dateTo = new Date(to + 'T23:59:59').getTime();
  else delete state.orders.dateTo;
  state.orders.offset = 0;
  loadOrders();
};

/* ═══════════════════════════════════════
   LOADING INDICATOR
   ═══════════════════════════════════════ */
const _origApi = api;
let _loadingCount = 0;
let _loadingEl = null;

function showLoading() {
  _loadingCount++;
  let el = _loadingEl || $('globalLoading');
  if (!el) {
    el = document.createElement('div');
    el.id = 'globalLoading';
    el.className = 'global-loading';
    el.innerHTML = '<div class="loading-bar"></div>';
    document.body.appendChild(el);
    _loadingEl = el;
  }
  el.classList.remove('hidden');
}

function hideLoading() {
  _loadingCount = Math.max(0, _loadingCount - 1);
  if (_loadingCount === 0) {
    if (!_loadingEl) _loadingEl = $('globalLoading');
    if (_loadingEl) _loadingEl.classList.add('hidden');
  }
}

// Wrap api to show loading
window.api = async function(path, opts) {
  showLoading();
  try {
    return await _origApi(path, opts);
  } finally {
    hideLoading();
  }
};

/* ═══════════════════════════════════════
   EXTENDED TAB LOADING
   ═══════════════════════════════════════ */
const _origLoadTabDataExt = window._loadTabDataExt;
window._loadTabDataExt = function(tab) {
  if (tab === 'msgSearch') { loadMessageSearch(); return true; }
  if (tab === 'system') { loadSystemInfo(); loadAuditLog(); return true; }
  if (_origLoadTabDataExt) return _origLoadTabDataExt(tab);
  return false;
};

/* ═══════════════════════════════════════
   INIT ADVANCED (called after initApp)
   ═══════════════════════════════════════ */
const _origInitExt = window._initExtBindings;
window._initExtBindings = function() {
  if (_origInitExt) _origInitExt();

  // Message search binding
  bindSearch('msgSearchInput', 'msgSearch', loadMessageSearch);

  // Load nav badges on init and periodically (skip when tab is hidden)
  updateNavBadges();
  setInterval(() => { if (!document.hidden) updateNavBadges(); }, 60000);
};
