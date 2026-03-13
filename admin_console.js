/* admin_console.js — Full CRUD admin management console */
const $ = (id) => document.getElementById(id);
const SESSION_KEY = 'chattrade_api_session_user';
const ADMIN_SESSION_KEY = 'chattrade_admin_session';

/* ── Helpers ── */
function esc(v) { return String(v == null ? '' : v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function money(v) { return '¥' + (Number(v) || 0).toFixed(2); }
function fmtDate(ts) { if (!ts) return '-'; const d = new Date(ts); return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0') + ' ' + String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0'); }
function fmtDateShort(ts) { if (!ts) return '-'; const d = new Date(ts); return String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); }

const STATUS_MAP = { pending: ['待处理','badge-yellow'], accepted: ['已接单','badge-blue'], processing: ['处理中','badge-blue'], in_progress: ['进行中','badge-blue'], completed: ['已完成','badge-green'] };
function statusBadge(s) { const [label, cls] = STATUS_MAP[s] || [s, 'badge-gray']; return `<span class="badge ${cls}">${esc(label)}</span>`; }

/* ── Auth ── */
function getToken() {
  try {
    const raw = localStorage.getItem(ADMIN_SESSION_KEY);
    if (raw) { const p = JSON.parse(raw); if (p?.token) return p.token; }
    const main = localStorage.getItem(SESSION_KEY);
    if (main) { const p = JSON.parse(main); if (p?.token) return p.token; }
    return '';
  } catch (_) { return ''; }
}
function getCsrfToken() {
  try {
    const raw = localStorage.getItem(ADMIN_SESSION_KEY);
    if (raw) { const p = JSON.parse(raw); if (p?.csrfToken) return p.csrfToken; }
    const main = localStorage.getItem(SESSION_KEY);
    if (main) { const p = JSON.parse(main); if (p?.csrfToken) return p.csrfToken; }
    return '';
  } catch (_) { return ''; }
}

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...opts.headers };
  const token = getToken();
  const csrf = getCsrfToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (csrf) headers['X-CSRF-Token'] = csrf;
  const res = await fetch(path, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

/* ── Toast ── */
let _toastTimer = null;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.add('hidden'), 2500);
}

/* ── Modal ── */
function openModal(title, bodyHtml, footerHtml) {
  $('modalTitle').textContent = title;
  $('modalBody').innerHTML = bodyHtml;
  $('modalFooter').innerHTML = footerHtml || '';
  $('detailModal').classList.remove('hidden');
}
function closeModal() { $('detailModal').classList.add('hidden'); }

/* ── State ── */
const state = {
  tab: 'dashboard',
  users: { items: [], total: 0, offset: 0, q: '', status: '', role: '' },
  orders: { items: [], total: 0, offset: 0, q: '', status: '' },
  products: { items: [], total: 0, offset: 0, q: '', listed: '' },
  convs: { items: [], total: 0, offset: 0, q: '' },
};
const PAGE_SIZE = 20;

/* ═══════════════════════════════════════
   LOGIN
   ═══════════════════════════════════════ */
function showLogin() { $('loginScreen').classList.remove('hidden'); $('appShell').classList.add('hidden'); }
function showApp() { $('loginScreen').classList.add('hidden'); $('appShell').classList.remove('hidden'); }

async function doLogin() {
  const username = $('loginUser').value.trim();
  const password = $('loginPass').value;
  if (!username || !password) { $('loginError').textContent = '请输入账号和密码'; $('loginError').classList.remove('hidden'); return; }
  $('loginBtn').disabled = true;
  try {
    const data = await api('/api/login', { method: 'POST', body: JSON.stringify({ username, password }) });
    if (data.token) {
      localStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify({ token: data.token, csrfToken: data.csrfToken || '', userId: data.userId }));
      $('loginError').classList.add('hidden');
      showApp();
      initApp();
    }
  } catch (e) {
    $('loginError').textContent = e.message === 'forbidden' ? '该账号不是管理员' : (e.message || '登录失败');
    $('loginError').classList.remove('hidden');
  } finally { $('loginBtn').disabled = false; }
}

/* ═══════════════════════════════════════
   NAVIGATION
   ═══════════════════════════════════════ */
const TAB_TITLES = {
  dashboard: '数据概览', users: '用户管理', orders: '订单管理',
  products: '商品管理', conversations: '会话消息', broadcast: '广播中心',
};

function switchTab(tab) {
  state.tab = tab;
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.tab === tab));
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('active', p.id === `tab-${tab}`));
  $('pageTitle').textContent = TAB_TITLES[tab] || tab;
  loadTabData(tab);
}

function loadTabData(tab) {
  if (tab === 'dashboard') loadDashboard();
  else if (tab === 'users') loadUsers();
  else if (tab === 'orders') loadOrders();
  else if (tab === 'products') loadProducts();
  else if (tab === 'conversations') loadConversations();
  else if (tab === 'broadcast') loadBroadcastHistory();
}

/* ═══════════════════════════════════════
   DASHBOARD
   ═══════════════════════════════════════ */
async function loadDashboard() {
  try {
    const data = await api('/api/admin/stats');
    renderDashboard(data);
  } catch (e) {
    if (e.message === 'forbidden' || e.message === 'HTTP 403') { showLogin(); return; }
    toast('加载失败: ' + e.message);
  }
}

function renderDashboard(data) {
  const o = data.overview || {};
  const cards = [
    { label: '用户总数', val: o.totalUsers, sub: `今日新增 ${o.newUsersToday}`, hl: false },
    { label: '订单总数', val: o.totalOrders, sub: `今日新增 ${o.newOrdersToday}`, hl: false },
    { label: '累计交易额', val: money(o.totalRevenue), sub: `今日完成 ${o.completedOrdersToday} 笔`, hl: true },
    { label: '商品总数', val: o.totalProducts, sub: '', hl: false },
    { label: '消息总数', val: o.totalMessages, sub: '', hl: false },
    { label: '会话总数', val: o.totalConversations, sub: '', hl: false },
  ];
  $('statsRow').innerHTML = cards.map(c => `
    <div class="stat-card${c.hl ? ' highlight' : ''}">
      <div class="stat-label">${esc(c.label)}</div>
      <div class="stat-val">${esc(c.val)}</div>
      ${c.sub ? `<div class="stat-sub">${esc(c.sub)}</div>` : ''}
    </div>
  `).join('');

  // Trend chart
  const trend = data.trend || [];
  renderTrendChart(trend);

  // Order pie
  renderOrderPie(data.orderStatusCounts || {});

  // Load recent orders
  loadRecentOrders();
}

function renderTrendChart(trend) {
  if (!trend.length) { $('trendChart').innerHTML = '<div class="empty">暂无数据</div>'; return; }
  const maxVal = Math.max(1, ...trend.map(t => Math.max(t.users, t.orders, t.messages)));
  const barH = 160;
  let html = '<div style="display:flex;align-items:flex-end;gap:4px;width:100%;height:' + barH + 'px;padding-bottom:20px">';
  for (const t of trend) {
    const h1 = Math.max(2, (t.users / maxVal) * (barH - 30));
    const h2 = Math.max(2, (t.orders / maxVal) * (barH - 30));
    const h3 = Math.max(2, (t.messages / maxVal) * (barH - 30));
    html += `<div class="chart-bar-group">
      <div style="display:flex;gap:2px;align-items:flex-end;width:100%;height:${barH - 30}px">
        <div class="chart-bar b1" style="height:${h1}px" title="用户 ${t.users}"></div>
        <div class="chart-bar b2" style="height:${h2}px" title="订单 ${t.orders}"></div>
        <div class="chart-bar b3" style="height:${h3}px" title="消息 ${t.messages}"></div>
      </div>
      <div class="chart-label">${esc(t.date)}</div>
    </div>`;
  }
  html += '</div><div class="chart-legend"><span class="legend-1">用户</span><span class="legend-2">订单</span><span class="legend-3">消息</span></div>';
  $('trendChart').innerHTML = html;
}

function renderOrderPie(counts) {
  const entries = Object.entries(counts);
  if (!entries.length) { $('orderPie').innerHTML = '<div class="empty">暂无订单</div>'; return; }
  const total = entries.reduce((s, [, v]) => s + v, 0);
  const colors = ['#3b82f6', '#8b5cf6', '#06b6d4', '#f59e0b', '#10b981', '#ef4444'];
  let gradParts = [], offset = 0;
  const legendHtml = [];
  entries.forEach(([status, count], i) => {
    const pct = (count / total) * 100;
    const color = colors[i % colors.length];
    gradParts.push(`${color} ${offset}% ${offset + pct}%`);
    offset += pct;
    const [label] = STATUS_MAP[status] || [status];
    legendHtml.push(`<div class="pie-legend-item"><div class="pie-dot" style="background:${color}"></div>${esc(label)} ${count}</div>`);
  });
  $('orderPie').innerHTML = `<div class="pie-wrap">
    <div class="pie-chart" style="background:conic-gradient(${gradParts.join(',')})"></div>
    <div class="pie-legend">${legendHtml.join('')}</div>
  </div>`;
}

async function loadRecentOrders() {
  try {
    const data = await api('/api/admin/orders?limit=10');
    const items = data.items || [];
    if (!items.length) { $('recentOrders').innerHTML = '<div class="empty">暂无订单</div>'; return; }
    $('recentOrders').innerHTML = items.map(o => `
      <div class="row-card">
        <div class="row-title">订单 #${esc(String(o.id).slice(-6))} · ${money(o.total)} ${statusBadge(o.status)}</div>
        <div class="row-sub">${esc(o.buyerName)} → ${esc(o.sellerName)} · ${esc(o.summary)} · ${fmtDate(o.createdAt)}</div>
      </div>
    `).join('');
  } catch (_) {}
}

/* ═══════════════════════════════════════
   TABLE HELPERS
   ═══════════════════════════════════════ */
function renderTable(containerId, columns, rows) {
  const el = $(containerId);
  if (!el) return;
  if (!rows.length) { el.innerHTML = '<div class="empty">暂无数据</div>'; return; }
  const ths = columns.map(c => `<th>${esc(c.label)}</th>`).join('');
  el.innerHTML = `<table class="data-table"><thead><tr>${ths}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

function renderPager(pagerId, total, offset, onPage) {
  const el = $(pagerId);
  if (!el || total <= PAGE_SIZE) { if (el) el.innerHTML = ''; return; }
  const pages = Math.ceil(total / PAGE_SIZE);
  const current = Math.floor(offset / PAGE_SIZE);
  let html = `<span>共 ${total} 条</span><div class="pager-btns">`;
  html += `<button ${current === 0 ? 'disabled' : ''} data-p="${current - 1}">上一页</button>`;
  for (let i = 0; i < pages && i < 10; i++) {
    html += `<button class="${i === current ? 'active' : ''}" data-p="${i}">${i + 1}</button>`;
  }
  html += `<button ${current >= pages - 1 ? 'disabled' : ''} data-p="${current + 1}">下一页</button></div>`;
  el.innerHTML = html;
  el.querySelectorAll('button[data-p]').forEach(btn => {
    btn.addEventListener('click', () => { const p = Number(btn.dataset.p); if (p >= 0 && p < pages) onPage(p * PAGE_SIZE); });
  });
}

/* ═══════════════════════════════════════
   USERS
   ═══════════════════════════════════════ */
async function loadUsers() {
  const s = state.users;
  const params = new URLSearchParams({ limit: PAGE_SIZE, offset: s.offset, q: s.q, status: s.status, role: s.role });
  try {
    const data = await api(`/api/admin/users?${params}`);
    s.items = data.items || []; s.total = data.total || 0;
    renderUsers();
  } catch (e) { toast('加载用户失败'); }
}

function renderUsers() {
  const s = state.users;
  const rows = s.items.map(u => `<tr>
    <td><div class="user-cell">
      <div class="avatar-sm">${u.avatarUrl ? `<img src="${esc(u.avatarUrl)}">` : esc((u.displayName || u.username || '?')[0])}</div>
      <div><div class="user-cell-name">${esc(u.displayName || u.username)}</div><div class="user-cell-sub">@${esc(u.username)} · ${esc(u.appNumberId || '')}</div></div>
    </div></td>
    <td>${esc(u.phone || '-')}</td>
    <td><span class="badge ${u.role === 'admin' ? 'badge-blue' : 'badge-gray'}">${u.role === 'admin' ? '管理员' : '用户'}</span></td>
    <td><span class="badge ${u.status === 'active' ? 'badge-green' : 'badge-red'}">${u.status === 'active' ? '正常' : '已禁用'}</span></td>
    <td>${fmtDateShort(u.createdAt)}</td>
    <td class="cell-actions">
      <button class="btn-action primary" onclick="viewUser('${esc(u.id)}')">详情</button>
      <button class="btn-action" onclick="editUser('${esc(u.id)}')">编辑</button>
    </td>
  </tr>`);
  renderTable('usersTable', [
    { label: '用户' }, { label: '手机号' }, { label: '角色' },
    { label: '状态' }, { label: '注册' }, { label: '操作' },
  ], rows);
  renderPager('usersPager', s.total, s.offset, off => { s.offset = off; loadUsers(); });
}

window.viewUser = async function(userId) {
  try {
    const data = await api(`/api/admin/users/${userId}`);
    const u = data.user;
    const prods = data.products || [];
    const os = data.orderStats || {};
    let body = `<div class="detail-section"><div class="detail-section-title">基本信息</div><div class="detail-grid">
      <div class="detail-item"><div class="detail-label">用户名</div><div class="detail-value">${esc(u.username)}</div></div>
      <div class="detail-item"><div class="detail-label">昵称</div><div class="detail-value">${esc(u.displayName)}</div></div>
      <div class="detail-item"><div class="detail-label">APP号</div><div class="detail-value">${esc(u.appNumberId)}</div></div>
      <div class="detail-item"><div class="detail-label">手机号</div><div class="detail-value">${esc(u.phone)}</div></div>
      <div class="detail-item"><div class="detail-label">角色</div><div class="detail-value">${u.role === 'admin' ? '管理员' : '普通用户'}</div></div>
      <div class="detail-item"><div class="detail-label">状态</div><div class="detail-value">${u.status === 'active' ? '正常' : '已禁用'}</div></div>
      <div class="detail-item"><div class="detail-label">签名</div><div class="detail-value">${esc(u.signature || '-')}</div></div>
      <div class="detail-item"><div class="detail-label">注册时间</div><div class="detail-value">${fmtDate(u.createdAt)}</div></div>
    </div></div>`;
    body += `<div class="detail-section"><div class="detail-section-title">订单统计</div><div class="detail-grid">
      <div class="detail-item"><div class="detail-label">买家订单</div><div class="detail-value">${os.asBuyer}</div></div>
      <div class="detail-item"><div class="detail-label">卖家订单</div><div class="detail-value">${os.asSeller}</div></div>
      <div class="detail-item"><div class="detail-label">待处理</div><div class="detail-value">${os.pending}</div></div>
      <div class="detail-item"><div class="detail-label">好友数</div><div class="detail-value">${data.friendCount}</div></div>
    </div></div>`;
    if (prods.length) {
      body += `<div class="detail-section"><div class="detail-section-title">商品列表 (${prods.length})</div>`;
      for (const p of prods.slice(0, 10)) {
        body += `<div class="row-card"><div class="row-title">${esc(p.title)} · ${money(p.price)}</div><div class="row-sub">库存 ${p.stock} · ${p.listed ? '上架' : '下架'} · ${esc(p.category || '')}</div></div>`;
      }
      if (prods.length > 10) body += `<div class="row-sub">还有 ${prods.length - 10} 件商品...</div>`;
      body += '</div>';
    }
    if (u.blacklist?.length) {
      body += `<div class="detail-section"><div class="detail-section-title">黑名单 (${u.blacklist.length})</div>`;
      for (const b of u.blacklist.slice(0, 10)) body += `<div class="row-card"><div class="row-sub">${esc(b.displayName)}</div></div>`;
      body += '</div>';
    }
    openModal('用户详情 - ' + (u.displayName || u.username), body, '');
  } catch (e) { toast('加载失败: ' + e.message); }
};

window.editUser = async function(userId) {
  try {
    const data = await api(`/api/admin/users/${userId}`);
    const u = data.user;
    const body = `
      <div class="form-group"><label>昵称</label><input id="eu_name" value="${esc(u.displayName || '')}"></div>
      <div class="form-group"><label>签名</label><input id="eu_sig" value="${esc(u.signature || '')}"></div>
      <div class="form-group"><label>状态</label><select id="eu_status"><option value="active" ${u.status==='active'?'selected':''}>正常</option><option value="disabled" ${u.status==='disabled'?'selected':''}>禁用</option></select></div>
      <div class="form-group"><label>角色</label><select id="eu_role"><option value="user" ${u.role!=='admin'?'selected':''}>普通用户</option><option value="admin" ${u.role==='admin'?'selected':''}>管理员</option></select></div>
      <hr style="margin:16px 0;border:none;border-top:1px solid #e5e7eb">
      <div class="detail-section-title">重置密码</div>
      <div class="form-group"><label>新密码（留空则不修改）</label><input id="eu_pw" type="password" placeholder="输入新密码"></div>
    `;
    const footer = `<button class="btn-outline" onclick="closeModal()">取消</button><button class="btn-primary" onclick="saveUser('${esc(userId)}')">保存修改</button>`;
    openModal('编辑用户 - ' + (u.displayName || u.username), body, footer);
  } catch (e) { toast('加载失败'); }
};

window.saveUser = async function(userId) {
  try {
    const body = {
      displayName: $('eu_name').value.trim(),
      signature: $('eu_sig').value.trim(),
      status: $('eu_status').value,
      role: $('eu_role').value,
    };
    await api(`/api/admin/users/${userId}/update`, { method: 'POST', body: JSON.stringify(body) });
    const pw = $('eu_pw').value.trim();
    if (pw) await api(`/api/admin/users/${userId}/reset-password`, { method: 'POST', body: JSON.stringify({ password: pw }) });
    closeModal();
    toast('用户已更新');
    loadUsers();
  } catch (e) { toast('保存失败: ' + e.message); }
};

/* ═══════════════════════════════════════
   ORDERS
   ═══════════════════════════════════════ */
async function loadOrders() {
  const s = state.orders;
  const params = new URLSearchParams({ limit: PAGE_SIZE, offset: s.offset, q: s.q, status: s.status });
  try {
    const data = await api(`/api/admin/orders?${params}`);
    s.items = data.items || []; s.total = data.total || 0;
    renderOrdersTable();
  } catch (e) { toast('加载订单失败'); }
}

function renderOrdersTable() {
  const s = state.orders;
  const rows = s.items.map(o => `<tr>
    <td><span style="font-weight:700">#${esc(String(o.id).slice(-6))}</span><br><span class="user-cell-sub">${fmtDate(o.createdAt)}</span></td>
    <td>${esc(o.buyerName)}</td>
    <td>${esc(o.sellerName)}</td>
    <td style="font-weight:700">${money(o.total)}</td>
    <td>${statusBadge(o.status)}</td>
    <td><span class="user-cell-sub">${esc(o.summary)}</span></td>
    <td class="cell-actions">
      <button class="btn-action primary" onclick="viewOrder('${esc(o.id)}')">详情</button>
      <button class="btn-action" onclick="changeOrderStatus('${esc(o.id)}','${esc(o.status)}')">改状态</button>
    </td>
  </tr>`);
  renderTable('ordersTable', [
    { label: '订单' }, { label: '买家' }, { label: '卖家' },
    { label: '金额' }, { label: '状态' }, { label: '摘要' }, { label: '操作' },
  ], rows);
  renderPager('ordersPager', s.total, s.offset, off => { s.offset = off; loadOrders(); });
}

window.viewOrder = async function(orderId) {
  try {
    const data = await api(`/api/admin/orders/${orderId}`);
    const o = data.order;
    let body = `<div class="detail-section"><div class="detail-grid">
      <div class="detail-item"><div class="detail-label">订单号</div><div class="detail-value">${esc(o.id)}</div></div>
      <div class="detail-item"><div class="detail-label">状态</div><div class="detail-value">${statusBadge(o.status)}</div></div>
      <div class="detail-item"><div class="detail-label">买家</div><div class="detail-value">${esc(o.buyerName)}</div></div>
      <div class="detail-item"><div class="detail-label">卖家</div><div class="detail-value">${esc(o.sellerName)}</div></div>
      <div class="detail-item"><div class="detail-label">总金额</div><div class="detail-value" style="font-size:18px;color:#7c3aed">${money(o.total)}</div></div>
      <div class="detail-item"><div class="detail-label">备注</div><div class="detail-value">${esc(o.remark || '-')}</div></div>
      <div class="detail-item"><div class="detail-label">创建时间</div><div class="detail-value">${fmtDate(o.createdAt)}</div></div>
      <div class="detail-item"><div class="detail-label">更新时间</div><div class="detail-value">${fmtDate(o.updatedAt)}</div></div>
    </div></div>`;
    if (o.items?.length) {
      body += '<div class="detail-section"><div class="detail-section-title">商品明细</div>';
      for (const item of o.items) {
        body += `<div class="row-card"><div class="row-title">${esc(item.title)} (${esc(item.spec)})</div><div class="row-sub">单价 ${money(item.price)} × ${item.quantity} = ${money(item.price * item.quantity)}</div></div>`;
      }
      body += '</div>';
    }
    openModal('订单详情', body, '');
  } catch (e) { toast('加载失败'); }
};

window.changeOrderStatus = function(orderId, current) {
  const statuses = ['pending', 'accepted', 'processing', 'in_progress', 'completed'];
  const opts = statuses.map(s => `<option value="${s}" ${s===current?'selected':''}>${(STATUS_MAP[s]||[s])[0]}</option>`).join('');
  const body = `<div class="form-group"><label>当前状态: ${statusBadge(current)}</label></div><div class="form-group"><label>修改为</label><select id="cos_status">${opts}</select></div>`;
  const footer = `<button class="btn-outline" onclick="closeModal()">取消</button><button class="btn-primary" onclick="doChangeOrderStatus('${esc(orderId)}')">确认修改</button>`;
  openModal('修改订单状态', body, footer);
};

window.doChangeOrderStatus = async function(orderId) {
  try {
    await api(`/api/admin/orders/${orderId}/status`, { method: 'POST', body: JSON.stringify({ status: $('cos_status').value }) });
    closeModal(); toast('订单状态已更新'); loadOrders();
  } catch (e) { toast('操作失败: ' + e.message); }
};

/* ═══════════════════════════════════════
   PRODUCTS
   ═══════════════════════════════════════ */
async function loadProducts() {
  const s = state.products;
  const params = new URLSearchParams({ limit: PAGE_SIZE, offset: s.offset, q: s.q, listed: s.listed });
  try {
    const data = await api(`/api/admin/products?${params}`);
    s.items = data.items || []; s.total = data.total || 0;
    renderProductsTable();
  } catch (e) { toast('加载商品失败'); }
}

function renderProductsTable() {
  const s = state.products;
  const rows = s.items.map(p => `<tr>
    <td><div class="user-cell">
      ${p.image ? `<div class="avatar-sm"><img src="${esc(p.image)}"></div>` : ''}
      <div><div class="user-cell-name">${esc(p.title)}</div><div class="user-cell-sub">${esc(p.category || '-')}</div></div>
    </div></td>
    <td>${esc(p.sellerName)}</td>
    <td style="font-weight:700">${money(p.price)}</td>
    <td>${p.stock}</td>
    <td><span class="badge ${p.listed ? 'badge-green' : 'badge-gray'}">${p.listed ? '上架' : '下架'}</span></td>
    <td class="cell-actions">
      <button class="btn-action" onclick="editProduct('${esc(p.id)}','${esc(p.title)}','${esc(p.price)}',${p.stock},${p.listed})">编辑</button>
      <button class="btn-action danger" onclick="delProduct('${esc(p.id)}','${esc(p.title)}')">删除</button>
    </td>
  </tr>`);
  renderTable('productsTable', [
    { label: '商品' }, { label: '卖家' }, { label: '价格' },
    { label: '库存' }, { label: '状态' }, { label: '操作' },
  ], rows);
  renderPager('productsPager', s.total, s.offset, off => { s.offset = off; loadProducts(); });
}

window.editProduct = function(id, title, price, stock, listed) {
  const body = `
    <div class="form-group"><label>标题</label><input id="ep_title" value="${esc(title)}"></div>
    <div class="form-group"><label>价格</label><input id="ep_price" value="${esc(price)}"></div>
    <div class="form-group"><label>库存</label><input id="ep_stock" type="number" value="${stock}"></div>
    <div class="form-group"><label>状态</label><select id="ep_listed"><option value="true" ${listed?'selected':''}>上架</option><option value="false" ${!listed?'selected':''}>下架</option></select></div>
  `;
  const footer = `<button class="btn-outline" onclick="closeModal()">取消</button><button class="btn-primary" onclick="doEditProduct('${esc(id)}')">保存</button>`;
  openModal('编辑商品', body, footer);
};

window.doEditProduct = async function(id) {
  try {
    await api(`/api/admin/products/${id}/update`, {
      method: 'POST',
      body: JSON.stringify({ title: $('ep_title').value, price: $('ep_price').value, stock: Number($('ep_stock').value), listed: $('ep_listed').value === 'true' }),
    });
    closeModal(); toast('商品已更新'); loadProducts();
  } catch (e) { toast('保存失败: ' + e.message); }
};

window.delProduct = function(id, title) {
  const body = `<p>确定要删除商品「${esc(title)}」吗？此操作不可恢复。</p>`;
  const footer = `<button class="btn-outline" onclick="closeModal()">取消</button><button class="btn-primary" style="background:#dc2626" onclick="doDelProduct('${esc(id)}')">确认删除</button>`;
  openModal('删除商品', body, footer);
};

window.doDelProduct = async function(id) {
  try {
    await api(`/api/admin/products/${id}/delete`, { method: 'POST', body: '{}' });
    closeModal(); toast('商品已删除'); loadProducts();
  } catch (e) { toast('删除失败: ' + e.message); }
};

/* ═══════════════════════════════════════
   CONVERSATIONS
   ═══════════════════════════════════════ */
async function loadConversations() {
  const s = state.convs;
  const params = new URLSearchParams({ limit: PAGE_SIZE, offset: s.offset, q: s.q });
  try {
    const data = await api(`/api/admin/conversations?${params}`);
    s.items = data.items || []; s.total = data.total || 0;
    renderConvsTable();
  } catch (e) { toast('加载会话失败'); }
}

function renderConvsTable() {
  const s = state.convs;
  const rows = s.items.map(c => {
    const names = (c.members || []).map(m => esc(m.displayName)).join(' ↔ ');
    return `<tr>
      <td><span class="user-cell-name">${names}</span></td>
      <td><span class="badge badge-gray">${esc(c.type)}</span></td>
      <td>${c.messageCount}</td>
      <td>${fmtDate(c.lastMessageAt)}</td>
      <td><button class="btn-action primary" onclick="viewConvMessages('${esc(c.id)}')">查看消息</button></td>
    </tr>`;
  });
  renderTable('convsTable', [
    { label: '会话成员' }, { label: '类型' }, { label: '消息数' },
    { label: '最后活跃' }, { label: '操作' },
  ], rows);
  renderPager('convsPager', s.total, s.offset, off => { s.offset = off; loadConversations(); });
}

window.viewConvMessages = async function(convId) {
  try {
    const data = await api(`/api/admin/conversations/${convId}/messages?limit=50`);
    const msgs = data.items || [];
    if (!msgs.length) { openModal('会话消息', '<div class="empty">暂无消息</div>', ''); return; }
    let body = '';
    for (const m of msgs) {
      const typeLabel = m.type === 'text' ? '' : ` [${esc(m.type)}]`;
      body += `<div class="row-card" style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
        <div style="flex:1;min-width:0">
          <div class="row-title">${esc(m.senderName)}${typeLabel} <span class="user-cell-sub">${fmtDate(m.createdAt)}</span></div>
          <div class="row-sub" style="word-break:break-all">${esc(m.text || m.imageUrl || m.audioUrl || '[非文本]')}</div>
        </div>
        <button class="btn-action danger" onclick="adminDeleteMsg('${esc(m.id)}','${esc(convId)}')">删除</button>
      </div>`;
    }
    if (data.total > 50) body += `<div class="row-sub" style="text-align:center;padding:8px">还有 ${data.total - 50} 条消息...</div>`;
    openModal(`会话消息 (${data.total})`, body, '');
  } catch (e) { toast('加载失败'); }
};

window.adminDeleteMsg = async function(msgId, convId) {
  if (!confirm('确定要删除此消息吗？')) return;
  try {
    await api(`/api/admin/messages/${msgId}/delete`, { method: 'POST', body: '{}' });
    toast('消息已删除');
    viewConvMessages(convId);
  } catch (e) { toast('删除失败: ' + e.message); }
};

/* ═══════════════════════════════════════
   BROADCAST
   ═══════════════════════════════════════ */
async function loadBroadcastHistory() {
  try {
    const data = await api('/api/system/messages');
    const items = data.items || [];
    if (!items.length) { $('broadcastHistory').innerHTML = '<div class="empty">暂无广播</div>'; return; }
    $('broadcastHistory').innerHTML = items.map(m => `
      <div class="row-card" style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
        <div style="flex:1;min-width:0">
          <div class="row-title">${esc(m.title)}</div>
          <div class="row-sub">${esc(m.summary)} · ${fmtDate(m.createdAt)}</div>
        </div>
        <button class="btn-action danger" onclick="delBroadcast('${esc(m.id)}')">删除</button>
      </div>
    `).join('');
  } catch (_) {}
}

window.delBroadcast = async function(id) {
  if (!confirm('确定要删除此广播消息吗？')) return;
  try {
    await api(`/api/admin/system/messages/${id}/delete`, { method: 'POST', body: '{}' });
    toast('广播已删除');
    loadBroadcastHistory();
  } catch (e) { toast('删除失败: ' + e.message); }
};

async function publishBroadcast() {
  const title = $('bcTitle').value.trim();
  const summary = $('bcSummary').value.trim();
  const cover = $('bcCover').value.trim();
  if (!title && !summary) { toast('请输入标题或摘要'); return; }
  try {
    await api('/api/admin/system/messages', { method: 'POST', body: JSON.stringify({ title: title || '系统消息', summary: summary || '请查看最新通知', cover }) });
    toast('广播已发布');
    $('bcTitle').value = ''; $('bcSummary').value = ''; $('bcCover').value = '';
    loadBroadcastHistory();
  } catch (e) { toast('发布失败: ' + e.message); }
}

/* ═══════════════════════════════════════
   SEARCH DEBOUNCE
   ═══════════════════════════════════════ */
function debounce(fn, ms) { let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); }; }

function bindSearch(inputId, stateKey, loader) {
  const el = $(inputId);
  if (!el) return;
  el.addEventListener('input', debounce(() => {
    state[stateKey].q = el.value.trim();
    state[stateKey].offset = 0;
    loader();
  }, 350));
}

function bindFilter(selectId, stateKey, filterKey, loader) {
  const el = $(selectId);
  if (!el) return;
  el.addEventListener('change', () => {
    state[stateKey][filterKey] = el.value;
    state[stateKey].offset = 0;
    loader();
  });
}

/* ═══════════════════════════════════════
   INIT
   ═══════════════════════════════════════ */
function initApp() {
  $('adminInfo').textContent = '管理员已登录';

  // Tab navigation
  document.querySelectorAll('.nav-item').forEach(n => {
    n.addEventListener('click', (e) => {
      e.preventDefault();
      switchTab(n.dataset.tab);
      // Close mobile sidebar
      $('sidebar').classList.remove('open');
    });
  });

  // Menu toggle (mobile)
  $('menuToggle').addEventListener('click', () => $('sidebar').classList.toggle('open'));

  // Search & filters
  bindSearch('userSearch', 'users', loadUsers);
  bindFilter('userStatusFilter', 'users', 'status', loadUsers);
  bindFilter('userRoleFilter', 'users', 'role', loadUsers);
  bindSearch('orderSearch', 'orders', loadOrders);
  bindFilter('orderStatusFilter', 'orders', 'status', loadOrders);
  bindSearch('productSearch', 'products', loadProducts);
  bindFilter('productListedFilter', 'products', 'listed', loadProducts);
  bindSearch('convSearch', 'convs', loadConversations);

  // Refresh
  $('refreshBtn').addEventListener('click', () => loadTabData(state.tab));

  // Broadcast
  $('bcPublishBtn').addEventListener('click', publishBroadcast);

  // Logout
  $('logoutBtn').addEventListener('click', () => {
    localStorage.removeItem(ADMIN_SESSION_KEY);
    showLogin();
  });

  // Modal close
  $('modalCloseBtn').addEventListener('click', closeModal);
  $('detailModal').addEventListener('click', (e) => { if (e.target === $('detailModal')) closeModal(); });

  // Load initial data
  switchTab('dashboard');
}

/* ═══════════════════════════════════════
   BOOT
   ═══════════════════════════════════════ */
(async function boot() {
  // Login form
  $('loginBtn').addEventListener('click', doLogin);
  $('loginPass').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
  $('loginUser').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('loginPass').focus(); });

  // Check existing session
  const token = getToken();
  if (token) {
    try {
      await api('/api/admin/stats');
      showApp();
      initApp();
      return;
    } catch (_) {}
  }
  showLogin();
})();
