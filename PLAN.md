# 语音/视频通话模块修复计划

## P0 — 安全漏洞修复

### Step 1: 服务端信令输入校验
**文件**: `conversation_action_service.js`

- `signal.type` 必须为 `offer` / `answer` / `candidate` 之一
- `mode` 必须为 `voice` / `video`
- `callId` 格式校验：字母数字下划线，10-60 字符
- SDP 长度限制 < 10KB，candidate < 2KB
- `senderName` 截断到 50 字符
- `call` action 的 `event` 必须为 `start/accept/reject/end/cancel` 之一
- `durationSec` 范围 0-86400

### Step 2: 信令/通话速率限制
**文件**: `conversation_action_service.js`

- signal: 每用户每 5 秒最多 30 次
- call: 每用户每 10 秒最多 5 次
- 复用现有 `getRateLimitState` / `recordRateLimitAttempt`

### Step 3: 通话事件权限验证 + 服务端通话状态追踪
**文件**: `conversation_action_service.js` + `server.js`

- 新增 `activeCalls` Map<callId, {initiator, recipient, state, startedAt}>
- `start`: 注册通话，记录 initiator/recipient
- `accept`: 校验 sender 是 recipient
- `reject/cancel`: 校验 sender 是 initiator 或 recipient
- `end`: 校验参与者身份，服务端计算通话时长
- 定期清理 > 4 小时的过期通话

## P1 — 可靠性修复

### Step 4: 修复 isCurrentCallPayload 逻辑
**文件**: `app_calling.js`

- 当任一方 callId 为空时返回 false

### Step 5: Answer 信令推送 fallback
**文件**: `server.js`, `push_service.js`

- 对 `webrtc_signal:answer` 也做 push fallback
- SSE 广播时返回是否成功送达

### Step 6: 状态卡死恢复
**文件**: `app_calling.js`, `app.js`

- 全局 watchdog：非 idle/connected 状态超过 45 秒自动 stopCall()
- createPeerConnection() 先关闭旧 PC
- stopCall() 清理 _callFloatingTimer

## P2 — 增强功能

### Step 7: 服务端通话状态机强化
- 强制事件顺序：start → accept/reject → end
- 服务端计算通话时长，不信任客户端

### Step 8: TURN 服务器配置
- 添加 /api/turn-config 端点
- 客户端在创建 PC 前获取 TURN 凭证
