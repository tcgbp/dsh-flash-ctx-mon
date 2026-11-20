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
  `ctx.get('dshFlashAlerts')`、面板开关走 `ctx.get('quickControl')`——这正是 dsh-flash 伴生插件的
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
  自动补发「继续」并持续接续，直到连续超限 / 用户点「停止」（**人工输入不作为退出条件**，见 §4/§5）。

决策记录（用户确认）：**方案 A（纯会话内自救）** · **按会话隔离状态** · **独立弹窗常驻始终显示** ·
**点按钮进入自动模式持续接续**。

---

## 3. 作用域：按会话隔离状态

- 自动模式的 **armed 状态、剩余连续次数、冷却截止、退避级别** 全部**按 sessionId 各存一份**。
- 弹窗永远显示**当前会话**自己的状态：
  - 在会话 A 武装后切到会话 B → 看到 B 自己的状态（默认未武装），A 不被误触；切回 A 状态仍在。
- 事件消费走 ctx-mon 现有模型：`sessions.scopeOf(ctx)` 得当前活动会话 → `sessions.binding(id).eventSource`
  读事件（方案 A，无全局 mux）。
- **「非当前会话永不真正 auto-send」边界（三重门槛，缺一不可）：**
  - ① **事件源唯一性**：`SessionEventTokenSource` 只在 `_bindToSession()` 对 `sessions.binding(_sessionId).eventSource`
    调一次 `subscribe`；切走时先对旧会话 `_unsubscribe()` 再绑新会话（`_reset`）。因此**代码可见的 `turn/end`、
    `turn/start`、`user/message` 只来自当前绑定会话**——非绑定会话此后不再有任何事件进屋，从源头就无法触发继续。
  - ② **runner 记录只按当前 `_sessionId` 索引**：`_activeAutoRetryRecord()` = `_retryBySession[_sessionId]`，
    真正发送继续的入口 `_autoContinueEntry()` 首行即取它，取到 `null`（非当前会话）直接返回、不 `prompt()`；
    即便 `_retryBySession` 里残留切走会话的 armed 记录，也不会被用到。
  - ③ **发送目标也是当前会话**：`_resolveAutoSession()` 用当前 `_sessionId` 解析 session 再 `session.prompt()`——
    即便①②意外漏过，发出的也是**当前绑定会话**，绝不可能把「继续」文本投到别的会话。
  - 结论：persisted armed 标记（localStorage）只用于**切回该会话后恢复其 armed 状态**（`_bindToSession` 里
    `isPersistenceArmed` → `_armAutoRetry`），绝不等于「后台替非当前会话代发」；真正 auto-send 恒指向此刻绑定的那个会话。

---

## 4. 状态机

| 状态 | 行为 |
| --- | --- |
| 未武装 | 只挂按钮，不监听不动作。 |
| 已武装·等待 | 监听当前会话 `turn/end`，命中 `error/interrupted/max-tokens` → 进入 graceMs 宽限期。 |
| 已武装·退避/冷却 | 已发过「继续」，cooldownMs 内不再发；达到 `maxConsecutive` → 转「暂停，等人」。 |
| 已解除 | 点「停止」，或自动补发无法执行（解析不到会话 / 文本为空 / prompt 失败），或**已武装且未暂停的会话回合正常结束（settled）**——解除并暂停本会话的自动继续、弹一次退出告警；连续超限则转「暂停，等人」（人工输入不触发解除，未武装会话正常收尾保持未武装）。 |

---

## 5. 防烧钱护栏（整体保留，漏了最危险）

1. `cooldownMs`（默认 20000）：同会话两次动作的最小间隔。
2. `maxConsecutive`（默认 4）：连续续到上限即停，等人。
3. 指数退避 `delay = min(graceMs·2ⁿ, maxBackoffMs)`，失败越多次隔得越久。
4. **自身回显识别**（按 §8.4 实证修订）：`sessions.prompt` 发出的消息实际落成 **`user-rpc` source、其
   `kind === "user"`**（`@deepseek-ai/dsh-llm` 的 `MessageSourceMap` 增补，`dsh-api-session-controller` 的
   `types.d.ts` L388–402），故按 `source.kind === "user"` 判定**依然成立**；判定精确化为「`source.kind === "user"`
   且（当 source 带 `rpcId` 时）`rpcId === 本次自动继续的 requestId`，且 `text == continueText` 并在
   `echoWindowMs` 窗口内收到」——**否则自己发的「继续」会欺骗连续计数与人工检测；且不比对 `rpcId` 时，
   用户恰好输入相同文本会被误判为回显**。
5. **人工输入不退出**（修订）：检测到不匹配第 4 条回显判定的人工输入 → **守卫保持 armed**、不解除、
   不消耗连续预算；下次可重试的 `turn/end` 照常自动补发「继续」。解除只发生在预算耗尽（→paused）、
   用户显式「停止」、或**已武装且未暂停的会话回合正常结束（settled）**（2026-11-20 恢复旧守卫）——
   本会话回合已自行跑完即视为任务告一段落，守卫解除、自动继续暂停直到用户重新武装；
   未武装会话的 normal 完成保持 unarmed（不被动武装）。
5b. **退出告警带定位信息**：`_noteAutoRetryExit` 记录会话退出时把该会话 `cwd` 解析为「工作区」、`sessionId`
    解析为「会话显示名」，随 `_autoRetryExitedPending` 一并带上；provider 在 info 告警 message 末尾追加
    `（会话 <sessionName> / <sid>，工作区 <workspaceBasename>）` 定位后缀，方便用户切回后快速定位是哪个会话/工作区退出了自动继续——
    名字优先于裸 id（`_sessionDisplayTitle` 依次取 `SessionSummary.displayTitle` → `title` → 回退 id；
    `_pathBase` 把 Windows/Unix 的 cwd 折叠为末段）。
    **2026-11 恢复（settled 重回退出原因）**：`AUTO_RETRY_EXIT_REASONS` = `['budget', 'prompt-failed', 'settled']` ——
    **回合正常收尾（settled → 解除已武装且未暂停会话的守卫并暂停其自动继续）**、**连续补发达上限（→paused）**
    与**宿主拒绝自动补发 prompt**（`res.ok === false` / RPC 抛错，
    如 `session/not-found` / `session/agent-busy` / `session/writer-held` / `gateway/*`）都弹一条
    🔁 info 告警——三者都是「用户无任何操作却自动离开自动继续」，需要点名。其中「prompt 被拒」是
    **异步**落地：`_autoContinueEntry` 先乐观记 `emitted` 并回绿（成功节奏不变），宿主随后拒绝时由
    其 `.then`/`.catch` 触发 `_failAutoContinuePrompt(requestId, detail)`——以 `lastRequestId` 匹配
    做护栏（不误杀更新一次仍在排程的尝试），再 `_disarmAutoRetry('prompt-failed')` 站下（→ stopped，
    与 §4「prompt 失败→已解除」一致），并把宿主拒绝详情附到告警末尾。**手动「停止」**仍是用户自身
    显式动作、不言自明，不再弹退出告警（`disarmAutoRetry('manual')` 照常解除守卫，只是静默），
    对应的 `autoRetryExitedReasonManual` i18n（zh/en）删除；`autoRetryExitedReasonKey` 恢复
    `prompt-failed` 与 `settled` 分支，`autoRetryExitedReasonSettled` i18n（zh/en）一并恢复。
5c. **可重新开启被挂起的会话**（新增，响应「已中断/已暂停会话打不开自动继续」）：被预算耗尽
    冻结到 `paused` 的记录仍是 `armed: true`，旧实现里 `_armAutoRetry` 只在 `!rec.armed` 时才重新播种预算，
    于是开关/继续词对其都是**静默空操作**——一旦暂停便无路可回。现改为**显式用户动作**（快捷「自动继续」
    开关拨开、resident 面板「立即武装」按钮、或裸继续词入口）调用 `_armAutoRetry(true)`：对 `armed && paused`
    的记录清掉 `paused`/`pending`/`backoffLevel`/`cooldownUntil`、把 `remaining` 重新播种为新的
    `autoRetryMaxConsecutive`，从而让护栏以「可再次烧到上限」的方式重新武装。内部路径（`_handleTurnEnd`
    命中可重试结束的自动再武装、重绑时按持久化偏好恢复）**不带 force**，故被挂起的会话不会自行复活——
    护栏的「暂停等人」语义得以保留，只是把重新开启的控制权交还用户。resident 面板 `armDisabled` 相应改为：
    仅在无 view/source、`scheduled`（已排程）、或已 armed 且仍有预算时禁用；`stopped` 与 `paused` 均可点「立即武装」。
   此外，常驻图标（`[data-dsh-flash-trigger]`，§8 指示条）在 `paused` 时右下角注入一枚小 **↻ 重新开启**
   按钮（`[data-ctx-mon-rearm]`，`role=button`，仅暂停态由 `_placeAutoRetryRearm` 真实注入/移除，纯 CSS 无法承载点击），
   点击等价于受控重新武装：预算播种回满、红环变回待命绿。
6. 一次只排一个定时器，不叠加。
7. **固定投递模式 `"queue"`**（新增，实证见 §8.4）：`session/prompt` 契约支持 `mode: "queue" | "steer"`
   （`SessionPromptRequest`，`types.d.ts` L332–340；客户端绑定面 `Session.prompt(content, mode, signal?, requestId?)`，
   `client/sessions/session.d.ts` L144）；自动继续恒用 **`"queue"`**（追加），避免 steer 的插队/编辑语义。
8. **幂等重发**（新增，实证见 §8.4）：自动继续发送**稳定 `requestId`**（per-session + attempt token，客户端自签）；
   host 对已进入 queue/日志的 `requestId` 直接返回原接受结果、不重复插入（README L34）——网络重发天然去重。
9. **疑问句结尾 → 跳过一次自动补发，等待用户回答**（新增）：当某回合模型**最后一段文字**（`_lastAssistantText`，
   与 §4 中 `isHandoffStub` 检查的是同一段文本）含问号（`?` 或 `？`）时，本回合**不自动发送「继续」**——模型是在
   向用户提问、期待其回答，应先停下来让用户反馈，避免自动补发的「继续」抢在回答之前发出。判定用纯函数
   `textHasQuestionMark(text)`（仅半角/全角问号，空/非字符串为 false）。语义：这次**只跳过本次补发**，
   **守卫保持 armed 待命**——用户回答进入新一轮回合后，回合结束再按常规规则判断是否自动继续；
   预算/退避/排程等在 `_handleTurnEnd` 公共调度点被统一抑制，因此可重试结束（error/interrupted/max-tokens）
   与已武装会话的 normal 完成都在同一点生效，不消耗连续预算、不触发退出告警。

---

## 6. 落地映射

| 半 | 文件 | 改动 |
| --- | --- | --- |
| 宿主 | `src/index.ts` | `dsh-flash-ctx-mon` 命名空间新增一组 `volatile()` 字段：`autoRetryGraceMs`(5000)、`autoRetryCooldownMs`(20000)、`autoRetryMaxConsecutive`(4)、`autoRetryMaxBackoffMs`(300000)、`autoRetryContinueText`("继续")、`autoRetryEchoWindowMs`(30000)。**不写进核心 `dsh-flash` 命名空间。** |
| 浏览器 | `src-client/factory-body.js` | ① `SessionEventTokenSource._processEntries`：`turn/end` 的 reason 判定从仅 `error` 扩到 `{error, interrupted, max-tokens}`，把终止原因交给 AutoRetry 状态机；② 新增 `AutoRetryRunner`（会话级去重/宽限/退避/上限/回显/人工退出/**固定 `queue` 模式/稳定 `requestId` 幂等**，有状态逻辑**内联**在 `factory-body.js`）；③ 新增常驻独立弹窗（含「自动继续」「停止」＋状态行）；④ **落地面 L17**：`sessions.binding(id).eventSource` 只绑定当前 GUI 会话，随当前绑定/`Session` 对象替换（重连、重命名）跟随，prompt 恒发往当前绑定 id；⑤ **L16 模型发现已去耦**：旧「模型上下文窗口表」已移除——窗口改为读时从 llm-pi-ai 模型配置 / request-context 事件解析，不再消费 `remote.session.modelCatalog()` 维护窗口表，故不再受空目录影响。 |
| 设置 | 「配置」面板 | 加一组 Auto-Retry 输入/滑块（沿用现有 slider 风格）。 |
| 测试 | `test/` | Runner 的判定/退避/上限/回显识别（含 `rpcId` 精确匹配与稳定 `requestId` 幂等）抽成**纯函数**放可测模块，用现成 Vitest 单测覆盖。 |
| 构建 | 脚本 | 宿主半 `pnpm run build`（tsc→dist）＋ 浏览器半 `build:client`（esbuild→lib/client.js）；`dist/` 与 `lib/` 按惯例**提交**；改完刷新 Web 页面验证。 |
| 冒烟 | 干净 `DSH_HOME` profile | 按 **L14**：用 `dsh plugin --profile <name> add <package>`（旧 `… add <pkg> --profile <name>` 自 0.2.1-alpha.2 起已失败）做安装+启动+卸载冒烟，对齐官方 verify:self-contained；失败看日志尾部并给出建议。 |

依赖：**无新增运行时依赖**——继续借已声明的 `@deepseek-ai/dsh-client-runtime` 与 `ctx.get('sessions')`。

---

## 7. 待后续决定项

- **归属与依赖确认**：以独立开关形式并入 `dsh-flash-ctx-mon` 命名空间、不碰核心 `dsh-flash`、无新运行时
  依赖——此边界已获用户认可。
- **许可证**：ctx-mon 为 Apache-2.0（tcgbp），auto-retry 为 MIT（Frog755）；若将 auto-retry 的实现整体
  并入，代码引用/归属处理仍需在实施前单独确认（此前的作者关系评估结论：**纯技术评估，是否并入尚未决定**）。

---

## 8. §13 版本闸门适配附录（宿主 `0.2.1-rc.5` 实证）

### 8.1 宿主版本判定

`dsh --version` = `0.2.1-rc.5` → **on/after `0.2.1-alpha.2`** → `guide/migration-0.2.md` §13 的 19 条规则
**全部适用**（每条逐一核对，不得整体跳过）。

校验 API 形状的依据优先序：**真实宿主产物 d.ts > 官方文档镜像**。官方文档镜像对 `sessions.prompt` 只有
signature 注释、缺字段体；作者复核已裁决「补丁后缀的语义面差异不可信，以已文档化契约为准」；因此本附录的
字段级事实直接取自 **0.2.1-rc.5 宿主包 `@deepseek-ai/dsh-api-session-controller` 的 d.ts 源码**。

### 8.2 关键真实产物实证（0.2.1-rc.5）

| 契约 | 位置 | 形状 |
| --- | --- | --- |
| `SessionPromptRequest` | `…\lib\types\types.d.ts` L332–340 | `{ requestId: SessionRequestId; sessionId; mode:'queue'\|'steer'; content: readonly PromptContentPart[]; clientTimeZone?: string }`；content 至少一个非空白文本 part 或附件 |
| `SessionPromptValue` | 同文件 L342–344 | `{ readonly accepted: true }`（准入回执） |
| `PromptContentPart` | 同文件 L79–90 | `{type:'text',text}` \| `{type:'image',mediaType,data,name?}` \| `{type:'file',receiptId}` |
| `SessionRequestId` | 同文件 L387 | `Branded<'session-request-id'>`（client-minted 幂等身份） |
| `user-rpc` source | 同文件 L388–402（在 `@deepseek-ai/dsh-llm` 的 `MessageSourceMap` 上增补） | `{ kind:'user'; rpcId: SessionRequestId; clientTimeZone?; principal? }`——**kind 仍是 `'user'`**；`principal` 仅非 owner 调用方写入 |
| 客户端绑定面 | `…\lib\types\client\contract\session.d.ts` L82、`…\client\sessions\session.d.ts` L144 | `Session.prompt(content: PromptContentPart[], mode:'queue'\|'steer', signal?, requestId?)`——包装后自动构造上表的 request；`requestId` 缺省由客户端自签 |
| `Session` 对象替换 | `…\client\sessions\session.d.ts` L23–28 | `onEngaged` 在每次 accepted prompt 后发布，**Session 对象被替换后也继续** |
| 命令路径 | `…\lib\types\commands.d.ts` L53–60 | `prompt(request, source: MessageSource)`：Remote 方法「已校验 content 并构建持久消息 source」；`hasPromptContent`（L14）在准入处拒绝空 content |
| 运行时校验 | `…\lib\typert.host.js` L1125–1126 / L1307–1308 | prompt 参数 zod schema（`session_prompt_parameter_0`） |

宿主控制器 README（`…\dsh-api-session-controller\README.zh.md` L34）权威说明：

- `session/prompt` **构造持久的 `user-rpc` 消息 source**；非 owner 调用方记录经 `principalOf(this.ctx.invocation)`
  读取的 `principal`，owner 的 source 不带 `principal`。
- **`requestId` 已进入 queue 或日志时，prompt 重试直接返回原来的接受结果，不会重复插入消息** → 自动继续可发
  稳定 `requestId`，host 层天然去重、防重复插入。
- 准入可从注入的 `fileUploads` Host 服务取不透明凭证，解析到 `ctx.attachments` 前校验每个属于同一 Agent 的
  凭证（设计 §5 纯文本「继续」用不到附件，但契约支持附件生产）。

### 8.3 19 条逐条结论

| 规则 | 结论 | 依据 |
| --- | --- | --- |
| L1 subagent-activations | **N/A** | 设计不创建/驱动 subagent，不用 `ctx.subagents`；`startActivation({delivery:'caller'})`/`prepareContinuable()` 一概不涉及 |
| L2 tool-presentation-mode | **N/A** | 无 `tools.presentAs`/`DSH_TOOLS_MODE` |
| L3 web-listener-trust-config | **N/A** | 浏览器半 `inject:['remote','remote.settings']`（无 `webRuntime`）；宿主半仅 `inject(['settings'])`；无 `lanAddresses`/通配 host |
| L4 working-directory | **N/A** | 无 `{{cwd}}` prompt 模板 |
| L5 session-title-provider-strategy | **N/A** | 无 title provider |
| L6 session-title-adapters | **N/A** | 无 `ctx.llm` |
| L7 ssh-helper-launch | **N/A** | 本地 standalone，无 SSH 助手 |
| L8 team-direct-inbox | **N/A** | 无 teams；不涉及 `send_message`/`maxPendingMessagesPerMember` |
| L9 instruction-home-override | **N/A** | 无 dshHome 注入/残余键 |
| **L10 experimental-package-composition** | **相关** | `dsh plugin add` 须显式安装 peers；安装 ≠ 挂载；并入前后用干净 profile 冒烟 |
| L11 native-subagent-bundle-tools | **相关（merge-time 提示）** | 插件自身不导出 `BundleInfo`/`PluginPackageRef`，不触发 TYPE BREAK；但宿主半未来若新增注入面，需按官方组合要求复核 required 字段 |
| L12 python-ptc-sandbox | **N/A** | 无 Python 运行时 |
| L13 python-optional-resources | **N/A** | 无 Python 运行时/资源 |
| **L14 plugin-option-placement** | **直接相关** | 冒烟安装必须用 `dsh plugin --profile <name> add <package>`；旧写法 `… add <pkg> --profile <name>` 自 0.2.1-alpha.2 起已失败 |
| L15 terminal-command-labels | **N/A** | 浏览器客户端非 terminal UI；无 `TerminalBlockLabels` |
| **L16 deepseek-model-discovery** | **直接相关** | ctx-mon 旧「模型上下文窗口表」已移除——窗口改为读时从 llm-pi-ai 模型配置 / request-context 事件解析，不再消费 `remote.session.modelCatalog()` 维护窗口表，故不再需要空目录回退；模型列表若展示仍可经 `modelCatalog()`，需配置 key 或 `apiKeyEnv`（默认 `DEEPSEEK_API_KEY`）。**自动继续本体不依赖 modelCatalog**——只依赖 `turn/end` 事件与 `session.prompt` RPC，二者已在 0.2.1-rc.5 实证存在 |
| **L17 new-session-generations** | **直接相关** | 新会话现在同时建新 Agent、不再复用空会话；预置变更前的旧会话不自动跟随 → 自动继续必须作用在**当前 GUI 绑定的 Session** 上（`sessions.binding(id).eventSource`），且 `Session` 对象被替换（重连/重命名）后 `onEngaged` 仍发布 → 与设计 §3「按 sessionId 隔离 + 只对当前会话」自洽 |
| L18 mock-messages-events | **N/A** | 无 mock/llm-mock-server |
| L19 desktop-test-auth-popup | **N/A** | 浏览器 Web GUI；仅走 Desktop 测试构建时才需 `updates.allowTestAuthPopupWindow: true` + 完全重启 |

### 8.4 由此对设计 §5/§6 的修订建议（已回填至正文 §5/§6，此处保留作追溯）

1. **§5 第 4 条自回显判定精确化**：实证 `session/prompt` 落成 `user-rpc` source 且 `kind === 'user'`——原文
   `source.kind === 'user'` 判定**依然成立**；建议增强为「`source.kind === 'user'` 且（当 source 带 `rpcId` 时）
   `rpcId === 本次自动继续的 requestId`」，比「仅文本匹配 + echoWindowMs」更可靠，能防用户恰好输入相同文本被
   误判为回显。
2. **§5 补 `mode`**：`prompt` 契约是 `'queue' | 'steer'`；自动继续应固定 `'queue'`（追加），避免 steer 的
   插队/编辑语义。
3. **§5 幂等利用**：自动继续发**稳定 `requestId`**（per-session + attempt token）；host 对已入队 `requestId`
   直接返回原接受结果 → 网络重发天然去重，不会重复插入「继续」。
4. **§6 冒烟命令**：装配步骤改用 `dsh plugin --profile <name> add <package>`（L14）。
5. **§6 ctx-mon 模型表**：消费空 catalog 时回退 `ctxApproxWindow`（L16）。
6. **落地面（L17 相关）**：prompt 的目标 sessionId 取「当前绑定 id」并随绑定变化跟随；状态表仍按 sessionId 键控。

### 8.5 记录

- §13 的 19 条已**逐条**核到 **N/A 或（L10/L14/L16/L17）明确落点**；无「未核」项。
- L8（团队收件箱丢消息）、L9（dshHome 残余键静默忽略）属数据丢失/静默类；本设计无 teams、无 dshHome，
  直接 N/A，不进入代码。
- 相关但非阻断项（L10、L11 merge-time host review）写入 §6 冒烟/复核清单，不阻塞设计定稿。
- 本轮已将 §8.4 六条**全部回填**：§5 守卫第 4 条精确化（`rpcId` 匹配）、新增第 7 条（固定 `queue` 模式）、
  新增第 8 条（稳定 `requestId` 幂等）；§6 映射表浏览器行增补 ④ 落地面 L17、⑤ 空目录 L16，测试行纳入
  `rpcId`/幂等用例，并新增「冒烟」行（L14 命令形态）。§8.4 原文保留作追溯。

---

## 9. 宿主契约核查：为什么「非当前会话自动发送继续」不可行（记录）

本节为一次**后续核查**的记录，回答「开启自动继续的那个会话被切走后，能否再由插件代发 continue」。
核查依据真实宿主产物 `@deepseek-ai/dsh-api-session-controller/lib/types/client/`（0.2.1-rc.5），仅做只读
核对、不新增代码；与 §8.2 互补——后者证实 `session/prompt` 契约存在，本节证实「跨会话通路」这一步的边界。

### 9.1 事实 A：不存在全局事件流

- `contract/events.d.ts`（`SessionEventSource`）唯一暴露的事件源是
  `SessionEventSource = ObservableSnapshot<SessionEventWindow>`，一个**单会话**事件窗口，由
  `MutableSessionEventSource.replace / prepend / append` 驱动；没有跨会话聚合源。
- 对全部 `dsh-api-*` 包检索 `mux` / `api.events` / `EventSource` 等事件相关标识，命中集中在
  `dsh-api-gateway` 的 `RemoteStreamMuxClient/Server`（WebSocket 流多路复用），**与会话事件无关**。
- **结论：设计早期对「全局 `api.events.mux`（跨会话事件流）」的设想在真实宿主不存在。**

### 9.2 事实 B：没有「对任意 sessionId 发送」的 RPC

- `SessionFace.prompt(content, mode: 'queue' | 'steer', signal?, requestId?)`
  （`contract/session.d.ts` 的 `SessionFace`，`sessions/session.d.ts`）挂在**单个 `Session` 对象**上，
  不是按 id 寻址的独立方法。
- 该 `Session` 对象只对「retained / 活动」会话存在：`sessions/service.d.ts` 的 `binding(id)` 对
  「无 retained generation」的会话返回 `undefined`；`sessionOf(ctx)` 对 untagged 或 ended 的生成也返回 `undefined`。

### 9.3 结论

- 同页切走后，被切走会话 A 若无 retained generation，`binding(A)` 即消失 → 插件**既读不到 A 的事件，
  也发不了 A 的 prompt**。客户端插件层没有跨会话通路。
- 宿主对**每个已启动回合的会话**自建 run loop 并自行接完（`MutableSessionEventSource` 由 manager 驱动、
  `Session.running` 状态），因此「被切走且正在跑」的会话宿主自会续完——**插件代发是伪需求**，硬做还会带来
  二次计费 / 与宿主自接续竞态的风险。
- **可正确承担的唯一插件边界即现状方案 A**：停在 retryable 终态（error / interrupted / max-tokens）且
  仍保留 binding 的**当前会话**。本节据此维持现状、不新增跨会话能力。

### 9.4 落地面：发射前用「绑定 Session 运行态」判定是否确有待续（知识内修订）

以下为**知识内**修订 —— 仅把 §9.3 已实证的边界落成**文档化**判据，不新增能力、不改 `ctx.get('sessions')`
契约、不改 `Session.prompt` 调用形态（仍是恒 `mode:"queue"` + 稳定 `requestId`，§5 第 7/8 条）。

**判定信号来源**：`sessions.binding(_sessionId)`（0.2.1-rc.5 客户端 `sessions` service 契约）返回的
`SessionBinding` 上挂有 `session` 字段，即 `Session` 对象；其可读运行态字段（`running`、`openState: OpenState`、
`pendingSubmissions: readonly PendingSubmission[]`、`awaitingFirstTurn`、`blank`、`removed`、`subagent`、
`lastAgentError`、`promptError` 等）为客户端 `sessions` service `max` 类型**精确镜像**，可同步读取。

**守卫语义（与 §5 第 9 条疑问句结尾同一模式：跳过本次、保持 armed）**：`_autoContinueEntry` 在发射
「继续」**之前**读取当前绑定 Session 的运行态 —— 仅当该会话此刻**确实正在运行且有未完成回合**时才补发；
否则**跳过本次发射、守卫保持 armed 待命**（`_publishAutoRetryView()` 后 return，不 disarm、不消耗连续预算、
不触发退出告警），避免机械地对已停 / 无未完成回合的会话每轮固定补发「继续」。

**为什么不用 ledger 作主判据**：`unsettledTurnsAt` / `openTurnAgeMs`（`unfinished-turn.js`）描述「已
`turn/start` 未见 `turn/end`」的未定夺残差，能作为「当前有进行中回合」的**互补**信号；但 auto-continue
发射点正处于 retryable `turn/end` 之后、该回合刚在 `noteClosedTurn`（FIFO）中关闭的瞬间，此刻 ledger 对该
会话已无开放残差 —— 若以 ledger 为主判据会把自动继续**永久拦截**。运行态才是主判据，ledger 仅作旁证。

**边界重申（承 §9.1–9.3）**：跨会话不代发。被切走的会话 A 若无 retained generation，`binding(A)` 为
`undefined`，插件既读不到其事件也发不了 prompt；宿主对每个已启动回合的会话自建 run loop 并自行接完
（`Session.running` 状态驱动），因此「被切走且正在跑」的会话无需插件代发，硬做反而引入二次计费 / 与宿主
自接续竞态。

---

*本文档为纯设计存档，不属于功能改动，不 bump 版本、不写 CHANGELOG。*
