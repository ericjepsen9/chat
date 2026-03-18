# ChatTrade 全面代码审查报告

> 审查日期: 2026-03-18
> 审查范围: 45+ 源文件，~16,000 行 JS + ~5,800 行 CSS/HTML + Android 应用
> 审查方法: 分层分批 + 并行 Agent + 清单驱动（共 12 个审查 Agent）

---

## 总体统计

| 严重程度 | 数量 |
|---------|------|
| 🔴 高危 | **36** |
| 🟡 中危 | **83** |
| 🟢 低危 | **45** |
| **总计** | **164** |

### 按类别分布

| 类别 | 🔴高 | 🟡中 | 🟢低 | 合计 |
|------|------|------|------|------|
| 安全 | 24 | 38 | 12 | 74 |
| 逻辑正确性 | 8 | 25 | 8 | 41 |
| 代码质量 | 1 | 13 | 14 | 28 |
| 性能 | 0 | 10 | 11 | 21 |

---

## 🔴 高危问题（必须立即修复）

### 1. 手机验证码硬编码为 `1234`
- **文件**: `server_crypto.js:127`
- **问题**: 验证码固定为 `'1234'`，任何人可用此验证码登录、注册、重置密码任意账户
- **影响**: 所有基于手机验证码的认证流程被完全绕过
- **修复**: 使用 `crypto.randomInt(100000, 999999)` 生成随机验证码，集成真实 SMS 服务

### 2. `esc()` 函数缺少单引号转义，导致 30+ 处 XSS
- **文件**: `admin_console.js:8`
- **问题**: `esc()` 只转义 `& < > "`，不转义 `'`。所有 `onclick="func('${esc(val)}')"` 模式均可被单引号注入
- **影响**: 管理后台约 30 处 onclick 属性存在存储型 XSS，攻击者通过设置含 `'` 的昵称即可注入 JS
- **修复**: 在 `esc()` 映射表中添加 `"'": "&#39;"`

### 3. 密码验证存在明文回退 + 时序攻击
- **文件**: `server_crypto.js:26, 41`
- **问题**: 当密码不含 `:` 时退化为 `String(password) === stored` 明文比较，使用 `===` 非常量时间
- **影响**: 旧格式密码用户可被时序攻击暴力破解
- **修复**: 移除明文回退逻辑，强制所有用户使用 scrypt 哈希

### 4. 默认管理员账户弱密码
- **文件**: `server.js:116-117`
- **问题**: alice/1234 为默认管理员，bob/1234 为默认用户
- **影响**: 部署后未改密码即可获取管理员权限
- **修复**: 移除默认用户或首次启动强制设置密码

### 5. CSRF token 验证未使用常量时间比较
- **文件**: `server_crypto.js:70`
- **问题**: `provided === expected` 可被时序攻击逐字节猜测
- **修复**: 使用 `crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected))`

### 6. 会话消息 IDOR 漏洞（读取 + 写入）
- **文件**: `server_routes_chat.js:87-125`
- **问题**: GET/POST 消息路由缺少 `conv._memberSet.has(authUser.id)` 成员验证
- **影响**: 任意已认证用户可读取/发送任意会话的消息
- **修复**: 在 GET 和 POST 分支增加成员身份验证

### 7. 黑名单系统性绕过（3 个关联问题）
- **文件**: `friend_request_service.js:85-117`, `conversation_service.js:1-30`, `blacklist_service.js:1-24`
- **问题**: (a) `acceptFriendRequest` 不检查黑名单；(b) `createDirectConversation` 不检查黑名单；(c) 加入黑名单时不解除好友关系
- **影响**: 被拉黑用户可通过已有请求建立好友关系、创建会话
- **修复**: 在三处添加双向黑名单检查，加黑名单时自动解除好友关系

### 8. Android WebView MIXED_CONTENT_ALWAYS_ALLOW
- **文件**: `android-app/.../MainActivity.java:150`
- **问题**: 允许 HTTPS 页面加载 HTTP 资源，所有通信可被中间人攻击
- **修复**: 改为 `MIXED_CONTENT_NEVER_ALLOW`

### 9. Android EMAS 凭据硬编码
- **文件**: `android-app/app/build.gradle:17-20`
- **问题**: App Key/Secret 硬编码在源码中，APK 反编译即可提取
- **修复**: 移至 `local.properties` 或 CI/CD 环境变量

### 10. Android 无条件授予地理位置权限
- **文件**: `android-app/.../MainActivity.java:246-247`
- **问题**: `onGeolocationPermissionsShowPrompt` 对所有 origin 无条件授权
- **修复**: 验证 origin 是否匹配可信域名

### 11. 缺少 Content Security Policy（CSP）
- **文件**: `index.html`, `admin_console.html`
- **问题**: 两个 HTML 文件均未配置 CSP
- **影响**: XSS 漏洞可加载任意外部脚本
- **修复**: 添加 CSP meta 标签，限制 `script-src 'self'`

### 12. `reconcileList` 的 Map.length bug
- **文件**: `app_utils.js:554`
- **问题**: 使用 `existingNodes.length` 遍历 `Map` 对象，但 `Map` 没有 `.length` 属性
- **影响**: 列表中被删除的 DOM 节点永远不会被移除（"幽灵"列表项）
- **修复**: 使用 `for (const [, node] of existingNodes) node.remove();`

### 13. 浮点数金额计算精度问题
- **文件**: `app_shopping.js:3-6`, `order_mutation_service.js:173`
- **问题**: 前后端金额计算均使用浮点数乘法累加（如 `0.1 + 0.2 = 0.30000000000000004`）
- **影响**: 订单总额可能出现分/厘级误差
- **修复**: 统一以"分"为单位使用整数运算

### 14. 库存扣减无并发保护
- **文件**: `order_mutation_service.js:162-201`
- **问题**: `createOrder` 内库存验证和扣减之间无锁机制
- **影响**: 高并发下可能出现超卖
- **修复**: 使用 per-product mutex 或乐观锁

### 15. SSE 重连永久停止
- **文件**: `app_realtime.js:219-248`
- **问题**: `_sseRetryCount` 超过 10 次后永久停止重连，`visibilitychange` 未重置计数器
- **影响**: 网络不稳定用户永久丢失实时消息推送
- **修复**: 在 `visibilitychange` 和 `online` 事件中重置 `_sseRetryCount = 0`

### 16. 管理员角色提升无限制
- **文件**: `server_routes_admin.js:196`, `server_routes_admin_ext.js:78-116`
- **问题**: 任何管理员可将任何用户提升为管理员，可创建后门账号
- **修复**: 引入超级管理员角色，限制角色变更权限

### 17. 管理后台导出功能失效
- **文件**: `admin_console_ext.js:279-286`
- **问题**: Token 通过 URL query 参数传递，但 `parseAuthToken` 只从 Authorization 头解析
- **影响**: 用户/订单 CSV 导出功能完全无法工作
- **修复**: 改用 fetch + Authorization 头 + Blob 下载

### 18. 订单详情 API 污染原始数据对象
- **文件**: `server_routes_admin.js:288-293`
- **问题**: 直接在 order 原始对象上附加临时属性（buyerName 等），持久化污染内存数据
- **修复**: 构造新的响应对象而非修改原始引用

### 19. 用户详情接口泄露 paymentCodes
- **文件**: `server_routes_admin.js:149-182`
- **问题**: 返回用户收款码等高度敏感支付信息
- **修复**: 从返回数据中移除 paymentCodes

### 20. JSON 持久化缺少原子写入
- **文件**: `server_persistence.js:99-128`
- **问题**: 写入过程中崩溃可能导致 data.json 截断或损坏
- **修复**: 先写临时文件，再用 `fs.renameSync` 原子替换

### 21. 管理员密码策略过弱
- **文件**: `server_routes_admin_ext.js:505-517`
- **问题**: 管理员改密仅要求 4 位，低于普通用户的 8 位要求
- **修复**: 统一密码策略，至少 8 位

### 22. 用户枚举漏洞
- **文件**: `server_routes_auth.js:45-48`
- **问题**: "未设置密码"的错误消息与通用错误不同，可枚举有效账号
- **修复**: 统一返回 "账号或密码错误"

### 23. Android usesCleartextTraffic=true
- **文件**: `android-app/.../AndroidManifest.xml:51`
- **问题**: 全局允许明文 HTTP 流量
- **修复**: 设为 `false`，仅用 network_security_config 控制

### 24. fetchMessages 并发竞态
- **文件**: `app_realtime.js:31-54`
- **问题**: 多条 SSE 消息可触发多个并发 `fetchMessages()`
- **影响**: 消息重复渲染、UI 闪烁
- **修复**: 添加防抖或锁机制

### 25. 订单状态机角色授权缺失
- **文件**: `order_mutation_service.js:295-310`
- **问题**: `updateOrderStatus` 不区分买家/卖家可执行的状态转换
- **影响**: 买家可执行仅卖家应能操作的状态变更
- **修复**: 在 ALLOWED_TRANSITIONS 中添加角色限制

### 26. isAdmin() 与 normalizeUserRole() 逻辑不一致
- **文件**: `server_roles.js:8-15`
- **问题**: 两个函数对管理员的判定逻辑不统一
- **修复**: 让 `isAdmin()` 也检查 `ADMIN_USERNAMES`

### 27-36. 其他高危问题
- `confirmOrderPriceChange` 可导致订单状态倒退 (`order_mutation_service.js:379`)
- `forwardMsg` 事件监听器叠加导致消息重复转发 (`app.js:1344`)
- 好友列表重复显示 bug (`app.js:4002-4019`)
- 健康检查接口泄露内部状态 (`server.js:808`)
- 验证码场景隔离被打破 (`server_routes_auth.js:216-222`)
- `_authState` 敏感信息暴露在 window 对象 (`app.js:1109`)
- 二维码生成泄露用户 ID 到第三方 (`app.js:3080`)
- WebRTC accept call 缺少 senderName (`app.js:3442`)
- price-confirm 端点前端无入口,改价流程断裂 (`server_routes_orders.js:83`)

---

## 🟡 中危问题（建议尽快修复）

### 安全类（38 项）
1. card/broadcast 对象未做白名单过滤 (`conversation_message_service.js:108-110`)
2. 订单操作路由层缺少所有权验证 (`server_routes_orders.js:72-87`)
3. 禁用用户资料仍可被访问 (`server_routes_users.js:91-107`)
4. 密码迁移逻辑脆弱 (`server_routes_auth.js:54-57`)
5. audioUrl 未经 normalizeMediaUrl 过滤 (`app_chat.js:122`)
6. 被拉黑后仍可查看对方个人资料 (`user_profile_service.js:63-82`)
7. 商品卡片 sellerId 可被篡改 (`app_contacts.js:232-233`)
8. sellerId 未 encodeURIComponent (`app_shopping.js:383`)
9. CORS 配置需审查 (`server.js:789-792`)
10. CSRF 验证逻辑依赖不明确 (`server.js:802-806`)
11. 文件上传类型校验不一致 (`server.js:823-840`)
12. uid() 使用不安全的 Math.random (`server_crypto.js:12`)
13. 管理员操作缺少审计日志 (`server_routes_admin.js:193-200`)
14. CSV 导出存在注入风险 (`server_routes_admin_ext.js:384,411`)
15. 管理员登录无独立端点 (`admin_console.js:84-101`)
16. Token 通过 URL 泄露 (`admin_console_ext.js:279-286`)
17. 广播消息发送者未验证 (`server_routes_products.js:52-66`)
18. admin_console.html 大量内联事件处理器 (多处)
19. Android vibrate 无上限校验 (`NativeBridge.java:110`)
20. Android getDeviceInfo JSON 未转义 (`NativeBridge.java:135-143`)
21. Android conversationId JS 注入风险 (`MainActivity.java:382-383`)
22. Android escapeJS 不完整 (`NativeBridge.java:209-211`)
23. 网络安全配置残留开发IP (`network_security_config.xml:11`)
24. Android setAllowFileAccess(true) (`MainActivity.java:140`)
25. scrypt 参数 N=16384 偏低 (`server_crypto.js:19-22`)
26. 验证码比较非常量时间 (`server_crypto.js:158`)
27. CSRF token 不轮转 (`server_crypto.js:59-71`)
28. Session 无设备绑定 (`server_auth.js:17-31`)
29. 注册 TOCTOU 竞态 (`server_routes_auth.js:213-225`)
30. 单设备登录策略需确认 (`server_routes_auth.js:58`)
31. 拉黑时不清理好友关系 (`blacklist_service.js:1-24`)
32. normalizeMediaUrl 接受任意 http/https (`app_utils.js:290-297`)
33. img src 管理后台未过滤 URL 协议 (`admin_console.js:297`)
34. 搜索高亮中的 data URI SVG 风险 (`admin_console_adv.js:106`)
35. 好友请求反向自动接受黑名单竞态 (`friend_request_service.js:49-68`)
36. renderAvatarHtml HTML 拼接 (`app_utils.js:330-334`)
37. avatarImg.src 未过滤 (`app.js:3000`)
38. 系统消息接口权限分类不清晰 (`server_routes_admin.js:52-57`)

### 逻辑正确性类（25 项）
1. 好友删除双向但会话清除单向不一致 (`friend_relation_service.js:37-48`)
2. 接受好友请求缺少 _pinnedBySet 初始化 (`friend_request_service.js:96-117`)
3. 名片匹配同名好友错误 (`app_contacts.js:77-104`)
4. 订单缺少取消/退款状态 (`order_mutation_service.js:288-293`)
5. 软删除订单内存永远膨胀 (`order_mutation_service.js:401-415`)
6. buyNowAndCheckout 库存检查不完整 (`app_shopping.js:303-331`)
7. deleteLocalMsg 回滚位置错误 (`app.js:1262`)
8. _getFriendsById 缓存失效仅基于 length (`app_calling.js:104-118`)
9. conversationPeerId 缓存不随用户切换失效 (`app_chat.js:3-8`)
10. _iceDisconnectTimer 未在 stopCall 中清除 (`app_calling.js:308-330`)
11. conv.lastRead 未初始化防护 (`conversation_action_service.js:97-103`)
12. conv.clearedAt 未初始化防护 (`conversation_action_service.js:137-145`)
13. generateUniqueAppNumberId 无限循环风险 (`server.js:97-100`)
14. gracefulShutdown 迭代中修改 Map (`server.js:967-971`)
15. JSON 序列化未过滤所有 _ 前缀字段 (`server_persistence.js:113-114`)
16. trimMessageIndexes 实际无效 (`server_index.js:364-376`)
17. 日期筛选功能完全无效 (`admin_console_adv.js:184-193`)
18. loading 指示器包装对核心 API 不生效 (`admin_console_adv.js:198`)
19. 消息搜索缺少分页控件 (`admin_console_adv.js:99-118`)
20. 搜索缓存不随属性变更失效 (`app_contacts.js:126`)
21. listConversations 原地修改共享对象 (`social_query_service.js:25-32`)
22. Android 通知缺少接听/拒绝按钮 (`CallNotificationHelper.java:44-58`)
23. Android notificationIdCounter 非线程安全 (`NotificationHelper.java:20`)
24. Android FLAG_ACTIVITY_CLEAR_TOP 导致 WebView 重建 (`PushMessageReceiver.java:26`)
25. 清理过期 session 算法 O(n²) (`server.js:594-598`)

### 代码质量类（13 项）
1. app.js 4500 行全局作用域污染 (全文)
2. 管理后台 25+ 函数挂载到 window (全文)
3. adminGuard/paginate/slicePage 重复定义 (`server_routes_admin.js` vs `_ext.js`)
4. 购物车加入逻辑三处重复 (`app_shopping.js:59,284,318`)
5. SSE incoming call 处理逻辑重复 (`app_realtime.js:133,188`)
6. RTC 状态重置无工厂函数 (`app_calling.js:320`)
7. 变量名遮蔽 uid (`conversation_action_service.js:106,121`)
8. 路由匹配模式不一致 (`server_routes_social.js:85`)
9. 临时变量 now1/now2/now3 命名 (`server_routes_auth.js:70,90,142`)
10. routeCtx 暴露过多内部状态 (`server.js:731-770`)
11. ADMIN_USERNAMES 可被注册用户利用提权 (`server_roles.js:1-6`)
12. price 字段类型不一致(字符串/数字) (`product_service.js:32,117`)
13. 内联样式 80+ 处 (`index.html` 全文)

### 性能类（10 项）
1. renderMessages 全量 DOM 重建 (`app.js:4099-4121`)
2. sendMessage 后冗余 API 调用 (`app.js:1754-1755`)
3. queryOrders 全表线性扫描 (`order_query_service.js:34-49`)
4. 商品卡片点击 N+1 请求 (`app_chat.js:171-206`)
5. upsertMessage O(n) splice + 索引更新 (`app_chat.js:74`)
6. renderMessages 未防抖 (`app_realtime.js:38`)
7. buildConversationMeta 全量遍历 (`server.js:486-533`)
8. SQLite 全量 DELETE+INSERT (`sqlite_store.js:107-146`)
9. 全局消息搜索全量扫描 (`server_routes_admin_ext.js:456-499`)
10. 用户列表无分页 (`server_routes_users.js:27-33`)

---

## 🟢 低危/建议（可排入后续迭代）

<details>
<summary>点击展开 45 项低危问题</summary>

### 安全类（12 项）
1. CSRF Token 附加逻辑依赖调用者 (`app_utils.js:92`)
2. 登录验证码提示暴露在 HTML 中 (`index.html:88,126,165`)
3. displayName 在通话中传播 (`app_calling.js:80`)
4. 上传文件名碰撞风险 (`server.js:836`)
5. Android allowBackup=true (`AndroidManifest.xml:45`)
6. Google STUN 服务器可达性 (`index.html:7`)
7. Session 7天固定 TTL 无滑动过期 (`server.js:86`)
8. 无密钥轮转策略 (整体架构)
9. scryptSync 同步版本仍被导出 (`server_crypto.js:20-21`)
10. 手机验证码登录空密码存储 (`server_routes_auth.js:107-129`)
11. SSE token 获取失败无指数退避 (`app_realtime.js:24`)
12. 数值字段未经 esc() (`admin_console.js:561`)

### 逻辑正确性类（8 项）
1. 订单号 Math.random 碰撞 (`order_mutation_service.js:180`)
2. 库存查询缺失时默认 Infinity (`app_shopping.js:486-489`)
3. pagehide reason 两分支相同 (`app.js:4171`)
4. reorderGroup offset 始终为 1 (`group_service.js:36-53`)
5. 通话记录 ID Date.now() 碰撞 (`app_calling.js:278`)
6. 嵌套滚动容器冲突 (`index.html:213`)
7. 默认分组名 '我的好友' 硬编码 (`friend_request_service.js:52,100`)
8. showTradePicker 变量声明顺序 (`app_contacts.js:25-33`)

### 代码质量类（14 项)
1. escapeHTML 函数死代码 (`app_utils.js:112-114`)
2. 二维码生成逻辑重复 (`app.js:2650,3080`)
3. isMuted 全局/局部变量同名 (`app.js:36`)
4. _msgElCache 切换会话未清理 (`app_chat.js:468-469`)
5. catch(_){} 空异常吞没 (`app_calling.js:232,244,283`)
6. conversation_service.js 模块过于单薄 (全文)
7. RE_CODE_4DIGIT 重复定义 (`server_routes_auth.js:4` / `server_routes_users.js:5`)
8. 解构 `_` 变量遮蔽 (`server_routes_chat.js:129`)
9. _origLoadTabData 未使用 (`admin_console_ext.js:291`)
10. confirm 变量遮蔽 window.confirm (`admin_console_adv.js:172`)
11. DOM 引用缓存可能 stale (`app_orders.js:93-94`)
12. CSS 重复选择器 (`styles_commerce.css:1-25` vs `240-250`)
13. CSS !important 大量使用 (`styles_commerce.css` 多处)
14. .message-read-state 三次重复定义 (`styles_chat.css`)

### 性能类（11 项）
1. renderMessages 签名检查不完整 (`app.js:4106-4108`)
2. getFilteredSellerProducts 缓存 key 不完整 (`app.js:214`)
3. openChatOrderDetail 加载全量订单 (`app_chat.js:335-347`)
4. db.messages 无限增长 (`conversation_message_service.js:118`)
5. getOrdersBetweenUsers 全量遍历 (`app_contacts.js:58-67`)
6. 订单选择器无缓存防抖 (`app_contacts.js:246`)
7. 用户属性变更触发大量索引重建 (`user_profile_service.js:47-54`)
8. rebuildIndexes 部分运行时触发 (`server_index.js:166-280`)
9. _searchText 写入商品 payload (`catalog_service.js:22`)
10. 购物车事件监听器未用事件委托 (`app_shopping.js:361-513`)
11. 5 个 CSS 文件阻塞首屏渲染 (`index.html:8-12`)

</details>

---

## 修复优先级建议

### P0 - 立即修复（安全漏洞）
1. 验证码硬编码 `1234` → 随机生成
2. `esc()` 添加单引号转义 `'` → `&#39;`
3. 会话消息 IDOR → 添加 `_memberSet.has()` 检查
4. 明文密码回退 → 移除，强制 scrypt
5. 默认管理员弱密码 → 移除或强制改密
6. CSRF timingSafeEqual
7. 黑名单绕过 → 三处添加检查

### P1 - 本周修复（功能/数据完整性）
1. `reconcileList` Map.length bug
2. 浮点金额精度 → 整数运算
3. SSE 重连永久停止 → 重置计数器
4. JSON 原子写入
5. 订单状态机角色限制
6. 管理后台导出功能修复
7. Android MIXED_CONTENT 和 cleartext

### P2 - 下个迭代（代码质量/性能）
1. 全量 DOM 重建 → 增量更新
2. 全局变量污染 → 模块化
3. 重复代码合并
4. 数据库查询优化（分页/索引）

---

## 正面发现

审查过程中也发现了多项正确的安全实践：
- 所有 `/api/admin/*` 路由在后端都有管理员权限检查，无遗漏
- `createEl` 使用 `textContent` 而非 `innerHTML`，客户端主体代码 XSS 防护良好
- `showModal`/`showPrompt` 使用 `textContent`，安全
- 前端不依赖角色隐藏来保护功能，完全依赖后端验证
- 订单操作有 `validateOrderActor` 防 IDOR
- Session token 使用 `crypto.randomBytes(24)` 生成，192 位熵足够
- 社交路由使用 `ensureActingUser` 防止用户代表他人操作
- 服务端设置了基础 CSP（`script-src 'self'`）
- 密码使用 scrypt 哈希（参数可再加强）
