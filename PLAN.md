# 代码优化六方向执行计划

## 项目现状

| 指标 | 数值 |
|-----|------|
| JS 文件总数 | 40+ |
| 总行数 | 15,547 |
| app.js 行数 | 6,605（占 42%） |
| window.* 全局导出 | 34 个函数 |
| innerHTML 使用 | app.js=0, admin 面板=24处 |
| IntersectionObserver | 0（无懒加载） |
| 全局错误处理 | 无 |
| 测试 | 仅 1 个 smoke-test（359行） |

---

## 方向一：代码结构 / 模块化

**目标**: 将 6605 行的 app.js 按功能拆分，减少全局污染

### 步骤

1. **提取聊天模块** `app_chat.js`
   - 消息发送/接收/渲染 (~800行)
   - `sendMessage`, `fetchMessages`, `renderMessages`, `appendMessageToView`
   - 上下文菜单、转发、删除、撤回

2. **提取商城模块** `app_mall.js`
   - 商品浏览/搜索/筛选 (~600行)
   - `loadMall`, `renderMall`, 商品详情页
   - 分类过滤、排序逻辑

3. **提取订单模块** `app_orders.js`
   - 买家/卖家订单管理 (~500行)
   - `loadBuyerOrders`, `loadSellerOrders`, 订单状态变更
   - 购物车逻辑

4. **提取联系人模块** `app_contacts.js`
   - 好友列表/分组/搜索 (~400行)
   - `loadFriends`, `loadFriendRequests`, 好友分组管理

5. **提取商品发布模块** `app_publish.js`
   - 商品发布/编辑表单 (~300行)
   - 图片上传、规格标签管理

6. **提取 SSE/实时通信模块** `app_realtime.js`
   - `connectRealtime`, 所有 SSE 事件处理 (~200行)

7. **保留 app.js 作为入口**
   - 初始化、路由、全局状态定义
   - HTML 中按顺序 `<script>` 引入各模块

**风险**: 中等 — 需确保全局函数引用不断裂，分步提取 + 逐模块验证
**预计改动量**: 大

---

## 方向二：安全加固

**目标**: 消除 XSS 风险，加强输入校验

### 步骤

1. **审计 admin 面板 innerHTML** (24处)
   - `admin_console.js`: 15处 — 模板拼接验证 `esc()` 覆盖
   - `admin_console_adv.js`: 6处 — 消息搜索高亮 `.replace()` 注入 `<mark>`
   - `admin_console_ext.js`: 3处
   - 确认所有用户输入经过 `esc()` 处理

2. **检查 API 端点权限一致性**
   - 审计 server_routes_*.js 中每个路由的 auth 中间件
   - 确认管理员操作需 admin 角色
   - 检查 CSRF token 校验覆盖率

3. **输入校验强化**
   - 检查所有 POST body 校验
   - 确认文件上传路径无目录遍历
   - 检查 order total/price 的数值范围校验

4. **添加 Content-Security-Policy 头**
   - 限制 script-src, style-src, img-src
   - 在 server.js 中间件中添加

5. **检查敏感数据泄露**
   - API 响应中不暴露密码 hash
   - 检查用户列表 API 返回字段

**风险**: 低
**预计改动量**: 中

---

## 方向三：网络层优化

**目标**: 减少冗余请求，提高实时性可靠性

### 步骤

1. **SSE 断线重连优化**
   - 当前: token 获取失败后 1.5s 固定重试
   - 改进: 指数退避 (1s → 2s → 4s → 8s → 30s 封顶)
   - 添加 `navigator.onLine` 检测，离线时暂停重连
   - 添加 visibilitychange 监听，页面切回时立即重连

2. **API 请求去重**
   - 对相同 URL 的并发 GET 请求共享 Promise
   - 重点: `loadConversations`, `loadFriends`, `loadMall`
   - 实现: 维护 `pendingRequests` Map

3. **请求节流**
   - 检查 `syncAndRenderConvList` 等 SSE 高频触发调用
   - 确保都有适当的 debounce/throttle

4. **响应缓存**
   - 对低频变化数据加客户端 TTL 缓存
   - 在 `api()` 包装层添加可选缓存参数

**风险**: 低-中
**预计改动量**: 中

---

## 方向四：渲染性能（宏观）

**目标**: 长列表不卡顿，图片按需加载

### 步骤

1. **消息列表虚拟滚动**
   - 只渲染可视区域 ± buffer 的消息
   - 监听 chatView scroll 事件动态增删 DOM

2. **图片懒加载 (IntersectionObserver)**
   - 商品列表、消息图片、头像
   - `<img data-src>` + 进入视口时赋值 `src`

3. **admin 面板增量更新**
   - 24处 innerHTML → reconcileList 或 DOM diff

4. **RAF 批量 DOM 更新**
   - renderConvList、renderMessages 中合并 DOM 写入

**风险**: 中-高（虚拟滚动改动大）
**预计改动量**: 大

---

## 方向五：错误处理与健壮性

**目标**: 统一错误边界，提升离线体验

### 步骤

1. **添加全局错误处理器**
   - `window.onerror` + `window.onunhandledrejection`
   - toast 提示 + 控制台记录

2. **统一 API 错误处理**
   - 创建 `handleApiError(e, context)`
   - 区分网络错误 / 业务错误 / 401 认证过期
   - 401 自动跳转登录页

3. **离线状态检测**
   - `online`/`offline` 事件监听
   - 顶部横幅提示 + 上线自动重连

4. **SSE 连接状态指示**
   - UI 显示连接状态（已连接/重连中/离线）

5. **防抖重复提交**
   - 关键按钮添加 loading 状态防重复点击

**风险**: 低
**预计改动量**: 中

---

## 方向六：测试覆盖

**目标**: 核心业务逻辑有自动化测试保障

### 步骤

1. **扩展 smoke-test**
   - 补充: 黑名单、商品上下架、改密码、系统消息
   - 补充: 边界情况（空字段、超长输入、非法状态转换）

2. **服务层单元测试**
   - `order_mutation_service.js` — 订单创建、状态转换
   - `product_service.js` — 商品增删改
   - `friend_request_service.js` — 好友请求去重

3. **工具函数测试**
   - `app_utils.js`: `esc()`, `fmtDate()`, `formatMoney()`
   - `order_utils.js`: 金额计算
   - `server_crypto.js`: 加密函数

4. **API 权限测试**
   - 非 admin 不能访问 admin API
   - 并发下单库存扣减正确性

5. **CI 友好化**
   - `npm test` 自动启停服务器 + 运行全部测试

**风险**: 无
**预计改动量**: 中

---

## 执行优先级

| 顺序 | 方向 | 理由 |
|------|------|------|
| 1 | 五：错误处理 | 风险最低，体验提升最明显 |
| 2 | 二：安全加固 | 安全问题不能拖延 |
| 3 | 六：测试覆盖 | 为后续重构提供安全网 |
| 4 | 三：网络优化 | 中等改动，收益明确 |
| 5 | 四：渲染性能 | 改动大，需要测试先到位 |
| 6 | 一：模块化 | 改动最大，需要测试 + 分步验证 |
