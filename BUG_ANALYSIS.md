# 项目 Bug 梳理与分析（安全 / 性能 / 逻辑）

本文基于当前代码做静态审查与基础可运行验证，按「安全漏洞」「性能问题」「逻辑错误」分类整理。

## 一、安全漏洞

### 1) `/api/admin/dashboard` 缺少管理员权限校验（高危）✅ 已修复
- **现象**：只要是任意已登录用户，就可访问全平台统计、订单、用户列表、商品列表等后台数据。
- **修复**：所有 admin 路由已统一使用 `adminGuard` → `requireAdmin` 校验管理员身份。

### 2) `/api/orders` 可通过 `userId` 参数越权读取他人订单（高危）✅ 已修复
- **现象**：`GET /api/orders?userId=<任意用户ID>` 时，后端按传入 `userId` 过滤订单。
- **修复**：`order_query_service.js` 中非管理员用户强制使用 `authUser.id`，忽略外部 `userId` 参数。

### 3) 登录接口无频控/锁定策略，存在暴力破解风险（中危）✅ 已修复
- **修复**：已增加 IP 维度限速（`loginAttempts`、`recordLoginAttempt`）和失败退避机制。

### 4) 会话令牌长期有效且仅保存在内存（中危）✅ 已修复
- **修复**：会话已增加 7 天 TTL 过期机制。

### 5) Token 放在 URL 查询串用于 SSE（中危）
- **现象**：前端通过 `EventSource('/api/events?token=...')` 传 token；服务端也接受 query token。
- **风险**：URL 可能进入代理/日志/历史记录，泄露认证信息。
- **建议**：优先使用 Cookie（HttpOnly/Secure/SameSite）或短期一次性 SSE 凭证；至少避免长期主 token 出现在 URL。

### 6) 管理端大量 `innerHTML` 渲染未转义文本（中危）✅ 已修复
- **修复**：`esc()` 函数已包含单引号转义（`'` → `&#39;`），覆盖 XSS 常见注入点。

### 6.1) 短信验证码校验被跳过（高危）✅ 已修复
- **现象**：`consumePhoneCode` 函数中所有验证码校验逻辑被注释，任意验证码均可通过。
- **修复**：恢复了完整的验证码校验逻辑，包括过期检查、错误码比对、暴力破解防护（最多 6 次尝试后锁定 10 分钟）。测试环境通过 `EXPOSE_MOCK_PHONE_CODE=1` 环境变量在 send-code 响应中返回验证码。

## 二、性能问题

### 7) 密码哈希/校验使用同步 `scryptSync`，阻塞事件循环（中危）✅ 已修复
- **修复**：登录/注册路径已全部使用异步 `hashPasswordAsync` / `verifyPasswordAsync`。同步版本仅用于启动时初始化种子数据。scrypt N 参数已从 65536 降至 16384 以适应内存受限环境。

### 8) WAL 与截断使用同步文件 I/O（中危）
- **现象**：`appendWal`、`truncateWalIfLarge` 使用 `appendFileSync/statSync/openSync/readSync/writeFileSync`。
- **影响**：高频写入时阻塞主线程，影响接口尾延迟。
- **建议**：改为异步流式写入；可按批次缓冲后落盘。

### 9) 管理看板统计存在 O(U×O) 级重复遍历（中低）✅ 已修复
- **修复**：`admin_dashboard_service.js` 已使用单次遍历 + Map 聚合方式构建统计数据。

## 三、逻辑错误

### 10) 广播接口引用了不存在的索引字段，导致功能不可用（高）✅ 已修复
- **修复**：`broadcast_service.js` 已使用正确的 `index.convById`，`canAccessConversation` 函数已在 `server_roles.js` 中定义并正确传入。

### 11) 黑名单统计口径错误，后台风控数据失真（中）✅ 已修复
- **修复**：`admin_dashboard_service.js` 已从 `user.blacklist` 数组正确聚合黑名单统计。

### 12) 管理端 token 读取与主站存储协议不一致（中）✅ 已修复
- **修复**：`admin_console.js` 已支持先读取 `ADMIN_SESSION_KEY`，失败后回退读取主站 `SESSION_KEY`。

### 13) 会话成员检查不一致导致潜在崩溃（高）✅ 已修复
- **现象**：`server_routes_chat.js` 中部分路由直接使用 `conv._memberSet.has()` 而无 fallback，当 `_memberSet` 未初始化时会抛出 TypeError。
- **修复**：统一使用安全的三元表达式：`conv._memberSet ? conv._memberSet.has(id) : conv.members.includes(id)`。

### 14) 订单查询分页前未排序，新订单可能不在首页（中）✅ 已修复
- **现象**：`order_query_service.js` 在迭代中同时过滤和分页，导致排序仅作用于已分页的结果。新创建的订单被追加到索引末尾，可能超出首页范围。
- **修复**：先过滤全部匹配订单，再按 `createdAt` 降序排序，最后分页返回。

---

## 优先级建议（先修复）
1. ~~**P0**：越权读取（admin dashboard、orders userId）~~ ✅
2. ~~**P1**：广播功能不可用（字段/函数引用错误）~~ ✅
3. ~~**P1**：XSS 风险点（admin_console `innerHTML`）~~ ✅
4. **P2**：SSE token 泄露风险（query string token）— 待优化
5. **P2**：WAL 同步 I/O 阻塞 — 待优化

## 已执行验证
- 单元测试：`node scripts/unit-tests.js` — 32 项全部通过。
- 烟测脚本：`EXPOSE_MOCK_PHONE_CODE=1 node scripts/smoke-test.js` — 全部通过（含边界用例）。
- 本文以静态代码审查为主，未做渗透式 PoC 注入；建议后续补自动化安全测试。
