# 语音/视频通话模块修复计划

## P0 — 安全漏洞修复

### Step 1: 服务端信令输入校验 ✅
**文件**: `conversation_action_service.js`

- `signal.type` 必须为 `offer` / `answer` / `candidate` 之一
- `mode` 必须为 `voice` / `video`
- `callId` 格式校验：字母数字下划线，6-80 字符
- SDP 长度限制 < 10KB，candidate < 2KB
- `senderName` 截断到 50 字符并移除 HTML 特殊字符
- `call` action 的 `event` 必须为 `start/accept/reject/end/cancel` 之一

### Step 2: 信令/通话速率限制 ✅
**文件**: `conversation_action_service.js`

- signal: 每用户每 5 秒最多 30 次
- call: 每用户每 10 秒最多 5 次
- 使用滑动窗口计数器实现

### Step 3: 通话事件权限验证 + 服务端通话状态追踪 ✅
**文件**: `conversation_action_service.js`

- `activeCalls` Map<callId, {initiator, recipient, state, startedAt, connectedAt}>
- `start`: 注册通话，记录 initiator/recipient
- `accept`: 校验 sender 是 recipient
- `reject/cancel/end`: 校验参与者身份
- 服务端计算通话时长 (connectedAt → end)
- 定期清理 > 4 小时的过期通话

## P1 — 可靠性修复

### Step 4: 修复 isCurrentCallPayload 逻辑 ✅
**文件**: `app_calling.js`

- 当任一方 callId 为空时返回 false

### Step 5: Answer 信令推送 fallback ✅
**文件**: `server.js`

- 对 `webrtc_signal:answer` 也做 push fallback
- 对 `call_event:accept/reject/cancel` 也做 push fallback

### Step 6: 状态卡死恢复 ✅
**文件**: `app_calling.js`

- 全局 watchdog：非 idle/connected 状态超过 45 秒自动结束通话
- createPeerConnection() 先关闭旧 PC
- stopCall() 清理 _callFloatingTimer 和 _callWatchdogTimer

## P2 — 增强功能

### Step 7: 服务端通话状态机强化 ✅
**文件**: `conversation_action_service.js`

- 强制事件顺序：ringing → accept/reject/cancel/end, connected → end
- 无效状态转换返回 409 错误
- 服务端计算通话时长，不信任客户端

### Step 8: TURN 服务器配置 ✅
**文件**: `server.js`, `app_calling.js`

- 添加 `/api/turn-config` 端点，使用 HMAC-SHA1 生成限时 TURN 凭证
- 客户端在创建 PeerConnection 前获取 TURN 凭证
- 环境变量: `TURN_SERVER_URL`, `TURN_SHARED_SECRET`
- 无 TURN 配置时优雅降级为 STUN only
