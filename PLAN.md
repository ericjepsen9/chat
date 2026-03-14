# 第三轮性能优化计划

## 优先级说明
- 🔴 高优先级：显著影响用户体验或服务器性能
- 🟡 中优先级：可测量的性能改进
- 🟢 低优先级：边际改进或代码质量提升

---

## 一、客户端 JS 优化（app.js）

### 🔴 1. 批量/去重 refreshMessageReadReceipts() 调用
- **文件**: app.js 多处（2248, 2271, 2285, 2315 等）
- **问题**: 每次消息操作（追加、前插、替换、删除）都调用此函数，每次都反向遍历消息数组并查询 DOM
- **方案**: 用 requestAnimationFrame 去重，同一帧内多次调用只执行一次
- **影响**: 消除消息操作时的冗余 DOM 遍历

### 🔴 2. 消息输入框高度自适应去抖
- **文件**: app.js ~5033 行
- **问题**: 每次按键都先设 height='0' 再读 scrollHeight，导致两次强制回流
- **方案**: 用 requestAnimationFrame 包裹高度调整，避免每字符触发回流
- **影响**: 消除打字时的卡顿

### 🔴 3. sortConversationsInPlace() 批量去抖
- **文件**: app.js 多处（2413, 2424, 2780, 6281, 6451）
- **问题**: SSE 事件密集时会连续触发 O(n log n) 排序 + 完整渲染
- **方案**: 50ms 去抖，将多次更新合并为一次排序 + 渲染
- **影响**: 减少密集消息场景下的 CPU 占用

### 🟡 4. 卖家商品筛选结果缓存（memoize）
- **文件**: app.js 512-523 行 (getFilteredSellerProducts)
- **问题**: 每次调用都重新过滤整个商品列表，即使筛选条件未变
- **方案**: 按筛选状态 key 缓存结果，条件不变时直接返回
- **影响**: 避免重复过滤大商品列表

### 🟡 5. 商家商品列表事件委托
- **文件**: app.js ~1010-1030 行 (renderProfileStore)
- **问题**: 每个商品项创建 2-3 个事件监听闭包，100 个商品 = 200-300 个闭包
- **方案**: 用 data 属性 + 父元素单一委托监听器替代
- **影响**: 减少内存占用和 GC 压力

### 🟡 6. renderSidebar() 用 requestAnimationFrame 调度
- **文件**: app.js ~6194 行
- **问题**: 频繁调用但未用 RAF 调度，可能导致多余的重绘
- **方案**: 包裹在 requestAnimationFrame 中
- **影响**: 与其他绘制操作批量执行

### 🟡 7. 消息预览常量字符串提升
- **文件**: app.js 2327-2341 行 (summarizeMessagePreview)
- **问题**: 每次调用返回新字符串字面量 '[图片]'、'[语音]' 等
- **方案**: 提升为模块级常量 Map（类似服务端 _previewByType）
- **影响**: 减少字符串分配

### 🟢 8. refreshMessageReadReceipts 缓存最后发送消息索引
- **文件**: app.js 2379-2387 行
- **问题**: 每次调用都反向扫描找最后一条自己发的非系统消息
- **方案**: 维护 state._lastOwnMsgId，消息不变时跳过扫描
- **影响**: 减少不必要的数组遍历

---

## 二、服务端 JS 优化

### 🔴 9. SSE 死连接清理避免冗余 Map 查找
- **文件**: server.js 253-259 行
- **问题**: 每次 removeSseClient 后重新 sseClientsByUser.get(userId) 检查 size
- **方案**: 直接操作已有的 conns 引用，避免重复 Map 查找
- **影响**: 减少高并发下的连接管理开销

### 🟡 10. session 清理优化 —— 正向删除代替双层遍历
- **文件**: server.js 593-600 行; server_crypto.js
- **问题**: 清理过期 session 后，双层遍历 sessionsByUserId 找已删除 token
- **方案**: cleanupAuthState 返回删除的 token 列表，直接从 sessionsByUserId 移除
- **影响**: 从 O(N×M) 降为 O(M)，N = 用户数，M = 过期 token 数

### 🟡 11. sqlite_store.js 避免 delete 操作符
- **文件**: sqlite_store.js 177-190 行
- **问题**: `delete arr[i].sellerId` 使 V8 去优化对象 hidden class
- **方案**: 用解构 `const { sellerId, ...rest } = p` 代替 delete
- **影响**: 保持 V8 hidden class 优化，加速后续属性访问

### 🟡 12. server_index.js _lcText 始终预计算
- **文件**: server_index.js 244 行
- **问题**: 条件检查 `if (!msg._lcText)` 在每次索引重建时对每条消息都执行
- **方案**: 去掉条件，直接赋值 `msg._lcText = msg.text.toLowerCase()`
- **影响**: 消除搜索时的惰性计算

### 🟢 13. server_routes_social.js 批量索引重建
- **文件**: server_routes_social.js 多处
- **问题**: 好友操作各自触发索引重建，同 tick 多次操作导致重复重建
- **方案**: 用 setImmediate 延迟合并同一 tick 内的重建请求
- **影响**: 减少密集社交操作时的冗余索引重建

---

## 三、CSS 优化

### 🔴 14. 商城折叠动画替换 max-height 为 transform
- **文件**: styles_commerce.css ~1927 行
- **问题**: `transition:max-height .25s ease, padding .25s ease` 触发布局重算
- **方案**: 用 `transform: scaleY()` + `transform-origin: top` 替代
- **影响**: 消除展开/折叠时的布局抖动

### 🟡 15. 移除 box-shadow 过渡动画
- **文件**: styles_commerce.css 535, 1126, 1665 行; styles_social.css 572 行
- **问题**: box-shadow 变化触发重绘，是昂贵的 CSS 属性
- **方案**: 用伪元素 + opacity 过渡替代，或改为静态 shadow
- **影响**: 减少重绘开销

### 🟡 16. 为弹出面板添加 contain
- **文件**: styles_commerce.css 743/754 行（sheet fadeIn/slideUp）
- **问题**: 弹出面板动画缺少 contain 声明
- **方案**: 添加 `contain: layout style paint` 到 `.sheet` 类组件
- **影响**: 限制动画重绘范围

### 🟡 17. sidebar-panel 添加 contain: layout
- **文件**: styles_social.css ~870 行
- **问题**: sidebar 宽度过渡导致内容区回流
- **方案**: 添加 `contain: layout` 隔离回流
- **影响**: 防止侧边栏动画影响主内容区

### 🟢 18. emoji 面板 span 添加 will-change
- **文件**: styles_chat.css ~41 行
- **问题**: `:active` 时的 scale 变换缺少 will-change 提示
- **方案**: 添加 `will-change: transform`
- **影响**: 提升 emoji 面板交互响应速度

---

## 四、执行顺序与完成状态

| 步骤 | 任务 | 涉及文件 | 状态 |
|------|------|----------|------|
| 1 | #1 批量去重 refreshMessageReadReceipts | app.js | ✅ 已完成 |
| 2 | #2 输入框高度去抖 | app.js | ✅ 已完成 |
| 3 | #3 会话排序去抖 | app.js | ✅ 已完成 |
| 4 | #9 SSE 连接清理优化 | server.js | ✅ 已完成 |
| 5 | #14 CSS contain+will-change 优化 | styles_commerce.css | ✅ 已完成 |
| 6 | #4 卖家商品筛选缓存 | app.js | ✅ 已完成 |
| 7 | #5 商品列表事件委托（卖家管理+资料页商店） | app.js | ✅ 已完成 |
| 8 | #10 session 清理优化 | server.js, server_crypto.js | ✅ 已完成 |
| 9 | #11 避免 delete 操作符 | sqlite_store.js | ✅ 已完成 |
| 10 | #12 _lcText 预计算 | server_index.js | ✅ 已完成 |
| 11 | #7 消息预览常量提升 | app.js | ✅ 已完成 |
| 12 | #15-18 CSS 杂项优化 | 多个 CSS 文件 | ✅ 已完成 |
| — | #6 renderSidebar RAF | app.js | ⏭️ 跳过（已有 safeRender 签名检查，仅 2 调用点） |
| — | #8 receipt 缓存最后消息索引 | app.js | ⏭️ 跳过（已有签名检查，反向扫描通常 1-2 步） |
| — | #13 批量索引重建 | server_routes_social.js | ⏭️ 跳过（每次都是独立 HTTP 请求，同 tick 多次极罕见） |
