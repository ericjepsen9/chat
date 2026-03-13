/* app_datepicker.js — WeChat-style date picker extracted from app.js */

/* ── WeChat-style Date Picker ── */
const _dp = {
  overlay: null, callback: null, role: '', which: '',
  cols: { year: null, month: null, day: null, hour: null, minute: null },
  ranges: { year: [], month: [], day: [], hour: [], minute: [] },
  selected: { year: 0, month: 0, day: 0, hour: 0, minute: 0 },
};

function dpInit() {
  _dp.overlay = $('datePickerOverlay');
  _dp.cols.year = $('dpColYear');
  _dp.cols.month = $('dpColMonth');
  _dp.cols.day = $('dpColDay');
  _dp.cols.hour = $('dpColHour');
  _dp.cols.minute = $('dpColMinute');
}

function dpBuildItems(col, items, selectedVal) {
  if (!col) return;
  const ITEM_H = 44;
  const padCount = 2; // blank items top/bottom for centering
  col.innerHTML = '';
  for (let i = 0; i < padCount; i++) {
    const pad = document.createElement('div');
    pad.className = 'dp-item dp-pad';
    col.appendChild(pad);
  }
  items.forEach((item) => {
    const el = document.createElement('div');
    el.className = 'dp-item';
    el.textContent = item.label;
    el.dataset.value = item.value;
    if (item.value === selectedVal) el.classList.add('selected');
    col.appendChild(el);
  });
  for (let i = 0; i < padCount; i++) {
    const pad = document.createElement('div');
    pad.className = 'dp-item dp-pad';
    col.appendChild(pad);
  }
  // Scroll to selected
  const idx = items.findIndex(i => i.value === selectedVal);
  if (idx >= 0) col.scrollTop = idx * ITEM_H;
}

function dpGetSelectedIndex(col) {
  const ITEM_H = 44;
  const scrollTop = col.scrollTop;
  return Math.round(scrollTop / ITEM_H);
}

function dpHighlight(col, items) {
  const idx = dpGetSelectedIndex(col);
  const allItems = col.querySelectorAll('.dp-item:not(.dp-pad)');
  allItems.forEach((el, i) => {
    el.classList.toggle('selected', i === idx);
  });
  return items[idx]?.value;
}

function dpDaysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function dpRebuildDays() {
  const y = _dp.selected.year;
  const m = _dp.selected.month;
  const maxD = dpDaysInMonth(y, m);
  const days = [];
  for (let d = 1; d <= maxD; d++) days.push({ value: d, label: d + '日' });
  _dp.ranges.day = days;
  if (_dp.selected.day > maxD) _dp.selected.day = maxD;
  dpBuildItems(_dp.cols.day, days, _dp.selected.day);
}

// Store scroll handler references for cleanup
const _dpScrollHandlers = {};

function dpSetupScroll(col, key, items, onChange) {
  // Remove previous handler if exists
  if (_dpScrollHandlers[key]) {
    col.removeEventListener('scroll', _dpScrollHandlers[key]);
  }
  let timer = null;
  const handler = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const val = dpHighlight(col, items());
      if (val !== undefined) {
        _dp.selected[key] = val;
        if (onChange) onChange();
      }
    }, 80);
  };
  _dpScrollHandlers[key] = handler;
  col.addEventListener('scroll', handler, { passive: true });
}

function openDatePicker(role, which, currentVal) {
  if (!_dp.overlay) dpInit();
  _dp.role = role;
  _dp.which = which;

  const now = new Date();
  let d = currentVal ? new Date(currentVal) : now;
  if (isNaN(d.getTime())) d = now;

  _dp.selected.year = d.getFullYear();
  _dp.selected.month = d.getMonth() + 1;
  _dp.selected.day = d.getDate();
  _dp.selected.hour = d.getHours();
  _dp.selected.minute = d.getMinutes();

  // Build year range: current year -2 to +1
  const curYear = now.getFullYear();
  const years = [];
  for (let y = curYear - 2; y <= curYear + 1; y++) years.push({ value: y, label: y + '年' });
  _dp.ranges.year = years;

  const months = [];
  for (let m = 1; m <= 12; m++) months.push({ value: m, label: m + '月' });
  _dp.ranges.month = months;

  const hours = [];
  for (let h = 0; h < 24; h++) hours.push({ value: h, label: String(h).padStart(2, '0') + '时' });
  _dp.ranges.hour = hours;

  const minutes = [];
  for (let mi = 0; mi < 60; mi += 5) minutes.push({ value: mi, label: String(mi).padStart(2, '0') + '分' });
  _dp.ranges.minute = minutes;
  // Snap minute to nearest 5
  _dp.selected.minute = Math.round(_dp.selected.minute / 5) * 5;
  if (_dp.selected.minute >= 60) { _dp.selected.minute = 0; _dp.selected.hour = (_dp.selected.hour + 1) % 24; }

  dpBuildItems(_dp.cols.year, years, _dp.selected.year);
  dpBuildItems(_dp.cols.month, months, _dp.selected.month);
  dpRebuildDays();
  dpBuildItems(_dp.cols.hour, hours, _dp.selected.hour);
  dpBuildItems(_dp.cols.minute, minutes, _dp.selected.minute);

  // Re-attach scroll listeners (reuse elements, no cloning)
  ['year', 'month', 'day', 'hour', 'minute'].forEach(key => {
    const col = _dp.cols[key];
    const getItems = () => _dp.ranges[key];
    const onChange = (key === 'year' || key === 'month') ? dpRebuildDays : null;
    dpSetupScroll(col, key, getItems, onChange);
    const idx = _dp.ranges[key].findIndex(i => i.value === _dp.selected[key]);
    if (idx >= 0) col.scrollTop = idx * 44;
  });

  _dp.overlay.classList.remove('hidden');
}

function closeDatePicker(confirmed) {
  if (!_dp.overlay) return;
  _dp.overlay.classList.add('hidden');
  if (!confirmed) return;

  const { year, month, day, hour, minute } = _dp.selected;
  const dt = new Date(year, month - 1, day, hour, minute);
  const pad = n => String(n).padStart(2, '0');
  // Format as datetime-local compatible value
  const val = `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}`;

  const prefix = _dp.role === 'seller' ? 'seller' : 'buyer';
  const stateKey = _dp.which === 'from' ? `${prefix}OrderFrom` : `${prefix}OrderTo`;
  state[stateKey] = val;

  // Update hidden input
  const inputId = _dp.which === 'from' ? `${prefix}OrdersFromInput` : `${prefix}OrdersToInput`;
  const inp = $(inputId);
  if (inp) inp.value = val;

  // Update button text
  const btnId = _dp.which === 'from' ? `${prefix}OrdersFromBtn` : `${prefix}OrdersToBtn`;
  const btn = $(btnId);
  if (btn) {
    btn.textContent = `${year}/${pad(month)}/${pad(day)} ${pad(hour)}:${pad(minute)}`;
    btn.classList.remove('placeholder');
  }

  if (_dp.role === 'seller') renderSellerOrdersManage();
  else renderBuyerOrdersManage();
}

function syncOrderDateBtnText(role) {
  const prefix = role === 'seller' ? 'seller' : 'buyer';
  ['from', 'to'].forEach(which => {
    const stateKey = which === 'from' ? `${prefix}OrderFrom` : `${prefix}OrderTo`;
    const btnId = which === 'from' ? `${prefix}OrdersFromBtn` : `${prefix}OrdersToBtn`;
    const val = state[stateKey] || '';
    const btn = $(btnId);
    if (!btn) return;
    if (val) {
      const dt = new Date(val);
      if (!isNaN(dt.getTime())) {
        const pad = n => String(n).padStart(2, '0');
        btn.textContent = `${dt.getFullYear()}/${pad(dt.getMonth()+1)}/${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
        btn.classList.remove('placeholder');
        return;
      }
    }
    btn.textContent = '请选择';
    btn.classList.add('placeholder');
  });
}
