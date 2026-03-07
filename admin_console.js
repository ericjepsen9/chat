const $ = (id) => document.getElementById(id);
const state = { data: null, drafts: [] };

const SESSION_KEY = 'chattrade_api_session_user';

function getToken(){
  try{
    const sessionRaw = localStorage.getItem(SESSION_KEY);
    if (sessionRaw) {
      const parsed = JSON.parse(sessionRaw);
      if (parsed && parsed.token) return String(parsed.token);
    }
    const raw = localStorage.getItem('token') || sessionStorage.getItem('token');
    return raw || '';
  }catch(_){ return ''; }
}

async function api(path, options = {}){
  const token = getToken();
  const headers = Object.assign({ 'Content-Type':'application/json' }, options.headers || {});
  if(token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, Object.assign({}, options, { headers }));
  const data = await res.json().catch(() => ({}));
  if(!res.ok) throw new Error(data.error || data.message || `HTTP ${res.status}`);
  return data;
}


function esc(v){
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function money(v){
  const n = Number(v || 0);
  return `¥${n.toFixed(2)}`;
}

function setTab(tab){
  document.querySelectorAll('.admin-nav button').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tab));
  document.querySelectorAll('.admin-tab').forEach(sec => sec.classList.toggle('active', sec.id === `tab-${tab}`));
  const map = {
    overview:['平台概览','桌面版独立管理网页'],
    orders:['平台订单','查看全平台订单汇总'],
    users:['用户管理','账号、黑名单与卖家活跃概览'],
    products:['商品管理','平台商品概览'],
    broadcasts:['广播中心','平台图文通知与草稿'],
    risk:['风控与举报','黑名单、异常订单与系统提醒'],
  };
  $('adminPageTitle').textContent = map[tab][0];
  $('adminPageSub').textContent = map[tab][1];
}

function renderOverview(){
  const stats = state.data?.stats || {};
  const statsGrid = $('adminStatsGrid');
  const items = [
    ['用户总数', stats.users || 0],
    ['商品总数', stats.products || 0],
    ['订单总数', stats.orders || 0],
    ['广播总数', stats.broadcasts || 0],
    ['黑名单关系', stats.blacklistLinks || 0],
    ['待完成订单', stats.pendingOrders || 0],
  ];
  statsGrid.innerHTML = items.map(([label, value]) => `<div class="stat-card"><div class="stat-label">${esc(label)}</div><div class="stat-value">${esc(value)}</div></div>`).join('');
  const recent = state.data?.recentOrders || [];
  $('adminRecentOrders').innerHTML = recent.length ? recent.map(o => `
    <div class="row-card">
      <div class="row-title">订单 #${String(o.id || '').slice(-6)} · ${money(o.total)}</div>
      <div class="row-sub">${esc(o.buyerName || '买家')} → ${esc(o.sellerName || '卖家')} · ${esc(o.summary || '')}</div>
      <div class="row-line"><span class="badge ${o.status === 'completed' ? '' : 'warn'}">${o.status === 'completed' ? '已完成' : '处理中'}</span></div>
    </div>
  `).join('') : '<div class="empty">暂无订单</div>';
  const risks = state.data?.reportList || [];
  $('adminRiskSummary').innerHTML = risks.length ? risks.map(r => `
    <div class="row-card">
      <div class="row-title">${esc(r.title || '提醒')}</div>
      <div class="row-sub">${esc(r.summary || '')}</div>
    </div>
  `).join('') : '<div class="empty">暂无平台提醒</div>';
}

function table(containerId, columns, rows){
  const wrap = $(containerId);
  if(!wrap) return;
  if(!rows.length){ wrap.innerHTML = '<div class="empty">暂无数据</div>'; return; }
  const head = `<div class="table-row header">${columns.map(c => `<div>${esc(c)}</div>`).join('')}</div>`;
  const body = rows.join('');
  wrap.innerHTML = `<div class="table">${head}${body}</div>`;
}

function renderOrders(){
  const rows = (state.data?.recentOrders || []).map(o => `
    <div class="table-row">
      <div>订单 #${String(o.id || '').slice(-6)}<br><span class="row-sub">${esc(o.summary || '')}</span></div>
      <div>${esc(o.buyerName || '-')} → ${esc(o.sellerName || '-')}</div>
      <div>${money(o.total)}</div>
      <div><span class="badge ${o.status === 'completed' ? '' : 'warn'}">${o.status === 'completed' ? '已完成' : '处理中'}</span></div>
    </div>
  `);
  table('adminOrdersTable', ['订单', '买卖双方', '金额', '状态'], rows);
}

function renderUsers(){
  const rows = (state.data?.userList || []).map(u => `
    <div class="table-row">
      <div>${esc(u.displayName || u.username || '-')}</div>
      <div>商品 ${u.productCount || 0}</div>
      <div>卖家订单 ${u.sellerOrderCount || 0}</div>
      <div><span class="badge ${(u.blacklistCount || 0) ? 'warn' : ''}">${(u.blacklistCount || 0) ? `黑名单 ${esc(u.blacklistCount)}` : '正常'}</span></div>
    </div>
  `);
  table('adminUsersTable', ['用户', '商品数', '卖家订单', '风控'], rows);
}

function renderProducts(){
  const rows = (state.data?.productList || []).map(p => `
    <div class="table-row">
      <div>${esc(p.title || '-')}</div>
      <div>${esc(p.sellerName || '-')}</div>
      <div>${money(p.price)}</div>
      <div><span class="badge">在售</span></div>
    </div>
  `);
  table('adminProductsTable', ['商品', '卖家', '价格', '状态'], rows);
}

function renderRisk(){
  const rows = (state.data?.reportList || []).map(r => `
    <div class="row-card">
      <div class="row-title">${esc(r.title || '风险提醒')}</div>
      <div class="row-sub">${esc(r.summary || '')}</div>
    </div>
  `);
  $('adminRiskTable').innerHTML = rows.length ? rows.join('') : '<div class="empty">暂无风控提醒</div>';
}

function renderDrafts(){
  const wrap = $('adminBroadcastDrafts');
  if(!wrap) return;
  if(!state.drafts.length){ wrap.innerHTML = '<div class="empty">暂无广播草稿</div>'; return; }
  wrap.innerHTML = state.drafts.map((d, i) => `
    <div class="row-card">
      <div class="row-title">${esc(d.title)}</div>
      <div class="row-sub">${esc(d.summary)}</div>
      <div class="row-line">
        <span class="badge">草稿</span>
        <button data-draft="${i}">载入</button>
      </div>
    </div>
  `).join('');
  wrap.querySelectorAll('button[data-draft]').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = state.drafts[Number(btn.dataset.draft)];
      if(!item) return;
      $('broadcastTitle').value = item.title;
      $('broadcastSummary').value = item.summary;
      $('broadcastContent').value = item.content;
    });
  });
}

async function loadDashboard(){
  const token = getToken();
  if(!token){
    alert('未检测到登录态，请先在用户端登录，再打开后台页。');
    return;
  }
  try{
    state.data = await api('/api/admin/dashboard');
  }catch(err){
    alert(err.message || '后台数据加载失败');
    state.data = { stats:{}, recentOrders:[], userList:[], productList:[], reportList:[] };
  }
  renderOverview();
  renderOrders();
  renderUsers();
  renderProducts();
  renderRisk();
}

function bind(){
  document.querySelectorAll('.admin-nav button').forEach(btn => btn.addEventListener('click', () => setTab(btn.dataset.tab)));
  $('adminRefreshBtn').addEventListener('click', loadDashboard);
  $('adminLogoutBtn').addEventListener('click', () => {
    localStorage.removeItem('token');
    sessionStorage.removeItem('token');
    localStorage.removeItem(SESSION_KEY);
    alert('已清除本地登录态');
  });
  $('adminSaveBroadcastDraftBtn').addEventListener('click', () => {
    const draft = {
      title: $('broadcastTitle').value.trim() || '图文通知',
      summary: $('broadcastSummary').value.trim() || '广播摘要',
      content: $('broadcastContent').value.trim(),
    };
    state.drafts.unshift(draft);
    renderDrafts();
    alert('草稿已保存');
  });
  $('adminSendBroadcastBtn').addEventListener('click', async () => {
    const title = $('broadcastTitle').value.trim() || '系统消息';
    const summary = $('broadcastSummary').value.trim() || $('broadcastContent').value.trim() || '请查看最新通知';
    try{
      await api('/api/admin/system/messages', { method:'POST', body: JSON.stringify({ title, summary, cover: '' }) });
      alert('系统消息已发布');
      await loadDashboard();
    }catch(err){
      alert(err.message || '发布失败');
    }
  });
}

bind();
loadDashboard();
renderDrafts();
setTab('overview');
