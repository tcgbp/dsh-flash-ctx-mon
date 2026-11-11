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
4. **自身回显识别**（按 §8.4 实证修订）：`sessions.prompt` 发出的消息实际落成 **`user-rpc` source、其
   `kind === "user"`**（`@deepseek-ai/dsh-llm` 的 `MessageSourceMap` 增补，`dsh-api-session-controller` 的
   `types.d.ts` L388–402），故按 `source.kind === "user"` 判定**依然成立**；判定精确化为「`source.kind === "user"`
   且（当 source 带 `rpcId` 时）`rpcId === 本次自动继续的 requestId`，且 `text == continueText` 并在
   `echoWindowMs` 窗口内收到」——**否则自己发的「继续」会欺骗连续计数与人工检测；且不比对 `rpcId` 时，
   用户恰好输入相同文本会被误判为回显**。
5. **人工输入即退出**：检测到不匹配第 4 条回显判定的人工输入 → 清零并退出重试循环。
6. 一次只排一个定时器，不叠加。
7. **固定投递模式 `"queue"`**（新增，实证见 §8.4）：`session/prompt` 契约支持 `mode: "queue" | "steer"`
   （`SessionPromptRequest`，`types.d.ts` L332–340；客户端绑定面 `Session.prompt(content, mode, signal?, requestId?)`，
   `client/sessions/session.d.ts` L144）；自动继续恒用 **`"queue"`**（追加），避免 steer 的插队/编辑语义。
8. **幂等重发**（新增，实证见 §8.4）：自动继续发送**稳定 `requestId`**（per-session + attempt token，客户端自签）；
   host 对已进入 queue/日志的 `requestId` 直接返回原接受结果、不重复插入（README L34）——网络重发天然去重。

---

## 6. 落地映射

| 半 | 文件 | 改动 |
| --- | --- | --- |
| 宿主 | `src/index.ts` | `dsh-flash-ctx-mon` 命名空间新增一组 `volatile()` 字段：`autoRetryGraceMs`(5000)、`autoRetryCooldownMs`(20000)、`autoRetryMaxConsecutive`(4)、`autoRetryMaxBackoffMs`(300000)、`autoRetryContinueText`("继续")、`autoRetryEchoWindowMs`(30000)。**不写进核心 `dsh-flash` 命名空间。** |
| 浏览器 | `src-client/factory-body.js` | ① `SessionEventTokenSource._processEntries`：`turn/end` 的 reason 判定从仅 `error` 扩到 `{error, interrupted, max-tokens}`，把终止原因交给 AutoRetry 状态机；② 新增 `AutoRetryRunner`（会话级去重/宽限/退避/上限/回显/人工退出/**固定 `queue` 模式/稳定 `requestId` 幂等**，有状态逻辑**内联**在 `factory-body.js`）；③ 新增常驻独立弹窗（含「自动继续」「停止」＋状态行）；④ **落地面 L17**：`sessions.binding(id).eventSource` 只绑定当前 GUI 会话，随当前绑定/`Session` 对象替换（重连、重命名）跟随，prompt 恒发往当前绑定 id；⑤ **L16 空目录**：模型上下文窗口表消费 `remote.session.modelCatalog()` 时处理空 `_modelCatalog.groups`，回退 `ctxApproxWindow`。 |
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
| **L16 deepseek-model-discovery** | **直接相关** | ctx-mon 模型上下文窗口表消费 `remote.session.modelCatalog()`；deepseek-official 在无 key 时返回**空目录**（无 key）→ 消费者必须处理空 `_modelCatalog.groups`，ctx-mon 已有 `ctxApproxWindow` 回退；需配置 key 或 `apiKeyEnv`（默认 `DEEPSEEK_API_KEY`）。**自动继续本体不依赖 modelCatalog**——只依赖 `turn/end` 事件与 `session.prompt` RPC，二者已在 0.2.1-rc.5 实证存在 |
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

*本文档为纯设计存档，不属于功能改动，不 bump 版本、不写 CHANGELOG。*
