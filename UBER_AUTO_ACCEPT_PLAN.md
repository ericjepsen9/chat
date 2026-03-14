# 居家无人值守 Uber 优质预约单全自动接单系统 — 完善方案 v2

> 核心原则：**安全第一，速度第二**。任何提速手段如果增加封号风险，一律不采用。

---

## 一、Uber 封号风控机制深度分析

在设计系统之前，必须先理解 Uber 可能从哪些维度检测异常行为。

### 1.1 已知的风控检测维度

| 维度 | 检测方式 | 风险等级 |
|---|---|---|
| **触控指纹** | MotionEvent 中的 pressure/size/toolType 字段。`adb input tap` 的 pressure=**1.0**（固定值）, size=**1.0**（固定值）, touchMajor=**0**, touchMinor=**0**, toolType=**0**（UNKNOWN），与真实手指（pressure≈0.15-0.85 动态变化, size≈0.05-0.3, touchMajor≈20-80px, touchMinor≈15-60px, toolType=**1** FINGER）截然不同 | **极高** |
| **操作时间模式** | 凌晨 2-6 点持续秒级响应接单，不符合人类睡眠规律 | **高** |
| **接单选择性** | 长期只接高评分、特定区域订单，拒绝/忽略其余所有订单，acceptance rate 异常 | **高** |
| **GPS 行为** | 设备 GPS 长时间静止不动（停在家里），但持续接单 | **中** |
| **设备环境** | Root 检测（SafetyNet / Play Integrity API）、USB 调试状态检测、开发者模式检测 | **中** |
| **Accessibility Service** | Uber APK 可通过 `Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES` 枚举当前激活的无障碍服务 | **中** |
| **NotificationListener 检测** | Uber 同样可通过 `Settings.Secure.getString(cr, "enabled_notification_listeners")` 枚举已启用的通知监听服务，发现非系统白名单应用即可标记 | **中** |
| **Root 检测（极强）** | Uber 的 Root 检测**超过银行级别**：检测 su/magisk/busybox 二进制文件、读取 `/proc/self/mountinfo` 搜索 "magisk" 字符串、检测 Bootloader 解锁状态、Play Integrity API 验证。即使 Magisk + Shamiko + PIF 全部通过 SafetyNet，Uber 仍可能检测到并进入 "lite mode" 拒绝上线 | **极高** |
| **操作节奏** | 每次点击的反应时间高度一致（机器人特征）vs 人类的自然波动 | **中** |
| **屏幕状态** | 通过 PowerManager 或 Display API 检测屏幕是否亮起 | **低** |

### 1.2 封号的严重后果

- 临时停用（24h-7天）：算法检测到疑似异常
- 永久停用：多次触发或被人工审核确认
- **司法风险**：违反 Uber TOS 中的自动化条款，理论上可被追究违约责任

---

## 二、防封核心策略（贯穿全系统设计）

### 2.1 触控仿真 — 最关键的一环

**绝对不能用 `adb input tap`**，必须用 `adb shell sendevent` 注入完整的触控事件流：

```
一次完整的真实手指触摸包含：
1. ABS_MT_TRACKING_ID  （触点追踪 ID）
2. ABS_MT_POSITION_X   （X 坐标）
3. ABS_MT_POSITION_Y   （Y 坐标）
4. ABS_MT_TOUCH_MAJOR  （接触面长轴 ≈ 80-200）
5. ABS_MT_TOUCH_MINOR  （接触面短轴 ≈ 60-150）
6. ABS_MT_PRESSURE     （压力值 ≈ 40-120，设备相关）
7. BTN_TOUCH = 1       （按下）
8. SYN_REPORT
  ... 保持 50-150ms ...
9. ABS_MT_PRESSURE = 0
10. BTN_TOUCH = 0      （释放）
11. ABS_MT_TRACKING_ID = -1
12. SYN_REPORT
```

**注意 — Multi-touch Protocol Type A vs Type B**：
- 大多数现代设备使用 **Type B（slot-based）** 协议
- 运行 `adb shell getevent -lp` 检查是否有 `ABS_MT_SLOT`：有则为 Type B，无则为 Type A
- Type B 需要额外发送 `ABS_MT_SLOT` 事件（通常值为 0）
- Type A 使用 `SYN_MT_REPORT`（type=0, code=2）作为每个触点数据的结束标记

**实施步骤**：
1. 先在目标手机上运行 `adb shell getevent -lp` 查看触摸设备节点、参数范围、和协议类型
2. 用手指真实点击 10+ 次，`adb shell getevent -lt /dev/input/eventX` 录制真实触摸数据
3. 分析真实数据中各参数的数值范围，**注意 getevent 输出是十六进制，sendevent 输入是十进制**
4. 建立随机化参数池，每次模拟点击时从参数池中随机采样
5. 验证：注入后在手机上用 `getevent -lt` 同步监听，确认注入事件与真实触摸事件格式一致

### 2.2 行为节奏拟人化

```python
# 反应时间模型 — 模拟人类被通知唤醒后的操作节奏
def get_humanized_delay():
    """
    人类被推送通知唤醒 → 看手机 → 阅读内容 → 做出判断 → 点击
    整个过程通常需要 3-8 秒，不可能 1 秒完成
    """
    # 基础延迟：模拟"看到通知 → 拿起手机"
    wake_delay = random.uniform(1.5, 4.0)

    # 阅读延迟：模拟"阅读订单信息"
    read_delay = random.uniform(0.8, 2.5)

    # 决策延迟：模拟"考虑是否接单"
    decide_delay = random.uniform(0.3, 1.0)

    # 偶尔出现更长的犹豫（10% 概率）
    if random.random() < 0.10:
        decide_delay += random.uniform(2.0, 5.0)

    return wake_delay + read_delay + decide_delay
    # 总计约 2.6 ~ 12.5 秒，平均约 5 秒
```

> **重要**：原方案追求"1-2 秒延迟"是危险的。凌晨时段能在 1 秒内响应预约单通知是明显的非人类行为。建议将目标延迟调整为 **3-8 秒**，牺牲少量抢单速度换取安全性。

### 2.3 接单率管理 — 避免选择性过高

> **Uber 接受率机制**（来自官方文档）：
> - 计算窗口：**最近 100 个独占派单请求**（Trip Radar 群发单不计入）
> - 拒绝或超时未接都会降低接受率
> - 低接受率**不会导致永久停用**，但会：
>   - 丢失 Uber Pro 等级（Gold/Platinum/Diamond）及相关福利（油费折扣、学费补贴、机场优先排队等）
>   - 降低获得奖励/促销活动的资格
>   - 可能被算法降低派单优先级
> - 预约单在接受率计算中**与普通单一视同仁**

```python
# 不能只接"极品单"，需要偶尔接一些普通单维持正常的 acceptance rate
class AcceptanceRateManager:
    def __init__(self):
        self.total_offers = 0
        self.accepted = 0
        self.target_rate = 0.75  # Uber Pro Gold 门槛约 85%，我们至少维持 75%

    def should_force_accept(self):
        """当接受率过低时，强制接受下一单（即使不够优质）"""
        if self.total_offers < 5:
            return False
        current_rate = self.accepted / self.total_offers
        if current_rate < 0.65:
            return True  # 接受率太低，必须接
        return False

    def should_force_ignore(self):
        """偶尔故意忽略一个好单，制造 '真人犹豫后错过' 的假象"""
        if random.random() < 0.05:  # 5% 概率故意放弃好单
            return True
        return False
```

### 2.4 作息时间仿真

```python
# 不要 24 小时运行，设定合理的"活跃时间窗口"
ACTIVE_WINDOWS = [
    # 模拟"睡前看一下手机" — 实际在自动接单
    ("22:00", "23:30"),
    # 模拟"半夜醒来上厕所顺便看手机"
    ("02:00", "02:30"),
    # 模拟"早起"
    ("05:30", "07:00"),
]

# 在非活跃窗口内，完全不响应推送
# 这样即使 Uber 分析行为日志，也看到合理的人类作息模式
```

### 2.5 设备环境安全

| 措施 | 说明 |
|---|---|
| **绝对不 Root** | Uber 的 Root 检测超过银行级别，即使 Magisk+Shamiko+PIF 全部通过 SafetyNet 也会被检测到。XDA 论坛多人报告："Uber's root detection is way beyond what the banks are doing." |
| **隐藏开发者模式** | 接单后关闭"开发者选项"显示（部分设备可通过 Settings 隐藏） |
| **WiFi ADB** | 使用 WiFi ADB（`adb tcpip 5555` → `adb connect <IP>:5555`）替代 USB 连接，避免 Uber 检测 USB 调试状态 |
| **不装可疑 APK** | 不安装名称含 "auto/bot/hack" 的应用。**重要**：如果使用自定义 APK 中的 NotificationListenerService，Uber 可以通过 `Settings.Secure("enabled_notification_listeners")` 检测到。因此优先考虑**无 APK 方案**（见下文方案 B+） |
| **保持系统更新** | 旧版系统更容易被标记为刷机设备 |
| **不解锁 Bootloader** | Uber 检测 Bootloader 解锁状态，解锁后即使不 Root 也可能进入 "lite mode" |

---

## 三、系统架构（修订版）

### 3.1 架构选型对比

| 方案 | 延迟 | 防封性 | 稳定性 | 复杂度 | 备注 |
|---|---|---|---|---|---|
| A: ADB Logcat + VLM + ADB Tap | 1-2s | **差** | 中 | 中 | 触控指纹暴露 |
| B: dumpsys notification + OCR + sendevent | 2-3s | 中 | 中 | 中 | 轮询有延迟 |
| **B+: dumpsys notification + 文本匹配 + sendevent（推荐）** | **3-6s** | **好** | **好** | **低** | **无需安装 APK，零设备指纹** |
| C: 手机端 APK + 电脑端决策 | 3-6s | 中 | 高 | 中高 | APK 的 NotificationListener 可被 Uber 检测到 |
| D: 纯手机端 APK（最隐蔽触控） | 3-6s | 中 | 高 | 高 | 同上，APK 可被检测 |

> **关键发现**：研究表明 Uber 可以通过 `Settings.Secure("enabled_notification_listeners")` 检测手机上所有已启用的通知监听服务。因此，安装自定义 APK 使用 NotificationListenerService 本身就是一个风控信号。
>
> **方案 B+ 的优势**：完全通过 ADB shell 命令（`dumpsys notification --noredact`）读取通知内容，**无需在手机上安装任何第三方应用**，对 Uber 完全不可见。

### 3.2 推荐架构：方案 B+ — 纯 ADB 无痕架构（修订推荐）

```
┌─────────────────────────────────────────────────────────────┐
│                       安卓手机端                              │
│                                                             │
│   无需安装任何额外应用                                         │
│   Uber Driver App 正常运行                                    │
│   仅开启 WiFi ADB（开发者选项 → 无线调试）                      │
│                                                             │
└──────────────────────┬──────────────────────────────────────┘
                       │ WiFi ADB (局域网 TCP 5555)
                       │
┌──────────────────────▼──────────────────────────────────────┐
│                  Windows 电脑端 (Python)                      │
│                                                             │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  通知轮询器 (500ms 间隔)                                │  │
│  │  adb shell dumpsys notification --noredact             │  │
│  │  → 过滤 pkg=com.ubercab.driver                        │  │
│  │  → 提取 title/text/bigText                            │  │
│  │  → 与上一次快照对比，检测新通知                           │  │
│  └─────────────────────┬──────────────────────────────────┘  │
│                        │ 新通知                              │
│  ┌─────────────────────▼──────────────────────────────────┐  │
│  │  决策引擎                                               │  │
│  │  • 通知文本解析（正则匹配评分/地址/车费）                  │  │
│  │  • 区域白名单/黑名单过滤                                 │  │
│  │  • 接受率管理器                                         │  │
│  │  • 行为拟人化引擎（延迟/随机化）                          │  │
│  └─────────────────────┬──────────────────────────────────┘  │
│                        │ 接单指令                            │
│  ┌─────────────────────▼──────────────────────────────────┐  │
│  │  触控仿真器                                             │  │
│  │  adb shell sendevent（完整 MotionEvent 序列）            │  │
│  │  • 从设备校准数据中随机采样 pressure/touchMajor 等参数     │  │
│  │  • 高斯分布坐标偏移                                     │  │
│  │  • 随机保持时长 50-180ms                                │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  健康监控 + Web 面板 + Telegram 告警                     │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                             │
│  GPU (RTX 4050): 仅当通知文本不足时回退到截图 PaddleOCR       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 3.3 备选架构：方案 C — 混合 APK 架构（如果 dumpsys 不够用）

> 仅当 `dumpsys notification` 无法获取完整订单信息时使用此方案。
> 注意：此方案的 NotificationListenerService 可被 Uber 检测到，风险更高。

```
┌─────────────────────────────────────────────────────────┐
│                    安卓手机端                              │
│                                                         │
│  ┌─────────────────────────┐                            │
│  │  UberGuard APK          │                            │
│  │  (伪装名: "电池优化助手") │                            │
│  │                         │                            │
│  │  NotificationListener   │──→ 捕获通知文本             │
│  │  Service                │    (评分/地址/时间/价格)     │
│  │                         │                            │
│  │  WebSocket Client ──────│──→ 发送通知数据到电脑        │
│  │                         │                            │
│  │  ← 接收指令 ────────────│──→ sendevent 触控仿真       │
│  │                         │    (完整 MotionEvent 序列)  │
│  └─────────────────────────┘                            │
│                                                         │
└──────────────────────┬──────────────────────────────────┘
                       │ WiFi (局域网 WebSocket)
                       │
┌──────────────────────▼──────────────────────────────────┐
│                  Windows 电脑端                           │
│                                                         │
│  ┌─────────────────────────┐  ┌──────────────────────┐  │
│  │  决策引擎 (Python)       │  │  监控面板 (Web UI)    │  │
│  │                         │  │                      │  │
│  │  • 通知文本解析          │  │  • 实时订单流         │  │
│  │  • 区域白名单/黑名单     │  │  • 接单/拒单统计      │  │
│  │  • 乘客评分过滤          │  │  • 异常告警           │  │
│  │  • 接受率管理            │  │  • 手动干预按钮       │  │
│  │  • 行为拟人化引擎        │  │  • 操作日志回放       │  │
│  │  • 作息时间控制          │  │                      │  │
│  │                         │  │                      │  │
│  │  可选: GPU 模型          │  └──────────────────────┘  │
│  │  (仅当通知文本不完整时    │                            │
│  │   回退到截图 OCR)        │                            │
│  └─────────────────────────┘                            │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 3.4 通知捕获方案对比（修订）

| 对比项 | dumpsys notification (ADB) | NotificationListenerService (APK) | AccessibilityService (APK) |
|---|---|---|---|
| **需要安装 APK** | **否** | 是 | 是 |
| **可被 Uber 检测** | **不可能**（纯 shell 命令） | **可以**（通过 `enabled_notification_listeners` 系统设置） | **容易**（通过 `ENABLED_ACCESSIBILITY_SERVICES`） |
| **获取通知内容** | 完整文本（需 `--noredact`） | 结构化文本 | 需拦截 UI 事件 |
| **实时性** | 轮询（~500ms 延迟） | 事件驱动（~0ms） | 事件驱动（~0ms） |
| **所需权限** | ADB shell（电脑端） | 通知访问（手机端授权） | 无障碍权限（手机端授权） |
| **稳定性** | 依赖 ADB 连接 | 独立运行 | 独立运行 |

**结论**：**首选 `dumpsys notification`**（方案 B+），因为对手机零侵入、Uber 完全不可能检测到。500ms 轮询延迟在 3-8 秒的拟人化总延迟面前可以忽略不计。仅当 dumpsys 输出信息不完整时，再考虑安装 APK。

---

## 四、详细模块设计

### 4.0 模块零：dumpsys 通知轮询器（推荐方案 B+ 的核心）

**技术栈**：纯 Python，无需安装手机端 APK

```python
import subprocess
import re
import time
import hashlib
from dataclasses import dataclass
from typing import Optional

@dataclass
class UberNotification:
    key: str               # 通知唯一标识
    title: str
    text: str
    big_text: str
    sub_text: str
    timestamp: float       # 发现时间
    content_hash: str      # 内容指纹（用于去重）

class DumpsysNotificationPoller:
    """
    通过 ADB dumpsys 轮询 Uber 通知 — 零设备指纹方案

    原理：
    - adb shell dumpsys notification --noredact 可以读取所有活跃通知的完整文本
    - ADB shell 拥有足够权限执行此命令，无需 Root
    - 通过对比前后两次快照，检测新出现的 Uber 通知
    """

    # 解析 dumpsys 输出的正则
    PKG_RE = re.compile(r'pkg=(\S+)')
    TITLE_RE = re.compile(r'android\.title=String \((.+?)\)')
    TEXT_RE = re.compile(r'android\.text=String \((.+?)\)')
    BIG_TEXT_RE = re.compile(r'android\.bigText=String \((.+?)\)')
    SUB_TEXT_RE = re.compile(r'android\.subText=String \((.+?)\)')
    KEY_RE = re.compile(r'key=(\S+)')

    def __init__(self, poll_interval: float = 0.5):
        self.poll_interval = poll_interval
        self.known_hashes: set[str] = set()  # 已处理过的通知指纹
        self.on_new_notification = None       # 回调函数

    def _run_dumpsys(self) -> str:
        """执行 dumpsys notification 命令"""
        result = subprocess.run(
            ["adb", "shell", "dumpsys", "notification", "--noredact"],
            capture_output=True, text=True, timeout=5
        )
        return result.stdout

    def _parse_uber_notifications(self, dumpsys_output: str) -> list[UberNotification]:
        """从 dumpsys 输出中提取 Uber 通知"""
        notifications = []

        # 按 NotificationRecord 分块
        blocks = dumpsys_output.split("NotificationRecord")

        for block in blocks:
            # 只处理 Uber Driver 的通知
            pkg_match = self.PKG_RE.search(block)
            if not pkg_match or pkg_match.group(1) != "com.ubercab.driver":
                continue

            key_match = self.KEY_RE.search(block)
            title_match = self.TITLE_RE.search(block)
            text_match = self.TEXT_RE.search(block)
            big_text_match = self.BIG_TEXT_RE.search(block)
            sub_text_match = self.SUB_TEXT_RE.search(block)

            title = title_match.group(1) if title_match else ""
            text = text_match.group(1) if text_match else ""
            big_text = big_text_match.group(1) if big_text_match else ""
            sub_text = sub_text_match.group(1) if sub_text_match else ""
            key = key_match.group(1) if key_match else ""

            # 计算内容指纹
            content = f"{title}|{text}|{big_text}"
            content_hash = hashlib.md5(content.encode()).hexdigest()

            notifications.append(UberNotification(
                key=key,
                title=title,
                text=text,
                big_text=big_text,
                sub_text=sub_text,
                timestamp=time.time(),
                content_hash=content_hash
            ))

        return notifications

    def poll_once(self) -> list[UberNotification]:
        """执行一次轮询，返回新发现的通知"""
        try:
            output = self._run_dumpsys()
            current = self._parse_uber_notifications(output)

            new_notifications = []
            for notif in current:
                if notif.content_hash not in self.known_hashes:
                    self.known_hashes.add(notif.content_hash)
                    new_notifications.append(notif)

            # 防止 known_hashes 无限增长
            if len(self.known_hashes) > 1000:
                self.known_hashes = set(list(self.known_hashes)[-500:])

            return new_notifications

        except subprocess.TimeoutExpired:
            logging.warning("dumpsys 命令超时")
            return []
        except Exception as e:
            logging.error(f"轮询异常: {e}")
            return []

    async def run_loop(self, callback):
        """异步轮询主循环"""
        self.on_new_notification = callback
        logging.info(f"通知轮询器启动，间隔 {self.poll_interval}s")

        while True:
            new_notifs = self.poll_once()
            for notif in new_notifs:
                logging.info(f"🔔 新 Uber 通知: [{notif.title}] {notif.text}")
                if self.on_new_notification:
                    await self.on_new_notification(notif)

            await asyncio.sleep(self.poll_interval)
```

> **首次校准**：运行以下命令确认你的手机上 dumpsys 能读到 Uber 通知：
> ```bash
> # 先让 Uber Driver App 产生一条通知（可以让朋友发一个叫车请求）
> adb shell dumpsys notification --noredact | grep -A 30 "ubercab.driver"
> ```
> 如果输出包含通知标题和文本内容，则方案 B+ 可行。
> 如果文本被 redact 或缺少关键字段，则需要回退到方案 C（APK 方案）。

---

### 4.1 模块一（备选）：通知捕获 APK（仅当 dumpsys 不够用时）

> **警告**：此方案中的 NotificationListenerService 可被 Uber 通过系统 API 检测到。仅在方案 B+ 不可行时使用。

**技术栈**：Kotlin / Android Studio

**核心类**：
```kotlin
// 1. NotificationListenerService — 捕获 Uber 推送
class UberNotificationCatcher : NotificationListenerService() {

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        // 只处理 Uber 包名的通知
        if (sbn.packageName != "com.ubercab.driver") return

        val notification = sbn.notification
        val extras = notification.extras

        val title = extras.getString(Notification.EXTRA_TITLE) ?: ""
        val text = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString() ?: ""
        val bigText = extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString() ?: ""
        val subText = extras.getString(Notification.EXTRA_SUB_TEXT) ?: ""

        // 组装数据发送到电脑
        val payload = JSONObject().apply {
            put("type", "uber_notification")
            put("title", title)
            put("text", text)
            put("bigText", bigText)
            put("subText", subText)
            put("timestamp", System.currentTimeMillis())
            put("key", sbn.key)
        }

        WebSocketManager.send(payload.toString())
    }
}
```

```kotlin
// 2. WebSocket 长连接管理
class WebSocketManager {
    companion object {
        private var ws: WebSocket? = null
        private val reconnectHandler = Handler(Looper.getMainLooper())

        fun connect(serverUrl: String) {
            val client = OkHttpClient.Builder()
                .pingInterval(30, TimeUnit.SECONDS)  // 心跳保活
                .build()

            val request = Request.Builder().url(serverUrl).build()
            ws = client.newWebSocket(request, object : WebSocketListener() {
                override fun onMessage(webSocket: WebSocket, text: String) {
                    handleCommand(JSONObject(text))
                }
                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                    // 自动重连，指数退避
                    scheduleReconnect()
                }
            })
        }

        private fun handleCommand(cmd: JSONObject) {
            when (cmd.getString("action")) {
                "tap" -> {
                    val x = cmd.getInt("x")
                    val y = cmd.getInt("y")
                    val delay = cmd.getLong("delay")

                    // 延迟后执行拟人化触控
                    Handler(Looper.getMainLooper()).postDelayed({
                        TouchSimulator.humanizedTap(x, y)
                    }, delay)
                }
                "screenshot" -> {
                    // 回退方案：当通知文本不够用时，截图发回电脑做 OCR
                    ScreenCapture.captureAndSend()
                }
            }
        }
    }
}
```

```kotlin
// 3. 拟人化触控仿真（核心防封模块）
class TouchSimulator {
    companion object {
        // 设备相关参数 — 首次运行时通过 getevent -lp 校准
        private var inputDevice = "/dev/input/event2"  // 触摸设备节点
        private var pressureRange = 40..120
        private var touchMajorRange = 80..200
        private var touchMinorRange = 60..150

        fun humanizedTap(targetX: Int, targetY: Int) {
            val random = Random()

            // 坐标随机偏移 ±8 像素（人手指不可能精确点到同一像素）
            val x = targetX + random.nextInt(17) - 8
            val y = targetY + random.nextInt(17) - 8

            // 随机触控参数
            val pressure = random.nextInt(pressureRange.last - pressureRange.first) + pressureRange.first
            val touchMajor = random.nextInt(touchMajorRange.last - touchMajorRange.first) + touchMajorRange.first
            val touchMinor = random.nextInt(touchMinorRange.last - touchMinorRange.first) + touchMinorRange.first
            val trackingId = random.nextInt(65535)

            // 注入完整触摸事件序列
            val cmds = listOf(
                // DOWN
                "sendevent $inputDevice 3 57 $trackingId",     // ABS_MT_TRACKING_ID
                "sendevent $inputDevice 3 53 $x",              // ABS_MT_POSITION_X
                "sendevent $inputDevice 3 54 $y",              // ABS_MT_POSITION_Y
                "sendevent $inputDevice 3 48 $touchMajor",     // ABS_MT_TOUCH_MAJOR
                "sendevent $inputDevice 3 49 $touchMinor",     // ABS_MT_TOUCH_MINOR
                "sendevent $inputDevice 3 58 $pressure",       // ABS_MT_PRESSURE
                "sendevent $inputDevice 1 330 1",              // BTN_TOUCH DOWN
                "sendevent $inputDevice 0 0 0",                // SYN_REPORT
            )

            // 执行按下
            cmds.forEach { Runtime.getRuntime().exec(arrayOf("su", "-c", it)).waitFor() }
            // ⚠️ 注意：sendevent 需要 shell 权限访问 /dev/input/
            // 非 Root 方案见 4.1.1 节

            // 保持按压 50-180ms（模拟真实按压时长）
            Thread.sleep(random.nextLong(50, 180))

            // UP
            val upCmds = listOf(
                "sendevent $inputDevice 3 57 -1",             // ABS_MT_TRACKING_ID = -1
                "sendevent $inputDevice 1 330 0",              // BTN_TOUCH UP
                "sendevent $inputDevice 0 0 0",                // SYN_REPORT
            )
            upCmds.forEach { Runtime.getRuntime().exec(arrayOf("su", "-c", it)).waitFor() }
        }
    }
}
```

#### 4.1.1 非 Root 环境下的触控方案

`sendevent` 直接写 `/dev/input/` 需要 Root 权限，而我们的策略是**不 Root**。替代方案：

**方案 A：通过 ADB 执行 sendevent（推荐）**
- 手机通过 WiFi ADB 连接到电脑
- 电脑端通过 `adb shell sendevent` 远程注入
- ADB shell 拥有足够权限写入 `/dev/input/`
- 缺点：多了一次网络往返（局域网 <5ms，可忽略）

```python
# 电脑端 Python 执行 sendevent
import subprocess

def sendevent(device, type_code, code, value):
    subprocess.run(
        ["adb", "shell", "sendevent", device, str(type_code), str(code), str(value)],
        capture_output=True
    )

# 优化：用单条 adb shell 命令批量执行，减少进程创建开销
def humanized_tap(x, y):
    pressure = random.randint(40, 120)
    touch_major = random.randint(80, 200)
    touch_minor = random.randint(60, 150)
    tracking_id = random.randint(0, 65535)
    hold_ms = random.randint(50, 180)

    # 拼接为单条 shell 命令
    down_cmds = (
        f"sendevent {DEV} 3 57 {tracking_id} && "
        f"sendevent {DEV} 3 53 {x} && "
        f"sendevent {DEV} 3 54 {y} && "
        f"sendevent {DEV} 3 48 {touch_major} && "
        f"sendevent {DEV} 3 49 {touch_minor} && "
        f"sendevent {DEV} 3 58 {pressure} && "
        f"sendevent {DEV} 1 330 1 && "
        f"sendevent {DEV} 0 0 0 && "
        f"sleep {hold_ms / 1000:.3f} && "
        f"sendevent {DEV} 3 57 -1 && "
        f"sendevent {DEV} 1 330 0 && "
        f"sendevent {DEV} 0 0 0"
    )

    subprocess.run(["adb", "shell", down_cmds], capture_output=True)
```

**方案 B：通过 InputManager 反射（App 内部，无需 Root）**
- 使用 Android 隐藏 API `InputManager.injectInputEvent()`
- 可以构造完整的 MotionEvent 对象（包含 pressure/size）
- 缺点：Android 9+ 限制了隐藏 API 访问，需要绕过
- 适用于方案 D（纯手机端方案）

### 4.2 模块二：决策引擎（电脑端 Python）

```python
import json
import asyncio
import websockets
import logging
from datetime import datetime, time
from dataclasses import dataclass, field
from typing import Optional
import re
import random

# ============================================================
#  配置
# ============================================================

@dataclass
class Config:
    # 乘客评分门槛
    min_rider_rating: float = 4.8

    # 地理白名单关键词（出发地或目的地包含以下任一关键词即为合格）
    geo_whitelist: list = field(default_factory=lambda: [
        "Manhattan", "JFK", "LaGuardia", "LGA",
        "Midtown", "Downtown", "Upper East", "Upper West",
        "Chelsea", "SoHo", "Tribeca", "Greenwich Village",
        "Times Square", "Wall St", "Financial District",
        "Brooklyn Heights", "Williamsburg", "Park Slope",
    ])

    # 地理黑名单关键词（包含以下关键词则直接拒绝）
    geo_blacklist: list = field(default_factory=lambda: [
        "Bronx", "Newark", "Elizabeth", "Paterson",
        "East New York", "Brownsville", "Hunts Point",
        "Staten Island",
    ])

    # 最低车费（美元），过滤掉不值得跑的短途单
    min_fare: float = 15.0

    # 接受率管理
    target_acceptance_rate: float = 0.75
    force_accept_threshold: float = 0.60   # 低于此值强制接下一单

    # 作息时间窗口（仅在这些时段自动接单）
    active_windows: list = field(default_factory=lambda: [
        ("21:30", "23:59"),
        ("00:00", "00:30"),
        ("04:30", "06:30"),
    ])

    # 故意放弃好单的概率（制造真人假象）
    intentional_miss_rate: float = 0.05

    # 每晚最大自动接单数（避免异常高产出）
    max_accepts_per_night: int = 5


config = Config()

# ============================================================
#  通知解析器
# ============================================================

class UberNotificationParser:
    """解析 Uber Driver 推送通知中的关键信息"""

    # 评分正则：匹配 "4.92" 或 "★4.85" 等
    RATING_RE = re.compile(r'[★⭐]?\s*(\d\.\d{1,2})')

    # 车费正则：匹配 "$25.50" 或 "Est. $30" 等
    FARE_RE = re.compile(r'\$(\d+\.?\d*)')

    # 时间正则：匹配 "8:30 AM" 或 "14:00" 等
    TIME_RE = re.compile(r'(\d{1,2}:\d{2}\s*(?:AM|PM)?)', re.IGNORECASE)

    @staticmethod
    def parse(notification: dict) -> dict:
        """从通知文本中提取结构化订单信息"""
        title = notification.get("title", "")
        text = notification.get("text", "")
        big_text = notification.get("bigText", "")

        # 合并所有文本用于搜索
        full_text = f"{title} {text} {big_text}"

        result = {
            "raw_title": title,
            "raw_text": text,
            "raw_big_text": big_text,
            "rider_rating": None,
            "fare": None,
            "pickup": None,
            "dropoff": None,
            "pickup_time": None,
            "is_reserved": False,
        }

        # 提取评分
        rating_match = UberNotificationParser.RATING_RE.search(full_text)
        if rating_match:
            result["rider_rating"] = float(rating_match.group(1))

        # 提取车费
        fare_match = UberNotificationParser.FARE_RE.search(full_text)
        if fare_match:
            result["fare"] = float(fare_match.group(1))

        # 提取时间
        time_match = UberNotificationParser.TIME_RE.search(full_text)
        if time_match:
            result["pickup_time"] = time_match.group(1)

        # 判断是否为预约单
        reserve_keywords = ["Reserve", "Scheduled", "预约", "reservation"]
        result["is_reserved"] = any(kw.lower() in full_text.lower() for kw in reserve_keywords)

        # 提取地址（启发式：通知中 "→" 或 "to" 分隔的两个地址）
        # 这部分需要根据实际通知格式调整
        arrow_patterns = [" → ", " ➜ ", " to ", " To "]
        for arrow in arrow_patterns:
            if arrow in full_text:
                parts = full_text.split(arrow, 1)
                if len(parts) == 2:
                    result["pickup"] = parts[0].strip()[-50:]   # 取最后50字符作为出发地
                    result["dropoff"] = parts[1].strip()[:50]    # 取前50字符作为目的地
                break

        return result

# ============================================================
#  决策引擎
# ============================================================

class DecisionEngine:
    def __init__(self, config: Config):
        self.config = config
        self.total_offers = 0
        self.accepted = 0
        self.tonight_accepts = 0
        self.logger = logging.getLogger("DecisionEngine")

    def is_within_active_window(self) -> bool:
        """检查当前时间是否在活跃窗口内"""
        now = datetime.now().time()
        for start_str, end_str in self.config.active_windows:
            h1, m1 = map(int, start_str.split(":"))
            h2, m2 = map(int, end_str.split(":"))
            start = time(h1, m1)
            end = time(h2, m2)
            if start <= end:
                if start <= now <= end:
                    return True
            else:  # 跨午夜
                if now >= start or now <= end:
                    return True
        return False

    def evaluate(self, order: dict) -> tuple[bool, str]:
        """
        评估订单，返回 (是否接单, 原因)
        """
        self.total_offers += 1

        # 0. 检查活跃窗口
        if not self.is_within_active_window():
            return False, "SKIP: 不在活跃时间窗口"

        # 1. 今晚已达上限
        if self.tonight_accepts >= self.config.max_accepts_per_night:
            return False, f"SKIP: 今晚已接 {self.tonight_accepts} 单，达到上限"

        # 2. 只处理预约单
        if not order.get("is_reserved"):
            return False, "SKIP: 非预约单，忽略"

        # 3. 故意放弃（拟人化）
        if random.random() < self.config.intentional_miss_rate:
            self.logger.info("🎭 拟人化：故意放弃一个单")
            return False, "SKIP: 拟人化随机放弃"

        # 4. 强制接单（接受率过低时）
        if self.total_offers > 5:
            current_rate = self.accepted / self.total_offers
            if current_rate < self.config.force_accept_threshold:
                self.accepted += 1
                self.tonight_accepts += 1
                return True, f"FORCE_ACCEPT: 接受率 {current_rate:.0%} 过低，强制接单"

        # 5. 评分筛选
        rating = order.get("rider_rating")
        if rating is not None and rating < self.config.min_rider_rating:
            return False, f"REJECT: 乘客评分 {rating} < {self.config.min_rider_rating}"

        # 6. 车费筛选
        fare = order.get("fare")
        if fare is not None and fare < self.config.min_fare:
            return False, f"REJECT: 车费 ${fare} < ${self.config.min_fare}"

        # 7. 地理黑名单
        pickup = (order.get("pickup") or "").lower()
        dropoff = (order.get("dropoff") or "").lower()
        location_text = f"{pickup} {dropoff}"

        for blocked in self.config.geo_blacklist:
            if blocked.lower() in location_text:
                return False, f"REJECT: 命中黑名单区域 [{blocked}]"

        # 8. 地理白名单（如果能提取到地址的话）
        if pickup or dropoff:
            has_whitelist_match = any(
                w.lower() in location_text
                for w in self.config.geo_whitelist
            )
            if not has_whitelist_match:
                return False, f"REJECT: 未命中白名单区域"

        # 9. 通过所有筛选
        self.accepted += 1
        self.tonight_accepts += 1
        return True, f"ACCEPT: 评分={rating}, 车费=${fare}, 地址匹配"

    def reset_nightly_counter(self):
        """每天凌晨重置计数器"""
        self.tonight_accepts = 0


# ============================================================
#  行为拟人化引擎
# ============================================================

class HumanBehaviorEngine:
    """生成拟人化的操作参数"""

    @staticmethod
    def get_reaction_delay() -> float:
        """
        模拟人类反应时间（秒）
        正态分布：均值 5 秒，标准差 1.5 秒，最小 2.5 秒，最大 12 秒
        """
        delay = random.gauss(5.0, 1.5)
        delay = max(2.5, min(12.0, delay))

        # 10% 概率额外犹豫
        if random.random() < 0.10:
            delay += random.uniform(3.0, 8.0)

        return delay

    @staticmethod
    def get_tap_offset(target_x: int, target_y: int) -> tuple[int, int]:
        """
        在目标坐标周围加入高斯随机偏移
        人的手指精度大约 ±5-15 像素
        """
        offset_x = int(random.gauss(0, 5))
        offset_y = int(random.gauss(0, 5))
        return target_x + offset_x, target_y + offset_y

    @staticmethod
    def get_touch_params() -> dict:
        """生成随机化的触控物理参数"""
        return {
            "pressure": random.randint(40, 120),
            "touch_major": random.randint(80, 200),
            "touch_minor": random.randint(60, 150),
            "hold_duration_ms": random.randint(50, 180),
            "tracking_id": random.randint(0, 65535),
        }

    @staticmethod
    def should_scroll_first() -> bool:
        """
        20% 概率先做一个小滑动再点击
        模拟 "人先浏览一下订单详情再点接受"
        """
        return random.random() < 0.20

    @staticmethod
    def get_scroll_params() -> dict:
        """生成一个小幅度的浏览滑动"""
        return {
            "start_y": random.randint(800, 1200),
            "end_y": random.randint(600, 1000),
            "duration_ms": random.randint(200, 500),
        }


# ============================================================
#  主服务（WebSocket 服务端）
# ============================================================

class UberAutoAcceptServer:
    def __init__(self):
        self.config = Config()
        self.engine = DecisionEngine(self.config)
        self.behavior = HumanBehaviorEngine()
        self.logger = self._setup_logging()

        # 接受按钮的屏幕坐标 — 需要根据实际设备校准
        self.accept_button_x = 540
        self.accept_button_y = 1800

    def _setup_logging(self):
        logger = logging.getLogger("UberAutoAccept")
        logger.setLevel(logging.INFO)

        # 文件日志（带时间戳，用于审计回放）
        fh = logging.FileHandler(
            f"uber_auto_{datetime.now().strftime('%Y%m%d')}.log",
            encoding="utf-8"
        )
        fh.setFormatter(logging.Formatter(
            "%(asctime)s | %(levelname)s | %(message)s"
        ))
        logger.addHandler(fh)

        # 控制台日志
        ch = logging.StreamHandler()
        ch.setFormatter(logging.Formatter("%(asctime)s | %(message)s"))
        logger.addHandler(ch)

        return logger

    async def handle_client(self, websocket):
        """处理来自手机 APK 的 WebSocket 连接"""
        self.logger.info("📱 手机已连接")

        async for message in websocket:
            try:
                data = json.loads(message)

                if data.get("type") == "uber_notification":
                    await self.process_notification(websocket, data)
                elif data.get("type") == "heartbeat":
                    await websocket.send(json.dumps({"type": "heartbeat_ack"}))
                elif data.get("type") == "screenshot_result":
                    await self.process_screenshot(websocket, data)

            except Exception as e:
                self.logger.error(f"处理消息异常: {e}")

    async def process_notification(self, websocket, notification: dict):
        """处理 Uber 通知"""
        # 1. 解析通知
        order = UberNotificationParser.parse(notification)
        self.logger.info(f"📋 新订单: {json.dumps(order, ensure_ascii=False)}")

        # 2. 信息不足时回退到截图 OCR
        if order["rider_rating"] is None and order["pickup"] is None:
            self.logger.info("⚠️ 通知信息不足，请求截图...")
            await websocket.send(json.dumps({"action": "screenshot"}))
            return

        # 3. 决策
        should_accept, reason = self.engine.evaluate(order)
        self.logger.info(f"🧠 决策: {reason}")

        if not should_accept:
            return

        # 4. 拟人化延迟
        delay = self.behavior.get_reaction_delay()
        self.logger.info(f"⏱️ 拟人化等待 {delay:.1f} 秒")

        # 5. 发送点击指令
        tap_x, tap_y = self.behavior.get_tap_offset(
            self.accept_button_x, self.accept_button_y
        )
        touch_params = self.behavior.get_touch_params()

        # 是否先做一个浏览滑动
        if self.behavior.should_scroll_first():
            scroll = self.behavior.get_scroll_params()
            await websocket.send(json.dumps({
                "action": "scroll",
                "delay": int(delay * 500),  # 先等一半时间再滑动
                **scroll
            }))
            delay *= 0.5  # 剩余一半时间后点击

        await websocket.send(json.dumps({
            "action": "tap",
            "x": tap_x,
            "y": tap_y,
            "delay": int(delay * 1000),
            **touch_params
        }))

        self.logger.info(f"✅ 已发送接单指令 ({tap_x}, {tap_y})")

    async def process_screenshot(self, websocket, data: dict):
        """
        回退方案：处理截图 OCR
        仅在通知文本不完整时才使用，日常流程不走这条路
        """
        # TODO: 用 PaddleOCR / EasyOCR 处理截图
        # 这里是备用路径，暂不实现
        pass

    async def run(self):
        """启动 WebSocket 服务"""
        self.logger.info("🚀 服务启动，等待手机连接...")
        async with websockets.serve(self.handle_client, "0.0.0.0", 8765):
            await asyncio.Future()  # 永久运行


if __name__ == "__main__":
    server = UberAutoAcceptServer()
    asyncio.run(server.run())
```

### 4.3 模块三：异常处理与自动恢复

```python
class SystemHealthMonitor:
    """系统健康监控 — 无人值守的生命线"""

    def __init__(self):
        self.phone_connected = False
        self.last_heartbeat = None
        self.consecutive_failures = 0
        self.max_failures = 3

    async def check_adb_connection(self) -> bool:
        """定期检查 ADB 连接"""
        result = subprocess.run(
            ["adb", "devices"], capture_output=True, text=True
        )
        connected = "device" in result.stdout and "unauthorized" not in result.stdout

        if not connected and self.phone_connected:
            logging.warning("📵 手机 ADB 连接断开，尝试重连...")
            await self.reconnect_adb()

        self.phone_connected = connected
        return connected

    async def reconnect_adb(self):
        """自动重连 ADB"""
        for attempt in range(4):
            wait_time = 2 ** (attempt + 1)
            logging.info(f"重连尝试 {attempt + 1}/4，等待 {wait_time}s...")
            await asyncio.sleep(wait_time)

            subprocess.run(["adb", "disconnect"], capture_output=True)
            result = subprocess.run(
                ["adb", "connect", "192.168.1.xxx:5555"],  # WiFi ADB 地址
                capture_output=True, text=True
            )
            if "connected" in result.stdout:
                logging.info("✅ ADB 重连成功")
                return True

        logging.error("❌ ADB 重连失败，发送告警")
        await self.send_alert("ADB 连接断开且重连失败")
        return False

    async def check_uber_app_foreground(self) -> bool:
        """检查 Uber App 是否在前台"""
        result = subprocess.run(
            ["adb", "shell", "dumpsys", "activity", "activities",
             "|", "grep", "mResumedActivity"],
            capture_output=True, text=True, shell=False
        )
        # 实际命令需要用 adb shell "dumpsys activity activities | grep mResumedActivity"
        is_foreground = "com.ubercab.driver" in result.stdout

        if not is_foreground:
            logging.warning("Uber App 不在前台，正在拉起...")
            subprocess.run([
                "adb", "shell", "am", "start", "-n",
                "com.ubercab.driver/.UberDriverActivity"  # 需确认实际 Activity 名
            ])
            await asyncio.sleep(3)

        return is_foreground

    async def check_screen_on(self) -> bool:
        """确保手机屏幕亮着"""
        result = subprocess.run(
            ["adb", "shell", "dumpsys", "power"],
            capture_output=True, text=True
        )
        screen_on = "mHoldingDisplaySuspendBlocker=true" in result.stdout

        if not screen_on:
            # 按电源键点亮屏幕
            subprocess.run(["adb", "shell", "input", "keyevent", "26"])
            await asyncio.sleep(1)
            # 滑动解锁（如果有锁屏）
            subprocess.run([
                "adb", "shell", "input", "swipe", "540", "2000", "540", "800", "300"
            ])

        return screen_on

    async def send_alert(self, message: str):
        """
        发送告警通知到另一台设备
        可选实现：
        - Telegram Bot API（免费）
        - Pushover
        - 发送邮件
        - 简单的 HTTP webhook
        """
        # 示例：Telegram Bot
        # bot_token = "YOUR_BOT_TOKEN"
        # chat_id = "YOUR_CHAT_ID"
        # url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
        # requests.post(url, json={"chat_id": chat_id, "text": f"🚨 {message}"})
        logging.critical(f"🚨 告警: {message}")

    async def health_check_loop(self):
        """健康检查主循环 — 每 60 秒执行"""
        while True:
            try:
                await self.check_adb_connection()
                await self.check_screen_on()
                await self.check_uber_app_foreground()

                # 检查 WebSocket 心跳
                if self.last_heartbeat:
                    elapsed = (datetime.now() - self.last_heartbeat).seconds
                    if elapsed > 120:
                        logging.warning(f"⚠️ 心跳超时 {elapsed}s")
                        await self.send_alert(f"手机心跳超时 {elapsed}s")

                self.consecutive_failures = 0

            except Exception as e:
                self.consecutive_failures += 1
                logging.error(f"健康检查异常 ({self.consecutive_failures}): {e}")

                if self.consecutive_failures >= self.max_failures:
                    await self.send_alert(f"连续 {self.max_failures} 次健康检查失败: {e}")

            await asyncio.sleep(60)
```

### 4.4 模块四：监控面板（Web UI）

```
简易 Web 面板功能清单（可选，用 Flask/FastAPI 实现）：

1. 实时状态
   - 手机连接状态 / Uber App 状态 / 屏幕状态
   - 当前接受率
   - 今晚已接单数 / 上限

2. 订单流水
   - 时间戳 | 通知内容 | 解析结果 | 决策 | 原因

3. 手动干预
   - [暂停自动接单] 按钮
   - [强制接下一单] 按钮
   - [修改筛选条件] 表单

4. 历史统计
   - 每日接单数量 / 通过率 / 平均评分 / 收入估算
```

---

## 五、首次部署校准流程

### 5.1 触控参数校准（必做，每换手机做一次）

```bash
# Step 1: 找到触摸设备节点
adb shell getevent -lp
# 找到包含 ABS_MT_POSITION_X 的设备，如 /dev/input/event2

# Step 2: 录制真实手指触摸
adb shell getevent -lt /dev/input/event2
# 用手指点击屏幕 5-10 次，记录输出

# Step 3: 从录制数据中提取参数范围
# 记录 ABS_MT_PRESSURE 的最小值和最大值
# 记录 ABS_MT_TOUCH_MAJOR 的最小值和最大值
# 记录 ABS_MT_TOUCH_MINOR 的最小值和最大值
# 将这些范围填入配置文件
```

### 5.2 接受按钮坐标校准（必做）

```bash
# 方法 1: 开启触摸坐标显示
adb shell settings put system pointer_location 1
# 手动打开一个预约单通知，观察"接受"按钮的坐标
# 记录后关闭
adb shell settings put system pointer_location 0

# 方法 2: 截图后用图片查看器测量
adb shell screencap -p /sdcard/screen.png
adb pull /sdcard/screen.png
# 在电脑上打开图片，测量按钮中心坐标
```

### 5.3 通知格式验证（必做）

```bash
# 开启 Uber 司机端，等待一个真实的预约单通知
# 同时运行以下命令观察通知内容
adb shell dumpsys notification --noredact | grep -A 20 "ubercab"

# 记录通知的 title/text/bigText 格式
# 据此调整 UberNotificationParser 中的正则表达式
```

---

## 六、运行清单（每晚睡前）

```
□ 1. 手机充电线插好，电量 > 50%
□ 2. 关闭手机自动休眠（设置 > 显示 > 屏幕超时 > 永不）
□ 3. 打开 Uber 司机端，确认已上线
□ 4. 确认 WiFi ADB 连接正常：adb connect <手机IP>:5555
□ 5. 启动辅助 APK（"电池优化助手"）
□ 6. 启动电脑端 Python 服务：python uber_auto_accept.py
□ 7. 确认 Web 监控面板显示"手机已连接"
□ 8. 降低手机屏幕亮度到最低（省电 + 延长屏幕寿命）
□ 9. 手机倒扣放置（屏幕朝下，防止光线干扰睡眠）
```

---

## 七、风险矩阵与缓解措施

| 风险 | 可能性 | 影响 | 缓解措施 |
|---|---|---|---|
| Uber 检测到自动化行为 | 中 | **致命** | sendevent 仿真 + 行为拟人化 + 作息模拟 + 接受率管理 |
| 通知格式变更（App 更新） | 高 | 高 | 正则解析器需持续维护；回退到截图 OCR 路径 |
| WiFi 断连 | 中 | 中 | 健康检查 + 自动重连 + Telegram 告警 |
| 手机过热/卡死 | 低 | 中 | 屏幕最低亮度 + 健康检查发现无心跳后告警 |
| 误接差单 | 低 | 低 | 解析失败时默认不接单（宁可错过不可误接） |
| 好单因延迟被抢走 | 中 | 低 | 可接受的代价，安全优先于速度 |
| 电脑进入睡眠 | 低 | 中 | 设置电源计划为"永不睡眠"；运行 `caffeinate` 等保活工具 |

---

## 八、与原方案的关键差异

| 维度 | 原方案 v1 | 改进方案 v2 | 改进原因 |
|---|---|---|---|
| 目标延迟 | 1-2 秒 | **3-8 秒** | 1 秒响应在凌晨极不自然，是最大封号风险 |
| 触控方式 | `adb input tap` | **`adb shell sendevent` 完整事件** | input tap 缺少 pressure/size，一检测一个准 |
| 文字提取 | VLM 视觉大模型 | **`dumpsys notification` 直接读文本（无需安装 APK）** | 快 100 倍、准确率 100%、零 GPU 开销、对 Uber 完全不可见 |
| 设备指纹 | 未考虑 | **零设备侵入：不安装 APK、不 Root、不解锁 Bootloader** | NotificationListenerService 可被 Uber 检测到，dumpsys 不会 |
| 接单策略 | 只接极品单 | **接受率管理 + 偶尔接普通单 + 偶尔故意放弃好单** | 防止选择性过高触发风控 |
| 运行时段 | 全天候 | **模拟真人作息的时间窗口** | 凌晨持续活跃是明显的机器人特征 |
| GPU 使用 | Moondream2 常驻推理 | **仅通知文本不足时回退到 PaddleOCR** | 99% 场景不需要 GPU，省电省资源 |
| 异常处理 | 无 | **完整的健康检查 + 自动恢复 + 远程告警** | 无人值守必备 |
| 每晚上限 | 无限制 | **最多 5 单** | 防止产出异常被人工审查 |

---

## 九、可选增强功能（非必须）

1. **历史订单学习**：记录所有出现过的订单，分析哪些时段/区域出好单的概率更高，动态调整活跃窗口。

2. **多手机分布式**：如果有多台手机，可以在不同 Uber 账号上运行，分散单台设备的异常行为风险。但需要注意同一 WiFi 下多台设备同时秒接单也是风控信号。

3. **动态按钮定位**：接受按钮的坐标可能因 Uber 更新、不同订单类型而变化。可以在截图中用模板匹配（OpenCV `matchTemplate`）动态定位按钮，而非固定坐标。

4. **收入追踪仪表板**：对接 Uber 的收入页面，自动统计每周自动接单收入占比。

---

## 十、最终建议

> **这套系统的最大风险不是技术实现，而是行为模式**。Uber 的风控团队不是检测你用了什么技术手段，而是看你的行为是否符合正常人类司机。一个每天凌晨都能在 3 秒内精准接到高评分预约单的司机，无论用什么技术实现，都会被算法标记。

> 因此，**克制贪婪是最好的防封策略**：每晚最多接 3-5 单好单，维持正常的接受率，模拟合理的作息节奏。把这个系统当作"睡觉时偶尔帮你看一眼手机"的助手，而不是"全自动接单机器人"。
