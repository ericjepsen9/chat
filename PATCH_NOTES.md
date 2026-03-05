# Patch Notes (v4)

本轮继续完成前端高风险交互清理，重点是把 `app.js` 中剩余的内联 `onclick` 去掉，避免 HTML/JS 字符串拼接导致的注入面和引号炸裂问题。

## 本轮修复
- 移除了 `app.js` 剩余的内联 `onclick`
- 重写以下区域为 DOM + `addEventListener` 绑定：
  - 分组移动选择弹层
  - 黑名单列表
  - emoji 面板
  - 分组管理列表
  - 我的商品列表
  - 新的朋友（好友申请）列表
  - 好友分组列表
  - 会话列表
- 会话列表中的头像点击、会话点击、未读展示都改为显式 DOM 构建
- 好友列表中的分组折叠/展开按钮改为事件绑定，不再使用内联事件

## 本轮验证
- `node --check app.js`
- `node --check server.js`
- `npm test` 通过（smoke-test: ok）

## 仍待后续处理
- `renderAvatarHtml()` 仍返回 HTML 字符串，虽然 URL 已经做了基础收口，但后续最好继续改为纯 DOM 构建
- 仍有若干 `innerHTML` 用于安全内容/静态内容渲染，后续可以继续减少
- 仍是单机 JSON 存储，不是生产级架构


## v5（本轮继续）
- 新增 `createAvatarNode()` / `setAvatarContainer()`，进一步减少头像区域的 `innerHTML` 使用。
- 头像渲染改为 DOM 节点插入的区域：个人资料、好友申请、会话列表、来电头像、我的资料。
- 保留其余受控 `innerHTML` 作为后续收尾目标，先优先压缩最常用头像插入面的解析风险。
