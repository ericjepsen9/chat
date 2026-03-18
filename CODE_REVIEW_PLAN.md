# ChatTrade 全面代码审查方案

## 问题背景

项目共 ~16,000 行 JS + ~5,800 行 CSS/HTML，最大文件 `app.js` 4,563 行。
Claude Code 单次对话上下文有限，直接 "检查所有代码" 会导致遗漏。

**核心策略：分层分批 + 并行 Agent + 清单驱动**

---

## 一、文件分批策略（按功能域）

将 45+ 个源文件划分为 **8 个审查批次**，每批控制在 2,000-4,500 行以内，确保 Claude 能完整读取并分析。

### Batch 1: 核心入口 & 工具层
| 文件 | 行数 | 审查重点 |
|------|------|----------|
| `app.js` | 4,563 | 全局状态管理、路由逻辑、初始化流程、内存泄漏 |
| `app_utils.js` | 714 | XSS 转义函数 `esc()` 完整性、工具函数正确性 |
| **小计** | **~5,277** | ⚠️ app.js 过大，需分两次读取(前2500行+后2063行) |

### Batch 2: 聊天 & 实时通信
| 文件 | 行数 |
|------|------|
| `app_chat.js` | 522 |
| `app_calling.js` | 526 |
| `app_realtime.js` | 258 |
| `conversation_message_service.js` | 153 |
| `conversation_action_service.js` | 217 |
| `conversation_service.js` | 28 |
| **小计** | **~1,704** |

**审查重点**: 消息发送/接收竞态、SSE 重连逻辑、WebRTC 信令、消息去重

### Batch 3: 商城 & 订单
| 文件 | 行数 |
|------|------|
| `app_shopping.js` | 747 |
| `app_orders.js` | 521 |
| `order_mutation_service.js` | 425 |
| `order_query_service.js` | 55 |
| `order_utils.js` | 15 |
| `product_service.js` | 147 |
| `catalog_service.js` | 48 |
| **小计** | **~1,958** |

**审查重点**: 金额计算精度、库存扣减并发、订单状态机、价格篡改防护

### Batch 4: 社交 & 联系人
| 文件 | 行数 |
|------|------|
| `app_contacts.js` | 312 |
| `friend_relation_service.js` | 77 |
| `friend_request_service.js` | 145 |
| `group_service.js` | 120 |
| `social_query_service.js` | 43 |
| `user_profile_service.js` | 84 |
| `blacklist_service.js` | 28 |
| **小计** | **~809** |

**审查重点**: 好友关系一致性、黑名单绕过、群组权限

### Batch 5: 服务端核心
| 文件 | 行数 |
|------|------|
| `server.js` | 1,043 |
| `server_index.js` | 388 |
| `server_persistence.js` | 115 |
| `server_auth.js` | 44 |
| `server_crypto.js` | 273 |
| `server_roles.js` | 19 |
| `sqlite_store.js` | 178 |
| **小计** | **~2,060** |

**审查重点**: 认证/授权逻辑、密码哈希、加密实现、数据持久化完整性、SQL注入

### Batch 6: 服务端路由
| 文件 | 行数 |
|------|------|
| `server_routes_auth.js` | 254 |
| `server_routes_chat.js` | 175 |
| `server_routes_social.js` | 259 |
| `server_routes_users.js` | 110 |
| `server_routes_orders.js` | 82 |
| `server_routes_products.js` | 113 |
| **小计** | **~993** |

**审查重点**: 输入校验完整性、权限检查一致性、错误响应信息泄露

### Batch 7: 管理后台
| 文件 | 行数 |
|------|------|
| `admin_console.js` | 749 |
| `admin_console_ext.js` | 307 |
| `admin_console_adv.js` | 258 |
| `admin_dashboard_service.js` | 106 |
| `server_routes_admin.js` | 555 |
| `server_routes_admin_ext.js` | 578 |
| **小计** | **~2,553** |

**审查重点**: 管理员权限校验、innerHTML XSS、敏感操作审计、越权访问

### Batch 8: 前端页面 & 样式 + Android
| 文件 | 行数 |
|------|------|
| `index.html` | ~1,800 |
| `admin_console.html` | ~300 |
| `styles.css` + `styles_*.css` | ~4,100 |
| `android-app/**/*.java` | ~10 files |
| **小计** | **~6,200** |

**审查重点**: CSP 配置、外部资源引用、Android WebView 安全、JS Bridge

---

## 二、每批次审查清单（Checklist）

每个批次使用以下统一清单逐项检查：

### A. 安全审查
- [ ] **XSS**: 所有用户输入渲染前是否经过 `esc()` 或等效转义
- [ ] **注入**: SQL 查询是否使用参数化、命令拼接是否安全
- [ ] **认证**: 每个路由是否有正确的 auth 中间件
- [ ] **授权**: 用户只能操作自己的资源（IDOR 检查）
- [ ] **敏感数据**: API 响应是否泄露密码、token、内部 ID
- [ ] **文件上传**: 路径遍历、文件类型校验、大小限制
- [ ] **CSRF**: 状态变更操作是否有 CSRF 防护
- [ ] **密码**: 是否使用安全哈希（bcrypt/argon2），是否有强度要求

### B. 逻辑正确性
- [ ] **边界条件**: 空值、undefined、数组越界处理
- [ ] **并发安全**: 竞态条件（尤其是库存扣减、消息发送）
- [ ] **状态一致性**: 前后端数据同步、订单状态机转换合法性
- [ ] **金额计算**: 是否存在浮点精度问题、前端价格是否可篡改
- [ ] **错误处理**: try-catch 覆盖、Promise rejection 处理
- [ ] **资源泄漏**: EventListener 未移除、定时器未清理、SSE 连接未关闭

### C. 代码质量
- [ ] **重复代码**: 是否有可合并的重复逻辑
- [ ] **全局污染**: 不必要的全局变量
- [ ] **死代码**: 未使用的函数、不可达的分支
- [ ] **硬编码**: 魔法数字、硬编码 URL/密钥
- [ ] **命名一致性**: 函数/变量命名是否清晰、风格统一

### D. 性能
- [ ] **N+1 查询**: 循环内是否有不必要的 I/O 操作
- [ ] **大列表渲染**: 是否有不必要的全量重渲染
- [ ] **内存**: 是否有无限增长的数组/Map
- [ ] **请求冗余**: 是否有重复的 API 调用

---

## 三、执行流程（给 Claude Code 的提示词模板）

### 第一轮：分批深度审查（8 个独立 Agent 并行）

对每个批次使用如下提示词启动 Agent：

```
请审查以下文件的代码，使用下面的检查清单逐项检查。
对每个发现的问题，按以下格式输出：

**[严重程度: 🔴高/🟡中/🟢低]** 文件:行号
- 问题描述
- 影响范围
- 修复建议

文件列表：
- file1.js
- file2.js
...

检查清单：
A. 安全审查: XSS / 注入 / 认证 / 授权 / 敏感数据 / CSRF
B. 逻辑正确性: 边界条件 / 并发 / 状态一致性 / 金额计算 / 错误处理 / 资源泄漏
C. 代码质量: 重复代码 / 全局污染 / 死代码 / 硬编码
D. 性能: N+1 查询 / 大列表渲染 / 内存 / 请求冗余
```

### 第二轮：跨模块交叉审查（3 个 Agent 并行）

| Agent | 审查维度 | 涉及文件 |
|-------|----------|----------|
| Agent A | **前后端接口一致性** | 前端 `api()` 调用 vs `server_routes_*.js` 端点定义 |
| Agent B | **数据流完整性** | 用户操作 → 前端处理 → API 请求 → 服务端处理 → 持久化 → 响应 |
| Agent C | **权限模型一致性** | `server_roles.js` 定义 vs 各路由实际检查 vs admin 面板实际使用 |

### 第三轮：专项深度审查（4 个 Agent 并行）

| Agent | 专项 | 说明 |
|-------|------|------|
| Agent 1 | **加密与认证** | `server_crypto.js` + `server_auth.js` 的算法选择、密钥管理、token 生命周期 |
| Agent 2 | **订单金额** | 从前端下单到后端处理的完整金额链路，检查篡改可能性 |
| Agent 3 | **XSS 全面扫描** | `grep innerHTML` + `grep esc(` 交叉比对，找出未转义的插入点 |
| Agent 4 | **Android 安全** | WebView 配置、JS Bridge 暴露面、SSL pinning |

### 第四轮：汇总与优先级排序

收集前三轮所有发现，生成最终报告：

```
# 代码审查报告

## 🔴 高危问题（必须立即修复）
...

## 🟡 中危问题（建议尽快修复）
...

## 🟢 低危/建议（可排入后续迭代）
...

## 统计
- 总发现数：X
- 高危：X / 中危：X / 低危：X
- 按类别：安全 X / 逻辑 X / 质量 X / 性能 X
```

---

## 四、使用方法

### 方式 A：一键执行（推荐）

直接告诉 Claude Code：

> 请按照 `CODE_REVIEW_PLAN.md` 执行全面代码审查。
> 先并行启动 Batch 1-8 的分批审查 Agent，
> 完成后启动跨模块交叉审查，
> 再启动专项深度审查，
> 最后汇总生成报告。

### 方式 B：逐批手动执行

如果想更精细控制，可以逐批执行：

> 请审查 Batch 5（服务端核心）的所有文件，按 CODE_REVIEW_PLAN.md 中的检查清单逐项检查。

### 方式 C：单项专查

针对特定关注点：

> 请执行 CODE_REVIEW_PLAN.md 中第三轮的 "XSS 全面扫描" 专项审查。

---

## 五、注意事项

1. **app.js 过大**：需要分两次读取（前 2500 行 + 后 2063 行），审查时确保两部分都覆盖
2. **data.json 和 message.wal**：这是运行时数据文件，不需要代码审查
3. **并行 Agent 上限**：建议同时不超过 4-5 个 Agent，避免响应变慢
4. **发现问题后**：先完成所有审查再统一修复，避免审查和修复交叉导致遗漏
5. **可重复执行**：修复后可重新运行相同审查流程验证修复效果
