# 如何检测「当前会话未完成却停止」

> 面向对象：`dsh-plugin-guide` 技能 / DSH 插件知识库的插件作者。
> 运行环境：DSH `0.2.2-rc.1`（latest line，版本矩阵 §3 的 19 个 breaking changes 适用，尤其是
> `2026-09-30-job-session-lifecycle` 与 `2026-09-16-session-format-v4` 两处 recent 变更需按本版本语义核对）。
> 集成落地：`dsh-flash-ctx-mon` 插件（`SessionEventTokenSource` 已订阅会话事件并读 `turn/end`；
> `auto-retry.js` 已覆盖「有 `turn/end` 但异常结束」一侧）。
> 红线：只用文档化扩展点；不新增 session event `type`；不轮询 `agent/status`/`agent`；
> 优先用 session 事件与「中断/中止」语义。

---

## 1. 问题拆解：两种「停止」是不同侧

「会话已开始（有 turn 事件）却未正常完成」在 DSH 里分两种形态，判定信号**不同**：

| 形态 | 含义 | 可依赖的信号 |
| --- | --- | --- |
| **① 有开始、无结束** | turn 已开始（`turn/start` 已落）但没有对应的 `turn/end` —— 宿主进程被杀 / 崩溃 / 连接失联 / 硬中断 | **没有事件可用**，必须靠消费方自设超时 / 观察失联边界 |
| **② 有结束、但异常** | 有 `turn/end`，但其 `reason.kind ∈ {error, interrupted, max-tokens}` | **有事件可用**，直接消费 `turn/end.reason.kind` |

`dsh-flash-ctx-mon` 的 auto-retry 目前只覆盖 **形态②**（见 `docs/auto-retry-integration-design.zh-CN.md`）。
本文重点补 **形态①** 的检测方法论。

---

## 2. 官方语义：为什么形态①没有现成事件

DSH 的会话事件与 `agent/*` 状态是分离的两条通路（`docs/agent-lifecycle.md`）：

- **durable 回放事实**在 `session/event`（`turn/start` … `turn/end`）；**live 控制/状态**在 `agent/*`
  （`agent/status` → `running` / `idle`）。插件作者应优先消费 `session/event`，`agent/*` 是活坐标。

关键约束（官方原文语义）：

> “a hard process loss before settlement leaves no durable attempt stream.”
> —— 进程在落定（settlement）前硬崩，**不留下任何 durable 的 attempt/请求流**，也就**不发 `turn/end`**。

> architecture 文档：未被后续事件封住的普通中断尾部仍由**柄消费方修复**；只有后续 `turn/start`
> 重新封住（seal）一种已发布的 restart 时，migration 才会插入缺失的 `interrupted` `turn/end`。

翻译成结论，**两条**：

1. DSH **不会为一次硬中断自动补发 `turn/end`**。一个被打断的回合在 durable 层就表现为
   「有 `turn/start`、无 `turn/end`」的**开口尾部**。
2. 唯一的「官方补丁」发生在**迁移（migration）时且需要后续 `turn/start` 封住**才插入
   `interrupted turn/end` —— 那是对**旧格式回放**的修复，不是面向**当前正在发生的硬中断**的告警信号。

所以：**要检测「正在发生的会话未完成却停止」，DSH 不给你现成事件——这正是留给扩展点消费方的职责。**
这不是缺陷，而是设计：硬中断发生在宿主侧进程边界，事件管道本身都断了，唯一可靠的做法是
**消费方自持「回合应从开始到结束」的预期，并用超时/失联观察来闭合这个预期**。

---

## 3. 方法：把「turn 是开口的」这个事实显式化

推荐做法——在**当前会话绑定的事件源**上做「open turn 记账 + 看门狗」：

### 3.1 记账（只依赖文档化事件）

只消费会话事件，不开新 type：

1. 订阅当前会话 `sessions.binding(id).eventSource`（现有 `SessionEventTokenSource` 已做）。
2. 记录 `turn/start` → 置 `openTurn = true`；同时若有当前 `seq`，记下开口点。
3. 记录 `turn/end` → 置 `openTurn = false`，并读其 `data.reason.kind`：
   - 正常完成 → 回合闭合，无异常；
   - `error / interrupted / max-tokens` → 形态②已结束 → 交给 auto-retry（项目已有）。
4. 关键点：**开口回合若无 `turn/end` 闭合，就是「未完成却停止」的候选**。

### 3.2 看门狗（闭合预期，闭环检测）

因为硬中断不产生事件，需要一个**超时时钟**来「宣告」这个对象回合已经停止：

- 在 `turn/start`（或观察到 `agent/status → running` 之后）启动/重置一个 watchdog；
- 宽限时长参考模型长输出——建议与 auto-retry 的 `graceMs` 同一量级（数秒到数十秒）；
- 若在窗口内收到 `turn/end` → 取消看门狗（回合正常闭合）；
- 若窗口到期仍 `openTurn === true` → 判定「会话未完成却停止」→ 触发 UI 提醒 / 提示，交由用户决定
  （而非自动烧钱继续）。

**注意红线**：这一步是**用户可感知的超时判断**，不含对 `agent/status` 的轮询（轮询 `agent/status`
判断 running→idle 属于活坐标且不覆盖硬崩——进程死了连状态都刷不出来）。看门狗是我们自持的事实，
不新增 session event type。

### 3.3 额外信号（可选增强，仍属文档化）

- **owning handle 失联**：`sessions.binding(id).eventSource` 的订阅句柄在宿主/会话替换时会被替换
  （重连、重命名、`Session` 对象替换）。当绑定被替换而我们的 `openTurn` 仍未闭合，且新绑定开始新的
  `turn/start` —— 其实就是官方 migration 描述的场景在 live 侧的对应：**旧开口回合应被当作 interrupted
  闭合**。可用此事件边界来「补宣告」旧回合停止。
- **`session/projection` / telemetry ops 的 `shutdown` 信号**：session-telemetry 有一个 `shutdown`
  ops 信号，可用于**优雅关闭**场景的兜底告知；它不替代硬崩检测，只作为补充。

---

## 4. 在 `dsh-flash-ctx-mon` 的落地建议

- 在 `SessionEventTokenSource._processEntries` 增加对 `turn/start` 的记账（当前只记 `turn/end`）。
- 新增 `openTurnWatchdog`：纯函数可测模块（对齐现有 `auto-retry.test.js` 的纯函数风格），
  输入 `(openTurn, elapsedMs, graceMs)` → 输出「是否判定未完成停止」，不依赖真实时钟以便单测。
- 判定「停止」后**只提醒不自动续**（区别于 auto-retry 的自动继续）——形态①可能意味着宿主异常，
  自动续会反复失败且可能重复计费；应先提示用户。

---

## 5. 一页速记

- 用户问的「未完成却停止」= **开口回合（有 `turn/start`、无 `turn/end`）**，是硬中断形态。
- DSH **不自动补发**闭合事件：硬崩在 durable 层就是开口尾部；官方只在 migration＋后续
  `turn/start` 封住时才插入 `interrupted turn/end`。
- 检测 = **open-turn 记账（会话事件）＋ 看门狗超时闭合预期**；不轮询 `agent/status`，不开新事件 type。
- `turn/end` 且 `reason.kind ∈ {error, interrupted, max-tokens}` 是**另一侧**（已闭合但异常），
  auto-retry 已覆盖。
- 硬中断检测侧重「提醒、交还控制、防重复计费」，不应自动烧钱续接。
