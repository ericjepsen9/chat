/* app_group_chat.js — Group chat UI: creation, settings, member management */

// ========== Multi-select friend picker for group creation ==========

let _gcSelectedMembers = new Map(); // id -> friend object

function openGroupChatCreator(preselectedIds) {
  _gcSelectedMembers = new Map();
  if (Array.isArray(preselectedIds)) {
    for (const id of preselectedIds) {
      const entry = state.friendsById.get(id);
      if (entry && entry.friend) _gcSelectedMembers.set(id, entry.friend);
    }
  }
  renderGroupMemberPicker();
  window.openSecondaryPage('groupCreatePage', state.activeConversation ? 'chat' : 'home');
}

function renderGroupMemberPicker(keyword) {
  const list = $('gcFriendList');
  if (!list) return;
  const search = (keyword ?? ($('gcSearchInput')?.value || '')).trim().toLowerCase();
  const allFriends = state.friends || [];

  const frag = document.createDocumentFragment();
  let count = 0;
  const seen = new Set();
  for (let i = 0; i < allFriends.length; i++) {
    const item = allFriends[i];
    const f = item.friend;
    if (!f) continue;
    if (seen.has(f.id)) continue;
    seen.add(f.id);
    const name = f.remark || f.displayName || f.username || '';
    if (search && !name.toLowerCase().includes(search) && !(f.username || '').toLowerCase().includes(search)) continue;

    const row = createEl('div', 'gc-friend-row');
    row.dataset.friendId = f.id;
    const cb = createEl('div', 'gc-checkbox' + (_gcSelectedMembers.has(f.id) ? ' checked' : ''));
    row.appendChild(cb);
    row.appendChild(createAvatarNode(f, name));
    row.appendChild(createEl('span', 'gc-friend-name', name));
    frag.appendChild(row);
    count++;
  }

  if (count === 0) {
    showEmptyState(list, search ? '未找到匹配的好友' : '暂无好友');
    return;
  }
  list.replaceChildren(frag);

  // Delegated click
  list.onclick = (e) => {
    const row = e.target.closest('.gc-friend-row');
    if (!row) return;
    const fid = row.dataset.friendId;
    const cb = row.querySelector('.gc-checkbox');
    if (_gcSelectedMembers.has(fid)) {
      _gcSelectedMembers.delete(fid);
      if (cb) cb.classList.remove('checked');
    } else {
      const entry = state.friendsById.get(fid);
      if (entry && entry.friend) _gcSelectedMembers.set(fid, entry.friend);
      if (cb) cb.classList.add('checked');
    }
    updateGcSelectedBar();
  };

  updateGcSelectedBar();
}

function updateGcSelectedBar() {
  const bar = $('gcSelectedBar');
  const btn = $('gcConfirmBtn');
  const countEl = $('gcSelectedCount');
  if (!bar) return;
  const count = _gcSelectedMembers.size;
  if (btn) {
    btn.textContent = count > 0 ? `完成(${count})` : '完成';
    btn.disabled = count < 2;
  }
  if (countEl) { countEl.textContent = count > 0 ? `已选择 ${count} 人` : ''; countEl.classList.toggle('hidden', count === 0); }

  // Render selected avatars
  const avatarBar = $('gcSelectedAvatars');
  if (avatarBar) {
    avatarBar.replaceChildren();
    for (const [, f] of _gcSelectedMembers) {
      const wrap = createEl('div', 'gc-selected-avatar');
      wrap.appendChild(createAvatarNode(f, f.displayName || ''));
      avatarBar.appendChild(wrap);
    }
    avatarBar.classList.toggle('hidden', count === 0);
  }
}

async function confirmCreateGroupChat() {
  if (_gcSelectedMembers.size < 2) return showModal('至少选择2个好友');
  const memberIds = Array.from(_gcSelectedMembers.keys());
  const btn = $('gcConfirmBtn');
  if (btn) { btn.disabled = true; btn.textContent = '创建中...'; }
  try {
    const res = await api('/api/group-chat/create', {
      method: 'POST',
      body: JSON.stringify({ memberIds }),
    });
    if (res.conversation) {
      await loadConversations();
      window.openConversation(res.conversation.id);
    }
  } catch (e) {
    showModal('创建群聊失败: ' + (e.message || '未知错误'));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '完成'; }
  }
}

// ========== Group chat settings page ==========

let _currentGroupDetail = null;

async function openGroupChatSettings(convId) {
  try {
    const data = await api(`/api/group-chat/${convId}`);
    _currentGroupDetail = data;
    renderGroupChatSettings(data);
    window.openSecondaryPage('groupChatSettingsPage', 'chat');
  } catch (e) {
    showModal('获取群信息失败');
  }
}

function renderGroupChatSettings(data) {
  if (!data) return;
  const uid = state.currentUser?.id;
  const isOwner = data.ownerId === uid;
  const isAdmin = isOwner || (data.admins || []).includes(uid);

  // Member grid
  const grid = $('gcSettingsMembers');
  if (grid) {
    grid.replaceChildren();
    const showMembers = (data.members || []).slice(0, 20);
    for (const m of showMembers) {
      const item = createEl('div', 'gc-member-grid-item');
      item.appendChild(createAvatarNode(m, m.displayName || ''));
      const nameEl = createEl('div', 'gc-member-grid-name', m.nickname || m.displayName || '');
      if (m.isOwner) {
        const badge = createEl('span', 'gc-role-badge owner', '群主');
        nameEl.appendChild(badge);
      } else if (m.isAdmin) {
        const badge = createEl('span', 'gc-role-badge admin', '管理');
        nameEl.appendChild(badge);
      }
      item.appendChild(nameEl);
      item.addEventListener('click', () => window.openUserProfile(m.id, m.displayName));
      grid.appendChild(item);
    }
    // Add member button
    const addBtn = createEl('div', 'gc-member-grid-item gc-member-add-btn');
    addBtn.innerHTML = '<div class="gc-add-icon">+</div><div class="gc-member-grid-name">邀请</div>';
    addBtn.addEventListener('click', () => openGroupInvitePicker(data.id));
    grid.appendChild(addBtn);
    // Remove member button (owner/admin only)
    if (isAdmin) {
      const removeBtn = createEl('div', 'gc-member-grid-item gc-member-remove-btn');
      removeBtn.innerHTML = '<div class="gc-remove-icon">−</div><div class="gc-member-grid-name">移除</div>';
      removeBtn.addEventListener('click', () => openGroupRemovePicker(data));
      grid.appendChild(removeBtn);
    }
  }

  // View all members
  const viewAll = $('gcViewAllMembers');
  if (viewAll) viewAll.textContent = `查看全部群成员 (${data.memberCount || 0})`;

  // Group name
  const nameEl = $('gcSettingsName');
  if (nameEl) nameEl.textContent = data.name || '群聊';

  // Announcement
  const annEl = $('gcSettingsAnnouncement');
  if (annEl) annEl.textContent = data.announcement || '未设置';

  // My nickname
  const nickEl = $('gcSettingsNickname');
  if (nickEl) nickEl.textContent = data.myNickname || '未设置';

  // Mute toggle
  const muteBtn = $('gcMuteBtn');
  if (muteBtn) muteBtn.textContent = data.muted ? '消息免打扰 ✓' : '消息免打扰';

  // Pin toggle
  const pinBtn = $('gcPinBtn');
  if (pinBtn) pinBtn.textContent = data.pinned ? '置顶聊天 ✓' : '置顶聊天';

  // Bottom action
  const actionBtn = $('gcLeaveBtn');
  if (actionBtn) {
    actionBtn.textContent = isOwner ? '解散群聊' : '退出群聊';
    actionBtn.onclick = isOwner ? () => confirmDismissGroup(data.id) : () => confirmLeaveGroup(data.id);
  }

  // Transfer button (owner only)
  const transferBtn = $('gcTransferBtn');
  if (transferBtn) {
    transferBtn.classList.toggle('hidden', !isOwner);
  }
}

// ========== Group invite picker ==========

async function openGroupInvitePicker(convId) {
  _gcSelectedMembers = new Map();
  await loadFriends(true);
  const detail = _currentGroupDetail;
  const existingIds = new Set((detail?.members || []).map(m => m.id));

  const list = $('gcInviteList');
  if (!list) return;
  const allFriends = state.friends || [];
  const frag = document.createDocumentFragment();
  for (const item of allFriends) {
    const f = item.friend;
    if (!f || existingIds.has(f.id)) continue;
    const row = createEl('div', 'gc-friend-row');
    row.dataset.friendId = f.id;
    row.appendChild(createEl('div', 'gc-checkbox'));
    row.appendChild(createAvatarNode(f, f.remark || f.displayName || ''));
    row.appendChild(createEl('span', 'gc-friend-name', f.remark || f.displayName || f.username || ''));
    frag.appendChild(row);
  }
  list.replaceChildren(frag);
  list.onclick = (e) => {
    const row = e.target.closest('.gc-friend-row');
    if (!row) return;
    const fid = row.dataset.friendId;
    const cb = row.querySelector('.gc-checkbox');
    if (_gcSelectedMembers.has(fid)) {
      _gcSelectedMembers.delete(fid);
      if (cb) cb.classList.remove('checked');
    } else {
      const entry = state.friendsById.get(fid);
      if (entry) _gcSelectedMembers.set(fid, entry.friend);
      if (cb) cb.classList.add('checked');
    }
    const btn = $('gcInviteConfirmBtn');
    if (btn) btn.textContent = _gcSelectedMembers.size > 0 ? `确定(${_gcSelectedMembers.size})` : '确定';
  };
  $('gcInviteConfirmBtn').onclick = async () => {
    if (!_gcSelectedMembers.size) return;
    try {
      await api(`/api/group-chat/${convId}/members/add`, {
        method: 'POST',
        body: JSON.stringify({ memberIds: Array.from(_gcSelectedMembers.keys()) }),
      });
      showModal('邀请成功');
      if ($('backBtn')) $('backBtn').click();
      // Refresh settings
      openGroupChatSettings(convId);
    } catch (e) {
      showModal('邀请失败: ' + (e.message || ''));
    }
  };
  window.openSecondaryPage('gcInvitePage', 'groupChatSettingsPage');
}

// ========== Group remove picker ==========

function openGroupRemovePicker(detail) {
  const uid = state.currentUser?.id;
  const isOwner = detail.ownerId === uid;
  const list = $('gcRemoveList');
  if (!list) return;
  const frag = document.createDocumentFragment();
  for (const m of (detail.members || [])) {
    if (m.id === uid) continue;
    if (!isOwner && m.isAdmin) continue; // admins can't remove other admins
    if (m.isOwner) continue;
    const row = createEl('div', 'gc-friend-row gc-remove-row');
    row.dataset.memberId = m.id;
    row.appendChild(createAvatarNode(m, m.displayName || ''));
    row.appendChild(createEl('span', 'gc-friend-name', m.nickname || m.displayName || ''));
    if (m.isAdmin) row.appendChild(createEl('span', 'gc-role-badge admin', '管理'));
    const removeBtn = createEl('button', 'gc-remove-action-btn', '移除');
    removeBtn.type = 'button';
    removeBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      showConfirm(`确定将 ${m.displayName || '该成员'} 移出群聊？`, async () => {
        try {
          await api(`/api/group-chat/${detail.id}/members/remove`, {
            method: 'POST',
            body: JSON.stringify({ memberId: m.id }),
          });
          showModal('已移除');
          if ($('backBtn')) $('backBtn').click();
          openGroupChatSettings(detail.id);
        } catch (err) {
          showModal('移除失败: ' + (err.message || ''));
        }
      });
    });
    row.appendChild(removeBtn);
    frag.appendChild(row);
  }
  list.replaceChildren(frag);
  window.openSecondaryPage('gcRemovePage', 'groupChatSettingsPage');
}

// ========== Group actions ==========

function confirmLeaveGroup(convId) {
  showConfirm('确定退出该群聊？退出后将不再接收此群消息。', async () => {
    try {
      await api(`/api/group-chat/${convId}/members/leave`, { method: 'POST', body: '{}' });
      showModal('已退出群聊');
      state.activeConversation = null;
      await loadConversations();
      // Go back to chat list
      if ($('backBtn')) $('backBtn').click();
      if ($('backBtn')) $('backBtn').click();
    } catch (e) {
      showModal(e.message || '退出失败');
    }
  });
}

function confirmDismissGroup(convId) {
  showConfirm('解散群聊后所有成员将被移除，确定解散？', async () => {
    try {
      await api(`/api/group-chat/${convId}/dismiss`, { method: 'POST', body: '{}' });
      showModal('群聊已解散');
      state.activeConversation = null;
      await loadConversations();
      if ($('backBtn')) $('backBtn').click();
      if ($('backBtn')) $('backBtn').click();
    } catch (e) {
      showModal(e.message || '解散失败');
    }
  });
}

async function editGroupName(convId) {
  const current = _currentGroupDetail?.name || '';
  showPrompt('修改群聊名称', current, async (val) => {
    if (!val || !val.trim()) return;
    try {
      await api(`/api/group-chat/${convId}/update`, {
        method: 'POST',
        body: JSON.stringify({ name: val.trim() }),
      });
      // Update local state
      if (state.activeConversation) state.activeConversation.title = val.trim();
      setText('chatTitle', val.trim() + `(${_currentGroupDetail?.memberCount || ''})`);
      loadConversations();
      openGroupChatSettings(convId);
    } catch (e) {
      showModal(e.message || '修改失败');
    }
  });
}

async function editGroupAnnouncement(convId) {
  const current = _currentGroupDetail?.announcement || '';
  showPrompt('修改群公告', current, async (val) => {
    try {
      await api(`/api/group-chat/${convId}/update`, {
        method: 'POST',
        body: JSON.stringify({ announcement: (val || '').trim() }),
      });
      openGroupChatSettings(convId);
    } catch (e) {
      showModal(e.message || '修改失败');
    }
  });
}

async function editGroupNickname(convId) {
  const current = _currentGroupDetail?.myNickname || '';
  showPrompt('我在本群的昵称', current, async (val) => {
    try {
      await api(`/api/group-chat/${convId}/nickname`, {
        method: 'POST',
        body: JSON.stringify({ nickname: (val || '').trim() }),
      });
      openGroupChatSettings(convId);
    } catch (e) {
      showModal(e.message || '修改失败');
    }
  });
}

async function transferGroupOwnership(convId) {
  const detail = _currentGroupDetail;
  if (!detail) return;
  const uid = state.currentUser?.id;
  const candidates = (detail.members || []).filter(m => m.id !== uid);
  if (!candidates.length) return showModal('没有可转让的成员');

  const picked = await showTradePicker('选择新群主', candidates, (m) => m.nickname || m.displayName || '用户', '没有可选成员');
  if (!picked) return;

  showConfirm(`确定将群主转让给 ${picked.displayName || '该成员'}？`, async () => {
    try {
      await api(`/api/group-chat/${convId}/transfer`, {
        method: 'POST',
        body: JSON.stringify({ newOwnerId: picked.id }),
      });
      showModal('群主已转让');
      openGroupChatSettings(convId);
    } catch (e) {
      showModal(e.message || '转让失败');
    }
  });
}

// ========== Group member list page ==========

function openGroupMemberList(detail) {
  const list = $('gcMemberListContent');
  if (!list) return;
  const uid = state.currentUser?.id;
  const isOwner = detail.ownerId === uid;
  const frag = document.createDocumentFragment();
  for (const m of (detail.members || [])) {
    const row = createEl('div', 'gc-friend-row');
    row.appendChild(createAvatarNode(m, m.displayName || ''));
    const nameText = m.nickname || m.displayName || '';
    const nameEl = createEl('span', 'gc-friend-name', nameText);
    if (m.isOwner) nameEl.appendChild(createEl('span', 'gc-role-badge owner', '群主'));
    else if (m.isAdmin) nameEl.appendChild(createEl('span', 'gc-role-badge admin', '管理'));
    row.appendChild(nameEl);
    row.addEventListener('click', () => window.openUserProfile(m.id, m.displayName));
    frag.appendChild(row);
  }
  list.replaceChildren(frag);
  window.openSecondaryPage('gcMemberListPage', 'groupChatSettingsPage');
}

// ========== @ mention picker ==========

function openAtMentionPicker() {
  const conv = state.activeConversation;
  if (!conv || conv.type !== 'group') return null;
  const detail = _currentGroupDetail;
  const members = detail?.members || [];
  const uid = state.currentUser?.id;

  return new Promise((resolve) => {
    const sheet = $('gcAtPickerSheet');
    if (!sheet) return resolve(null);
    const list = $('gcAtPickerList');
    if (!list) return resolve(null);

    const frag = document.createDocumentFragment();
    // "All" option
    const allRow = createEl('div', 'gc-friend-row');
    allRow.appendChild(createEl('div', 'gc-at-all-icon', '@'));
    allRow.appendChild(createEl('span', 'gc-friend-name', '所有人'));
    allRow.addEventListener('click', () => { close({ id: 'all', name: '所有人' }); });
    frag.appendChild(allRow);

    for (const m of members) {
      if (m.id === uid) continue;
      const row = createEl('div', 'gc-friend-row');
      row.appendChild(createAvatarNode(m, m.displayName || ''));
      row.appendChild(createEl('span', 'gc-friend-name', m.nickname || m.displayName || ''));
      row.addEventListener('click', () => { close({ id: m.id, name: m.nickname || m.displayName || '' }); });
      frag.appendChild(row);
    }
    list.replaceChildren(frag);
    sheet.classList.remove('hidden');

    function close(val) {
      sheet.classList.add('hidden');
      resolve(val);
    }
    $('gcAtPickerClose')?.addEventListener('click', () => close(null), { once: true });
  });
}

// ========== Group grid avatar helper ==========

function buildGroupAvatar(memberAvatars, title) {
  const wrap = createEl('div', 'gc-grid-avatar');
  const avatars = (memberAvatars || []).slice(0, 9);
  const count = avatars.length;
  const gridClass = count <= 4 ? 'grid-2' : count <= 9 ? 'grid-3' : 'grid-3';
  wrap.classList.add(gridClass);

  for (let i = 0; i < Math.min(count, 9); i++) {
    const url = normalizeMediaUrl(avatars[i]);
    if (url) {
      const img = createEl('img', 'gc-grid-avatar-img');
      img.src = url;
      img.alt = '';
      img.onerror = function() { this.replaceWith(createEl('div', 'gc-grid-avatar-fallback', firstChar(title))); };
      wrap.appendChild(img);
    } else {
      wrap.appendChild(createEl('div', 'gc-grid-avatar-fallback', firstChar(title)));
    }
  }
  return wrap;
}

// ========== Event bindings for static group chat page elements ==========
// Replaces the previous inline onclick / oninput handlers that were blocked by
// the Content-Security-Policy (script-src 'self') declared in index.html:7.
// Called exactly once from bindAllEvents() in app.js. All referenced elements
// live in two static sections of index.html (groupCreatePage and
// groupChatSettingsPage), so one-shot addEventListener on them is sufficient.
function bindGroupChatEvents() {
  // --- Group creation page ---
  const searchInput = $('gcSearchInput');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => renderGroupMemberPicker(e.target.value));
  }
  const confirmBtn = $('gcConfirmBtn');
  if (confirmBtn) {
    confirmBtn.addEventListener('click', () => { confirmCreateGroupChat(); });
  }

  // --- Group settings page ---
  const viewAllBtn = $('gcViewAllMembers');
  if (viewAllBtn) {
    viewAllBtn.addEventListener('click', () => {
      if (_currentGroupDetail) openGroupMemberList(_currentGroupDetail);
    });
  }
  const editNameBtn = $('gcEditNameBtn');
  if (editNameBtn) {
    editNameBtn.addEventListener('click', () => {
      if (_currentGroupDetail) editGroupName(_currentGroupDetail.id);
    });
  }
  const editAnnBtn = $('gcEditAnnouncementBtn');
  if (editAnnBtn) {
    editAnnBtn.addEventListener('click', () => {
      if (_currentGroupDetail) editGroupAnnouncement(_currentGroupDetail.id);
    });
  }
  const editNickBtn = $('gcEditNicknameBtn');
  if (editNickBtn) {
    editNickBtn.addEventListener('click', () => {
      if (_currentGroupDetail) editGroupNickname(_currentGroupDetail.id);
    });
  }
  const muteBtn = $('gcMuteBtn');
  if (muteBtn) {
    muteBtn.addEventListener('click', () => {
      if (state.activeConversation && typeof window.toggleAction === 'function') {
        window.toggleAction('mute');
      }
    });
  }
  const pinBtn = $('gcPinBtn');
  if (pinBtn) {
    pinBtn.addEventListener('click', () => {
      if (state.activeConversation && typeof window.toggleAction === 'function') {
        window.toggleAction('pin');
      }
    });
  }
  const clearBtn = $('gcClearChatBtn');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      if (state.activeConversation && typeof window.clearChat === 'function') {
        window.clearChat();
      }
    });
  }
  const transferBtn = $('gcTransferBtn');
  if (transferBtn) {
    transferBtn.addEventListener('click', () => {
      if (_currentGroupDetail) transferGroupOwnership(_currentGroupDetail.id);
    });
  }
}
