/* app_utils.js — session, API, UI utilities extracted from app.js */
const SESSION_KEY = "chattrade_api_session_user";

const $ = id => document.getElementById(id);
function readSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return { user: null, token: null, csrfToken: null };
    const parsed = JSON.parse(raw);
    if (parsed && parsed.user && parsed.token) return parsed;
    if (parsed && parsed.id) return { user: parsed, token: null, csrfToken: null };
  } catch (_) {}
  return { user: null, token: null, csrfToken: null };
}
function writeSession(user, token, csrfToken) {
  const nextToken = token ?? state.sessionToken ?? null;
  const nextCsrf = csrfToken ?? state.csrfToken ?? null;
  // Preserve original loginAt timestamp; only set on new login (when token is provided)
  let loginAt;
  if (token) {
    loginAt = Date.now();
  } else {
    try {
      const existing = JSON.parse(localStorage.getItem(SESSION_KEY) || '{}');
      loginAt = existing.loginAt || existing.savedAt || Date.now();
    } catch (_) { loginAt = Date.now(); }
  }
  localStorage.setItem(SESSION_KEY, JSON.stringify({ user, token: nextToken, csrfToken: nextCsrf, savedAt: Date.now(), loginAt }));
  state.sessionToken = nextToken;
  state.csrfToken = nextCsrf;
}
// Session expiry: auto-logout after 7 days or on 401
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
function checkSessionExpiry() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed && (parsed.loginAt || parsed.savedAt) && (Date.now() - (parsed.loginAt || parsed.savedAt) > SESSION_MAX_AGE_MS)) {
      localStorage.removeItem(SESSION_KEY);
      showToast('登录已过期，请重新登录');
      setTimeout(() => location.reload(), 1500);
    }
  } catch (_) {}
}
setInterval(checkSessionExpiry, 60 * 1000);

const on = (id, ev, fn) => {
    const el = $(id);
    if(el) { el.addEventListener(ev, fn); }
};

async function api(p, o={}) {
    const session = readSession();
    const headers = { ...(o.headers || {}) };
    if (!(o.body instanceof FormData) && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
    const token = state.sessionToken || session.token;
    if (token) headers.Authorization = `Bearer ${token}`;
    const csrf = state.csrfToken || session.csrfToken;
    if (csrf && o.method && o.method !== 'GET') headers['X-CSRF-Token'] = csrf;
    let r;
    try {
      r = await fetch(p, { ...o, headers });
    } catch (netErr) {
      const err = new Error('网络连接失败，请检查网络后重试');
      err.isNetworkError = true;
      throw err;
    }
    if (r.status === 401 && token) {
      localStorage.removeItem(SESSION_KEY);
      showToast('登录已过期，请重新登录');
      setTimeout(() => location.reload(), 1500);
      throw new Error('session_expired');
    }
    const contentType = r.headers.get("content-type") || "";
    const d = contentType.includes("application/json") ? await r.json() : {};
    if(!r.ok) throw new Error(d.error || `http_${r.status}`);
    return d;
}
function escapeHTML(s) { return typeof s!=='string'?'':s.replace(/[&<>'"]/g,t=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[t])); }
const firstChar = t => String(t||'').trim().charAt(0)||'?';
// Safe DOM setters — avoid repeated null-check + property-set patterns
function setText(id, val) { const el = $(id); if (el) el.textContent = val; }
function hideEl(id) { const el = $(id); if (el) el.classList.add('hidden'); }
function showEl(id) { const el = $(id); if (el) el.classList.remove('hidden'); }
function toggleEl(id, cls, force) { const el = $(id); if (el) el.classList.toggle(cls, force); }
function createEl(tag, className, text) { const el = document.createElement(tag); if (className) el.className = className; if (text != null) el.textContent = text; return el; }
// Loading overlay for async operations
function showLoading(msg = '加载中...') {
  let overlay = $('globalLoadingOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'globalLoadingOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.3);';
    const box = document.createElement('div');
    box.style.cssText = 'background:#fff;padding:20px 30px;border-radius:12px;text-align:center;box-shadow:0 4px 20px rgba(0,0,0,0.15);';
    box.innerHTML = '<div style="width:28px;height:28px;border:3px solid #e0e0e0;border-top-color:#07c160;border-radius:50%;animation:spin .6s linear infinite;margin:0 auto 10px;"></div>';
    const txt = document.createElement('div');
    txt.id = 'globalLoadingText';
    txt.style.cssText = 'font-size:14px;color:#333;';
    txt.textContent = msg;
    box.appendChild(txt);
    overlay.appendChild(box);
    if (!document.getElementById('spinKeyframes')) {
      const style = document.createElement('style');
      style.id = 'spinKeyframes';
      style.textContent = '@keyframes spin{to{transform:rotate(360deg)}}';
      document.head.appendChild(style);
    }
    document.body.appendChild(overlay);
  } else {
    const txt = $('globalLoadingText');
    if (txt) txt.textContent = msg;
    overlay.style.display = 'flex';
  }
}
function hideLoading() {
  const overlay = $('globalLoadingOverlay');
  if (overlay) overlay.style.display = 'none';
}
// Double-click prevention: wraps an async handler so the button is disabled during execution
function withButtonLock(btn, asyncFn, loadingText) {
  if (!btn || btn.disabled) return;
  const origText = btn.textContent;
  btn.disabled = true;
  if (loadingText) btn.textContent = loadingText;
  Promise.resolve(asyncFn()).catch((e) => { showModal(e?.message || '操作失败'); }).finally(() => {
    btn.disabled = false;
    if (loadingText) btn.textContent = origText;
  });
}
function showToast(msg, duration = 2000){
  let el = document.getElementById('_toast');
  if(!el){
    el = document.createElement('div');
    el.id = '_toast';
    el.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,.76);color:#fff;padding:10px 22px;border-radius:8px;font-size:14px;z-index:99999;pointer-events:none;opacity:0;transition:opacity .25s;white-space:nowrap;';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.opacity = '1';
  clearTimeout(el._timer);
  el._timer = setTimeout(() => { el.style.opacity = '0'; }, duration);
}

// ---- Custom Modal Dialog (replaces native alert) ----
function showModal(msg, onOk) {
  let overlay = document.getElementById('_appModal');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = '_appModal';
    overlay.innerHTML =
      '<div class="app-modal-mask"></div>' +
      '<div class="app-modal-box">' +
        '<div class="app-modal-body"></div>' +
        '<div class="app-modal-footer">' +
          '<button class="app-modal-cancel" style="display:none">取消</button>' +
          '<button class="app-modal-ok">确定</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    // Style
    const s = document.createElement('style');
    s.textContent =
      '#_appModal{position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;}' +
      '#_appModal.hidden{display:none;}' +
      '.app-modal-mask{position:absolute;inset:0;background:rgba(0,0,0,.45);}' +
      '.app-modal-box{position:relative;width:280px;max-width:85vw;background:#fff;border-radius:14px;overflow:hidden;text-align:center;animation:modalIn .2s ease;}' +
      '@keyframes modalIn{from{transform:scale(.85);opacity:0}to{transform:scale(1);opacity:1}}' +
      '.app-modal-body{padding:24px 20px 16px;font-size:15px;line-height:1.5;color:#333;word-break:break-word;white-space:pre-wrap;max-height:60vh;overflow-y:auto;}' +
      '.app-modal-footer{display:flex;border-top:0.5px solid #e5e7eb;}' +
      '.app-modal-footer button{flex:1;height:44px;border:none;background:transparent;font-size:16px;cursor:pointer;transition:background .15s;}' +
      '.app-modal-footer button:active{background:#f2f2f6;}' +
      '.app-modal-cancel{color:#999;border-right:0.5px solid #e5e7eb !important;}' +
      '.app-modal-ok{color:#07c160;font-weight:600;}';
    document.head.appendChild(s);
  }
  overlay.classList.remove('hidden');
  overlay.querySelector('.app-modal-body').textContent = msg;
  const cancelBtn = overlay.querySelector('.app-modal-cancel');
  const okBtn = overlay.querySelector('.app-modal-ok');
  cancelBtn.style.display = 'none';
  const close = () => { overlay.classList.add('hidden'); };
  okBtn.onclick = () => { close(); if (onOk) onOk(); };
  overlay.querySelector('.app-modal-mask').onclick = close;
}
function showConfirm(msg, onOk, onCancel) {
  showModal(msg);
  const overlay = document.getElementById('_appModal');
  const cancelBtn = overlay.querySelector('.app-modal-cancel');
  const okBtn = overlay.querySelector('.app-modal-ok');
  cancelBtn.style.display = '';
  cancelBtn.onclick = () => { overlay.classList.add('hidden'); if (onCancel) onCancel(); };
  okBtn.onclick = () => { overlay.classList.add('hidden'); if (onOk) onOk(); };
}

function showPrompt(msg, defaultValue, onOk, onCancel) {
  let overlay = document.getElementById('_appPrompt');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = '_appPrompt';
    overlay.innerHTML =
      '<div class="app-modal-mask"></div>' +
      '<div class="app-modal-box">' +
        '<div class="app-modal-body"></div>' +
        '<div style="padding:0 20px 16px;"><input id="_appPromptInput" type="text" style="width:100%;box-sizing:border-box;height:40px;border:1px solid #ddd;border-radius:8px;padding:0 12px;font-size:15px;outline:none;" /></div>' +
        '<div class="app-modal-footer">' +
          '<button class="app-modal-cancel">取消</button>' +
          '<button class="app-modal-ok">确定</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    const s = document.createElement('style');
    s.textContent =
      '#_appPrompt{position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;}' +
      '#_appPrompt.hidden{display:none;}' +
      '#_appPrompt .app-modal-mask{position:absolute;inset:0;background:rgba(0,0,0,.45);}' +
      '#_appPrompt .app-modal-box{position:relative;width:280px;max-width:85vw;background:#fff;border-radius:14px;overflow:hidden;text-align:center;animation:modalIn .2s ease;}' +
      '#_appPrompt .app-modal-body{padding:24px 20px 12px;font-size:15px;line-height:1.5;color:#333;}' +
      '#_appPrompt .app-modal-footer{display:flex;border-top:0.5px solid #e5e7eb;}' +
      '#_appPrompt .app-modal-footer button{flex:1;height:44px;border:none;background:transparent;font-size:16px;cursor:pointer;}' +
      '#_appPrompt .app-modal-footer button:active{background:#f2f2f6;}' +
      '#_appPrompt .app-modal-cancel{color:#999;border-right:0.5px solid #e5e7eb !important;}' +
      '#_appPrompt .app-modal-ok{color:#07c160;font-weight:600;}';
    document.head.appendChild(s);
  }
  overlay.classList.remove('hidden');
  overlay.querySelector('.app-modal-body').textContent = msg;
  const input = document.getElementById('_appPromptInput');
  input.value = defaultValue != null ? String(defaultValue) : '';
  setTimeout(() => input.focus(), 100);
  const cancelBtn = overlay.querySelector('.app-modal-cancel');
  const okBtn = overlay.querySelector('.app-modal-ok');
  const close = () => { overlay.classList.add('hidden'); };
  cancelBtn.onclick = () => { close(); if (onCancel) onCancel(); };
  okBtn.onclick = () => { const val = input.value; close(); if (onOk) onOk(val); };
  overlay.querySelector('.app-modal-mask').onclick = () => { close(); if (onCancel) onCancel(); };
  input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); okBtn.click(); } };
}

function normalizePhoneInput(phone){
  const digits = String(phone || '').replace(/\D+/g, '');
  let normalized = digits;
  if (normalized.startsWith('86') && normalized.length === 13 && normalized[2] === '1') {
    normalized = normalized.slice(2);
  }
  if (!/^1\d{10}$/.test(normalized)) return '';
  return normalized;
}

function formatMoney(v){
  const n = Number(String(v).replace(/[^\d.]/g, '')) || 0;
  return `¥${n.toFixed(2)}`;
}

function parseMoney(v){
  return Number(String(v).replace(/[^\d.]/g, '')) || 0;
}

function normalizeMediaUrl(url) {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (trimmed.startsWith('data:image/') || trimmed.startsWith('data:audio/')) return trimmed;
  if (trimmed.startsWith('blob:')) return trimmed;
  if (trimmed.startsWith('/uploads/')) return trimmed;
  if (trimmed.startsWith('https://') || trimmed.startsWith('http://')) return trimmed;
  return '';
}
function setImagePreview(el, url, fallbackText = '+') {
  if (!el) return;
  const safe = normalizeMediaUrl(url);
  el.replaceChildren();
  if (!safe) { el.textContent = fallbackText; return; }
  const img = document.createElement('img');
  img.src = safe;
  img.style.width = '100%';
  img.style.height = '100%';
  img.style.objectFit = 'cover';
  img.style.borderRadius = 'inherit';
  img.alt = 'preview';
  el.appendChild(img);
}
function appendActionButton(container, label, handler) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = label;
  btn.addEventListener('click', handler);
  container.appendChild(btn);
  return btn;
}
// Create a button that stops event propagation on click
function createStopBtn(className, text, handler) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = className;
  btn.textContent = text;
  btn.addEventListener('click', (e) => { e.stopPropagation(); handler(e, btn); });
  return btn;
}
function renderAvatarHtml(userObj, fallbackName) {
  if (!userObj) return `<div class="avatar">${firstChar(fallbackName)}</div>`;
  const safeAvatar = normalizeMediaUrl(userObj.avatarUrl);
  if (safeAvatar) return `<div class="avatar"><img src="${safeAvatar}" alt="avatar" /></div>`;
  return `<div class="avatar">${firstChar(userObj.displayName || userObj.username || fallbackName)}</div>`;
}
function createAvatarNode(userObj, fallbackName) {
  const wrap = document.createElement('div');
  wrap.className = 'avatar';
  const safeAvatar = userObj ? normalizeMediaUrl(userObj.avatarUrl) : '';
  if (safeAvatar) {
    const img = document.createElement('img');
    img.src = safeAvatar;
    img.alt = 'avatar';
    img.onerror = function() { this.remove(); wrap.textContent = firstChar(userObj?.displayName || userObj?.username || fallbackName); };
    wrap.appendChild(img);
    return wrap;
  }
  wrap.textContent = firstChar(userObj?.displayName || userObj?.username || fallbackName);
  return wrap;
}
function setAvatarContainer(el, userObj, fallbackName) {
  if (!el) return;
  el.replaceChildren(createAvatarNode(userObj, fallbackName));
}


function canvasToBlob(canvas, type = 'image/jpeg', quality = 0.7) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('image_encode_failed'));
    }, type, quality);
  });
}
async function resizeImageFile(file, max = 1080, quality = 0.7) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('file_read_failed'));
    reader.readAsDataURL(file);
  });
  const img = await new Promise((resolve, reject) => {
    const instance = new Image();
    instance.onload = () => resolve(instance);
    instance.onerror = () => reject(new Error('image_load_failed'));
    instance.src = dataUrl;
  });
  let w = img.width;
  let h = img.height;
  if (w > max || h > max) {
    if (w > h) {
      h = Math.round(h * max / w);
      w = max;
    } else {
      w = Math.round(w * max / h);
      h = max;
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(img, 0, 0, w, h);
  return canvasToBlob(canvas, 'image/jpeg', quality);
}
async function uploadBinary(blob, fileName, contentType) {
  const safeFileName = String(fileName || 'upload.bin')
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 120) || 'upload.bin';
  const res = await api('/api/upload', {
    method: 'POST',
    headers: {
      'Content-Type': contentType || blob.type || 'application/octet-stream',
      'X-File-Name': safeFileName
    },
    body: blob
  });
  return res.url;
}

// Shared helper: compute start-of-day timestamp and time string from a Date
function _dayStartAndTime(d) {
  const hh = d.getHours(), mm = d.getMinutes();
  return {
    dayStart: d - hh * 3600000 - mm * 60000 - d.getSeconds() * 1000 - d.getMilliseconds(),
    hhmm: `${hh < 10 ? '0' + hh : hh}:${mm < 10 ? '0' + mm : mm}`,
  };
}

function formatTime(timestamp) {
  const d = new Date(timestamp);
  const { dayStart: msgDay, hhmm } = _dayStartAndTime(d);
  const { dayStart: todayStart } = _dayStartAndTime(new Date());
  if (msgDay === todayStart) return hhmm;
  if (todayStart - msgDay === 86400000) return `昨天 ${hhmm}`;
  return `${d.getMonth()+1}月${d.getDate()}日 ${hhmm}`;
}

const _WEEKDAYS = ['周日','周一','周二','周三','周四','周五','周六'];
function formatConversationTime(timestamp) {
  if (!timestamp) return '';
  const d = new Date(timestamp);
  const { dayStart: msgDay, hhmm } = _dayStartAndTime(d);
  const now = new Date();
  const { dayStart: todayStart } = _dayStartAndTime(now);
  const diffDays = Math.round((todayStart - msgDay) / 86400000);
  if (diffDays <= 0) return hhmm;
  if (diffDays === 1) return '昨天';
  if (diffDays < 7) return _WEEKDAYS[d.getDay()];
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth()+1}/${d.getDate()}`;
  return `${String(d.getFullYear()).slice(-2)}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
}

// Signature memoization: returns true if sig changed, false if same (skip render)
const _sigCache = {};
function sigChanged(key, newSig) {
  if (_sigCache[key] === newSig) return false;
  _sigCache[key] = newSig;
  return true;
}

// Build a profile-order-card element with title and subtitle
function buildProfileCard(titleText, subText, tagName) {
  const card = document.createElement(tagName || 'div');
  card.className = 'profile-order-card';
  if (tagName === 'button') card.type = 'button';
  const title = document.createElement('div');
  title.className = 'profile-order-title';
  title.textContent = titleText;
  const sub = document.createElement('div');
  sub.className = 'profile-order-sub';
  sub.textContent = subText;
  card.append(title, sub);
  return card;
}

// Create a flex info column with a bold name, and append it + avatar to a container
function appendUserInfo(container, avatarObj, displayText) {
  container.appendChild(createAvatarNode(avatarObj, displayText));
  const info = document.createElement('div');
  info.style.cssText = 'flex:1;min-width:0;text-align:left;';
  const strong = document.createElement('strong');
  strong.textContent = displayText;
  info.appendChild(strong);
  container.appendChild(info);
  return info;
}

// Render an empty-state placeholder inside a container
function showEmptyState(container, message, className) {
  const empty = document.createElement('div');
  empty.className = className || 'empty-state';
  empty.textContent = message;
  container.replaceChildren(empty);
}

// Reconcile a list of items into a container using signature-based diffing.
// Returns the new signatures map { key -> sig }.
// opts: { selector, keyFn(item), sigFn(item), buildFn(item), patchFn(existingNode, item), sigStore }
function reconcileList(container, items, opts) {
  const existingNodes = new Map(Array.from(container.querySelectorAll(opts.selector)).map(n => [n.dataset[opts.dataKey], n]));
  const nextSigs = {};
  const orderedNodes = [];
  items.forEach(item => {
    const key = opts.keyFn(item);
    const sig = opts.sigFn(item);
    nextSigs[key] = sig;
    const existing = existingNodes.get(key);
    let node = existing;
    if (!existing) node = opts.buildFn(item);
    else if (opts.sigStore[key] !== sig) node = opts.patchFn(existing, item);
    orderedNodes.push(node);
    existingNodes.delete(key);
  });
  const needsOrderUpdate = orderedNodes.length !== container.childElementCount || orderedNodes.some((n, i) => container.children[i] !== n);
  if (needsOrderUpdate) container.replaceChildren(...orderedNodes);
  else existingNodes.forEach(n => n.remove());
  return nextSigs;
}

function singleFlight(fn) {
  let inflight = null;
  return function (...args) {
    if (inflight) return inflight;
    inflight = fn.apply(this, args);
    const cleanup = () => { inflight = null; };
    inflight.then(cleanup, cleanup);
    return inflight;
  };
}
