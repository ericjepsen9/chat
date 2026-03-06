# ChatTrade 架构与框架调整说明

## 已完成（Phase 1）

本阶段已先做不破坏业务流的高风险边界收敛：

1. **权限边界清晰化**
   - 增加用户 `role` 概念（`admin` / `user`）。
   - 管理端接口使用 `requireAdmin` 校验，普通用户不能读取后台聚合数据。

2. **查询权限模型收敛**
   - `GET /api/orders` 对非管理员忽略外部 `userId`，强制按登录用户查询。

3. **会话协议统一（前端多入口）**
   - 管理控制台优先读取与主站一致的 `SESSION_KEY` 存储格式。

4. **接口可用性修复**
   - 修正广播接口索引字段（`convById`）。
   - 补充会话访问判断逻辑。

---

## 进行中（Phase 2 / 本周）

### 2.1 架构目标
- 从“超大 `server.js` 单体”演进到“模块化后端内核”。
- 先抽离**可复用且低耦合**的权限/角色能力，再逐步抽路由与服务层。

### 2.2 本周已落地
- 新增 `server_roles.js`：
  - `isAdmin(user)`
  - `normalizeUserRole(user)`
  - `canAccessConversation(userId, conv)`
- `server.js` 已改为复用上述模块，减少权限判断逻辑分散。
- 新增 `friend_request_service.js`，将好友请求创建/同意/拒绝的状态流转从路由层抽离。
- 新增 `order_query_service.js`，将订单查询的权限边界与过滤逻辑从路由层抽离。
- 新增 `admin_dashboard_service.js`，将后台聚合统计构建逻辑从路由层抽离。
- 新增 `server_auth.js`，将 token 解析、登录态校验与管理员校验从路由层抽离。
- 新增 `server_persistence.js`，将 WAL 与持久化调度逻辑从路由层抽离。
- 新增 `blacklist_service.js`，将黑名单更新状态流转从路由层抽离。
- 新增 `group_service.js`，将好友分组创建/重命名/排序/删除状态流转从路由层抽离。
- 新增 `friend_relation_service.js`，将好友备注/分组调整/删除状态流转从路由层抽离。
- 新增 `conversation_service.js`，将单聊会话创建状态流转从路由层抽离。
- 新增 `product_service.js`，将商品发布/删除状态流转从路由层抽离。
- 新增 `user_profile_service.js`，将用户资料更新/资料视图构建从路由层抽离。

### 2.3 本周剩余计划
- 抽离 `friends` 与 `orders` 的状态流转为 service 函数（不改接口协议）。
- 把路由处理代码按域切片到 `routes/*`（保持现有 URL 不变）。

---

## 下一阶段（Phase 3 / 下周）——数据结构调整

### 3.1 目标数据结构（向后兼容过渡）
1. `users`
   - 新增/规范：`role`, `status`, `lastLoginAt`
2. `sessions`
   - 从内存 map 过渡到可持久化结构：`token`, `userId`, `expiresAt`, `revokedAt`
3. `friendRequests`
   - 统一状态枚举：`pending | accepted | rejected | canceled`
   - 增加 `handledAt`, `handledBy`
4. `orders`
   - 增加 `statusHistory[]`，保留状态轨迹用于审计

### 3.2 迁移策略
- 第一步：读路径兼容旧结构（缺字段自动补默认值）
- 第二步：写路径全部写入新字段
- 第三步：灰度后清理旧字段兼容逻辑

---

## 时间计划（建议）

- **本周（Week 1）**：Phase 2 完成后端模块拆分第一批（roles/auth + friends/orders service 化）。
- **下周（Week 2）**：Phase 3 数据结构升级与兼容迁移。
- **第 3 周（Week 3）**：前端 `app.js` 拆分为 `api/store/views/realtime` 四块。
- **第 4 周（Week 4）**：补齐分层测试（route/service/e2e）与回归清单。

> 每周保证：接口协议不破坏、可回滚、烟测可通过。
