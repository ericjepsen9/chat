# 前端代码优化计划 (app.js)

## 已完成的优化（前几轮）

- Promise 去重守卫（8+ 加载函数）
- rAF 渲染合并（scheduleRenderConversationList）
- 共享订单操作（doUpdateOrderPrice / doAcceptOrder / doCompleteOrder）
- 标签页切换缓存（15s TTL）
- 好友搜索防抖（300ms）
- 所有 7 个签名函数替换为字符串拼接（消除 JSON.stringify）
- state.friendsById Map 实现消息渲染 O(1) 查找
- 侧栏签名去除 JSON.stringify
- renderProfileStore 分类解析缓存
- 单次遍历合并交易订单 + 未读计数
- refreshMessageReadReceipts 缓存 key 跳过冗余 DOM 操作
- concat([msg]) 替换为 push()

---

## 第一步：扩展 friendsById 到 isFriendUser + 消除 mutedBy/pinnedBy 线性扫描

**影响：高** — 在消息渲染和会话列表渲染的热路径上

1. **isFriendUser() 使用 state.friendsById**（~行 262）
   - 当前：`state.friends.some(f => f.friend?.id === userId)` — O(n) 每次调用
   - 优化：改为 `state.friendsById?.has(userId)` — O(1)

2. **isConversationMuted / isConversationPinned 优化**（~行 3217-3222）
   - 当前：`conv.mutedBy.includes(state.currentUser?.id)` — O(n)
   - 优化：每次 loadConversations 后构建 `state.mutedConvIds = new Set(...)` 和 `state.pinnedConvIds = new Set(...)`，或直接在签名对比前缓存结果
   - 注意：mutedBy/pinnedBy 数组通常很短（0-5 元素），实际性能影响有限，但在签名函数中每个会话都会调用

## 第二步：减少重复的 DOM 查询

**影响：中** — UI 交互路径中的累积开销

1. **缓存 $() 查询结果**（~行 5500-5516）
   - 当前：同一函数中多次调用 `$("muteSettingBtn")`、`$("pinConversationBtn")` 等
   - 优化：函数顶部 `const muteBtn = $("muteSettingBtn");` 缓存后使用

2. **openSecondaryPage 中的批量隐藏**（~行 3747-3759）
   - 当前：遍历元素 ID 数组，每个调用 $() 和 classList 操作
   - 优化：保持现有模式但确保不重复查询同一元素

## 第三步：排序路径预计算排序键

**影响：中** — 商品列表渲染时的排序开销

1. **getFilteredSellerProducts 排序**（~行 941-946）
   - 当前：`parseMoney()` 在排序比较中每次调用两次，总计 O(n log n × 2) 次解析
   - 优化：预计算排序键，使用 Schwartzian 变换
   ```js
   // 预计算
   visible.forEach(p => p._sortPrice = parseMoney(p.price));
   visible.sort((a, b) => a._sortPrice - b._sortPrice);
   ```

2. **重复的分类正则**（~行 907, 931）
   - 已在 renderProfileStore 中提取为 `_catRe`，但 renderSellerProductManager 仍内联使用
   - 优化：提取全局常量 `const CATEGORY_SPLIT_RE = /[\/,、]/;`

## 第四步：合并重复的购物车计算

**影响：中** — 购物车相关 UI 每次更新都触发

1. **getGroupedCartTotal / getGroupedCartCount**（~行 305-313）
   - 当前：两个函数分别遍历 `Object.values(state.profileCartBySeller)`
   - 优化：合并为单次遍历，返回 `{ count, total }`
   ```js
   function getCartSummary() {
     let count = 0, total = 0;
     for (const arr of Object.values(state.profileCartBySeller || {})) {
       for (const item of arr) {
         const qty = Number(item.quantity) || 0;
         count += qty;
         total += (Number(item.unitPrice) || 0) * qty;
       }
     }
     return { count, total };
   }
   ```

2. **sellerName 查找**（~行 1749-1750）
   - 当前：连续在两个订单数组中 `.find()` 查找卖家名
   - 优化：构建 `sellerNameById` 缓存 Map

## 第五步：innerHTML 替换为安全的 DOM 构建

**影响：中** — 安全性和渲染性能

1. **innerHTML += 模式**（~行 1151）
   - 当前：`totalDiv.innerHTML += '<div>...'` 导致整个 innerHTML 重新解析
   - 优化：先拼接完整字符串再一次性赋值，或使用 DocumentFragment

2. **搜索结果高亮**（~行 6117-6127）
   - 当前：`new RegExp()` 在循环内部为每条搜索结果创建
   - 优化：在循环外预编译正则

## 第六步：事件委托优化大列表

**影响：中** — 内存占用和初始渲染时间

1. **会话列表点击事件**（~行 7318）
   - 当前：每个会话项 `item.addEventListener('click', ...)`
   - 优化：在容器上使用事件委托 + `dataset.convId`

2. **商城商品卡片**（~行 3642）
   - 当前：每个 card `addEventListener('click', ...)`
   - 优化：在商城列表容器上委托

3. **分类标签**（~行 1341-1348）
   - 当前：每个 tab 单独绑定 click
   - 优化：委托到 catTabsEl 容器

## 第七步：请求取消和资源清理

**影响：低-中** — 防止页面切换时的无效请求和内存泄漏

1. **为导航切换添加 AbortController**
   - 当前：仅一处使用了 AbortController（~行 7593）
   - 优化：在 openConversation 和 tab 切换时取消进行中的 fetch

2. **systemMessages 数组优化**（~行 7135）
   - 当前：`[data.message, ...(state.systemMessages || []).filter(...)].slice(0, 30)` — 创建中间数组
   - 优化：直接操作原数组，splice + unshift

---

## 预计效果

| 步骤 | 影响 | 涉及行数 | 改动大小 |
|------|------|----------|---------|
| 第一步 | 高 | ~10 行 | 小 |
| 第二步 | 中 | ~30 行 | 小 |
| 第三步 | 中 | ~15 行 | 小 |
| 第四步 | 中 | ~25 行 | 中 |
| 第五步 | 中 | ~20 行 | 小 |
| 第六步 | 中 | ~60 行 | 大 |
| 第七步 | 低-中 | ~30 行 | 中 |
