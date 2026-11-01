# 整合设计定稿：把自动继续能力并入 `dsh-flash-ctx-mon`

> 状态：**设计定稿（存档）** · 尚未改动任何功能代码。
>
> 目的：评估并整合 [`@frog755/dsh-client-auto-retry`](https://github.com/Frog755/dsh-client-auto-retry)
> 的「防止会话未完成却总是自动停」能力，以**独立提醒弹窗 + 常驻处置按钮**的形式并入
> `dsh-flash-ctx-mon`，且**只对当前会话生效**。
>
> 依据源码：
> - ctx-mon 浏览器半 `src-client/factory-body.js`（打包产物 `lib/client.js`）
> - ctx-mon 宿主半 `src/index.ts`、`package.json`
> - auto-retry [`lib/client.js`](https://raw.githubusercontent.com/Frog755/dsh-client-auto-retry/main/lib/client.js)、[`lib/index.js`](https://raw.githubusercontent.com/Frog755/dsh-client-auto-retry/main/lib/index.js)

---

## 1. 结论先行

两边都是**纯客户端**插件，通过同一个客户端运行时取会话事件：

- **ctx-mon** 的 `SessionEventTokenSource` 已经订阅会话事件、读 `turn/end`，并且**已经在处理
  `reason.kind === 'error'`**（用于上下文用尽错误解析）。它注册告警提供者走
  `ctx.get('dockFlashAlerts')`、面板开关走 `ctx.get('quickControl')`——这正是 dsh-flash 伴生插件的
  集成面。
- **auto-retry** 的 `AutoRetryRunner` 在 `turn/end` 命中 `error / interrupted / max-tokens` 后补发
  「继续」，带宽限期、冷却、连续上限、指数退避、自身回显识别、启动扫描与停止按钮。

两边吃的判定信号**天然一致**（`turn/end` 的 `reason.kind`），且 ctx-mon 的 `dsh.client.inject` 已声明
`@deepseek-ai/dsh-client-runtime`，即 auto-retry 依赖的同一运行时，**不需要新增运行时依赖**。

**唯一值得小心的地方**是事件通路的差异：ctx-mon 走**当前打开会话**的
`sessions.binding(id).eventSource`（方案 A，纯会话内自救），auto-retry 走**全局 `api.events.mux`**。
本设计按用户决定采用方案 A，因此**只对当前会话、不引全局 mux**。

---

## 2. 产品形态（已拍板）

- 新建一个**独立提醒弹窗**（`react-dom` `createRoot` 挂到 `document.body`，仿 ctx-mon / dsh-flash 已有
  独立面板做法），**常驻始终显示**，不复用上下文告警（context-alert）弹窗。
- 弹窗内**常驻**：「自动继续」处置按钮（🔁）、「停止」按钮、一条状态行。
- 点「自动继续」→ **武装（Arm）自动模式**；「停止」→ 解除。
- 模式启用后：**只对当前会话**，当该会话回合以 `error / interrupted / max-tokens` 结束时，经宽限期
  自动补发「继续」并持续接续，直到有人工输入 / 连续超限 / 用户点「停止」。

决策记录（用户确认）：**方案 A（纯会话内自救）** · **按会话隔离状态** · **独立弹窗常驻始终显示** ·
**点按钮进入自动模式持续接续**。

---

## 3. 作用域：按会话隔离状态

- 自动模式的 **armed 状态、剩余连续次数、冷却截止、退避级别** 全部**按 sessionId 各存一份**。
- 弹窗永远显示**当前会话**自己的状态：
  - 在会话 A 武装后切到会话 B → 看到 B 自己的状态（默认未武装），A 不被误触；切回 A 状态仍在。
- 事件消费走 ctx-mon 现有模型：`sessions.scopeOf(ctx)` 得当前活动会话 → `sessions.binding(id).eventSource`
  读事件（方案 A，无全局 mux）。

---

## 4. 状态机

| 状态 | 行为 |
| --- | --- |
| 未武装 | 只挂按钮，不监听不动作。 |
| 已武装·等待 | 监听当前会话 `turn/end`，命中 `error/interrupted/max-tokens` → 进入 graceMs 宽限期。 |
| 已武装·退避/冷却 | 已发过「继续」，cooldownMs 内不再发；达到 `maxConsecutive` → 转「暂停，等人」。 |
| 已解除 | 点「停止」，或检测到人工输入（非自身回显）。 |

---

## 5. 防烧钱护栏（整体保留，漏了最危险）

1. `cooldownMs`（默认 20000）：同会话两次动作的最小间隔。
2. `maxConsecutive`（默认 4）：连续续到上限即停，等人。
3. 指数退避 `delay = min(graceMs·2ⁿ, maxBackoffMs)`，失败越多次隔得越久。
4. **自身回显识别**：`sessions.prompt` 发出的消息 `source.kind === "user"`，靠「文本 == continueText 且
   在 `echoWindowMs` 窗口内收到」判定为自身回显——**否则自己发的「继续」会把自己的连续计数与人工检测
   一起欺骗**。
5. **人工输入即退出**：检测到非回显的人工输入 → 清零并退出重试循环。
6. 一次只排一个定时器，不叠加。

---

## 6. 落地映射

| 半 | 文件 | 改动 |
| --- | --- | --- |
| 宿主 | `src/index.ts` | `dsh-flash-ctx-mon` 命名空间新增一组 `volatile()` 字段：`autoRetryGraceMs`(5000)、`autoRetryCooldownMs`(20000)、`autoRetryMaxConsecutive`(4)、`autoRetryMaxBackoffMs`(300000)、`autoRetryContinueText`("继续")、`autoRetryEchoWindowMs`(30000)。**不写进核心 `dsh-flash` 命名空间。** |
| 浏览器 | `src-client/factory-body.js` | ① `SessionEventTokenSource._processEntries`：`turn/end` 的 reason 判定从仅 `error` 扩到 `{error, interrupted, max-tokens}`，把终止原因交给 AutoRetry 状态机；② 新增 `AutoRetryRunner`（会话级去重/宽限/退避/上限/回显/人工退出，有状态逻辑**内联**在 `factory-body.js`）；③ 新增常驻独立弹窗（含「自动继续」「停止」＋状态行）。 |
| 设置 | 「配置」面板 | 加一组 Auto-Retry 输入/滑块（沿用现有 slider 风格）。 |
| 测试 | `test/` | Runner 的判定/退避/上限/回显识别抽成**纯函数**放可测模块，用现成 Vitest 单测覆盖。 |
| 构建 | 脚本 | 宿主半 `pnpm run build`（tsc→dist）＋ 浏览器半 `build:client`（esbuild→lib/client.js）；`dist/` 与 `lib/` 按惯例**提交**；改完刷新 Web 页面验证。 |

依赖：**无新增运行时依赖**——继续借已声明的 `@deepseek-ai/dsh-client-runtime` 与 `ctx.get('sessions')`。

---

## 7. 待后续决定项

- **归属与依赖确认**：以独立开关形式并入 `dsh-flash-ctx-mon` 命名空间、不碰核心 `dsh-flash`、无新运行时
  依赖——此边界已获用户认可。
- **许可证**：ctx-mon 为 Apache-2.0（tcgbp），auto-retry 为 MIT（Frog755）；若将 auto-retry 的实现整体
  并入，代码引用/归属处理仍需在实施前单独确认（此前的作者关系评估结论：**纯技术评估，是否并入尚未决定**）。

---

*本文档为纯设计存档，不属于功能改动，不 bump 版本、不写 CHANGELOG。*
