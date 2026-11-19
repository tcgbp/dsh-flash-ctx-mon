# dsh-flash-ctx-mon

> 核心 [`dsh-flash`](https://github.com/tcgbp/dsh-flash) 的**上下文监控**配套插件 —— 它自己注册
> 告警提供者与面板开关，而不是住在核心的 `apply()` 里。

Apache-2.0

**[English](./README.md)**

## 它做什么

两个能力，分别落在插件的两半：

1. **上下文监控** —— 直接读取 DSH 会话事件流里已有的**精确** token 用量，把模型上下文窗口的
   压力按三档递进的阈值变成 `dsh-flash` 告警。
2. **会话技能芯片** —— 会话标签栏上的一枚芯片，列出**当前会话**真正加载过的技能，并用技能
   目录补全信息。

监控**默认开启**（只有显式关闭才会关掉），并且**完全在客户端**。

## 它注册了什么

### 宿主半 —— `src/index.ts` → `dist/index.js`

一个名为 `dsh-flash-ctx-mon` 的 Cordis 插件。

| 项目 | 说明 |
| --- | --- |
| 设置命名空间 | `dsh-flash-ctx-mon` |
| 字段 | `ctxApproxWindow`、`ctxThresholdInfo`、`ctxThresholdWarning`、`ctxThresholdError`、`ctxPollBase`、`ctxPollMin` |
| 路由 | **无** |
| 宿主侧服务 | **无**（`inject: []`） |

**宿主半存在的唯一目的是承载设置命名空间与它的 schema。** 没有采集器、没有路由，因为宿主侧
本来就无可采集：token 用量来自 DSH 会话事件（`ctx.get('sessions')`），模型目录来自
`remote.session.modelCatalog()`，技能目录来自 `remote.skills.list()` —— 全都在浏览器里。

### 浏览器半 —— `src-client/` → `lib/client.js`（esbuild 打包）

| 注册项 | 经由 |
| --- | --- |
| 告警提供者 `dsh-flash-ctx-mon:context-alert` | `ctx.get('dshFlashAlerts').registerProvider()` |
| 面板开关 `dsh-flash-ctx-mon:monitor-context` | `ctx.get('quickControl').registerSwitch()` |
| 会话技能芯片 `dsh-flash-ctx-mon-skills` | `ctx.inject(['slots'])` → `conversation.session.header.actions`，实际渲染在会话标签栏上 |

开关属性：`type: 'toggle'`、`group: 'system'`、`cluster: 'system-alerts'`、`order: 59`、
`icon: 'message'`，外加一个**配置**按钮。它的可见性跟随 `dsh-flash` 的
`dsh-flash:system-alerts` 总开关 —— 告警注册表关掉之后，这个开关没有东西可驱动。它故意
**不带 `subtitle`**：过去印在行上的 "模型 · 12%" 实时读数，现在就在「配置」按钮打开的
面板第一屏。

> **双路发现，外加兜底轮询。** `ctx.get('quickControl')` / `ctx.get('dshFlashAlerts')` 是
> 异步解析的，所以注册有三条路径：`dsh-flash:ready` 事件（`dsh-flash` 比我们晚加载）、同步
> `ctx.get()` 检查（它比我们早加载）、以及最多 15 次、每次间隔 200 ms 的兜底轮询。先成功
> 的那个会置上 `_registered`，所以不会重复注册。

## 开关

在 `dsh-flash` 快捷面板的 **⚙️ 系统 → 系统告警** 下，找到 **上下文监控**：

- **关**：向 `localStorage['dsh-flash-ctx-mon:monitor-context']` 写入 `'0'`，并对告警注册表
  调用 `setProviderEnabled(…, false)`，提供者随之停止产出告警；
- **开**：两者一起恢复。

**谁说了算。** 浏览器里那个键是权威，且**键不存在即为开**（`getItem(key) !== '0'`）。宿主
侧的字段全部是 `volatile()`，每次重启 DSH 都会把它们重置为默认值 —— 记住你选择的是浏览器。

**弹窗通知**（Toast）开关正下方的一行开关是 **自动继续**（`dsh-flash-ctx-mon:auto-continue`，单色 **scroll** 图标）—— 用作当前会话自动继续的一键开关：**开** = 为当前会话武装自动继续
（`armAutoRetry()`），**关** = 停止当前会话的自动继续（`disarmAutoRetry()`）。它随 **⚙️ 系统 → 系统告警** 总开关显隐：总开关关闭时这一行与上下文监控一样整行隐藏，重新打开后随即出现。
它**不**按「只在自动继续运行时才显示」门控，所以即使处于已停止状态、只要总开关打开就能随时开关；开关选中状态实时反映当前会话的 armed / scheduled / paused。该行**没有 ⚙ 配置按钮**（那是上下文监控行专属）。图标必须是 dsh-flash
`_ICON_PATHS` 里已知的名字 —— `'refresh'` 不在其中，`_switchIcon` 会把它的字面量当文本渲染，
故采用受支持的名字。

## 配置面板

开关旁的**配置**按钮打开上下文监控面板：

| 控件 | 范围 | 步长 | 默认 |
| --- | --- | --- | --- |
| 上下文窗口大小 `ctxApproxWindow` | 32768–1048576 token | 32768 | 128000 |
| 信息阈值 `ctxThresholdInfo` | 30–80 % | 1 | 70 |
| 警告阈值 `ctxThresholdWarning` | 50–92 % | 1 | 85 |
| 错误阈值 `ctxThresholdError` | 70–98 % | 1 | 95 |
| 上下文轮询基础间隔 `ctxPollBase` | 5000–60000 ms | 1000 | 20000 |
| 上下文轮询最小间隔 `ctxPollMin` | 1000–10000 ms | 500 | 2000 |

面板提供配置滑块（上下文阈值、轮询间隔、兜底窗口大小）、自动继续调节区块，以及可折叠的告警消息
样式预览。窗口只读时解析、绝不持久化，也没有独立的「数据来源」折叠区或内存条。当适配器的
请求/上下文窗口与 llm-pi-ai 用户配置窗口不一致时，面板会显式弹出一条**窗口不一致告警**解释差异。

## 告警

仅在 token 来源为 `precise` 时产出；没有会话事件用量数据时，监控显示「等待数据」并且
**什么都不发** —— 它不会拿消息条数去猜。

| 级别 | 触发 | 标题 |
| --- | --- | --- |
| ℹ️ 信息 | ≥ `ctxThresholdInfo`（70 %） | 会话上下文较长 |
| 🟡 警告 | ≥ `ctxThresholdWarning`（85 %） | 会话上下文即将用尽 |
| 🔴 错误 | ≥ `ctxThresholdError`（95 %） | 会话上下文几乎用尽 |

每条消息都带上百分比与它所依据的读数 —— 精确模式下形如 `模型 · 12.4K/128K`。告警是
`dismissible` 的，并且走 `dsh-flash` 的注册表，所以它们和其它告警一样出现在面板告警列表与
弹窗通知里。

## 模型窗口是怎么解析出来的

上下文窗口是**读时权威、且本插件绝不持久化**的 —— ctx-mon 本身不持有任何模型映射偏好。解析按
如下顺序进行（`_resolveWindow` / `getTokenEstimate`）：

1. **llm-pi-ai 模型配置** —— 已注册模型在 `@deepseek-ai/dsh-llm-pi-ai` 命名空间里的
   `contextWindow`（`providers.<pid>.models[].contextWindow`）是权威的用户配置窗口，标记为
   `CWS_USER_MAPPING`，`windowConfirmed: true`。
2. **请求/上下文窗口** —— 否则采用 DSH 适配器在 request/context 事件上报告的窗口并缓存
   （`CWS_REQUEST_CONTEXT`，`windowConfirmed: true`）。
3. **估算默认** —— 都没有权威来源时用 `ctxApproxWindow` 兜底（`CWS_APPROX_DEFAULT`，
   `windowConfirmed: false`），它**绝不**被用来判压力。

**旧的「模型窗口映射」编辑器以及 `modelContextWindows` / `modelContextWindowSources` 这两个持久化
映射字段已经移除。** 不再有面向用户的映射表；要修正窗口，请直接编辑 `dsh-llm-pi-ai` 配置里该
模型的 `contextWindow`。

**显式不一致告警** —— 当适配器的请求/上下文窗口与同一模型的 llm-pi-ai 用户配置窗口不一致时，面板
会弹出一条专门的告警解释差异，而不是静默取其一 —— 错误的假设永远不会被悄悄掩盖。

## 轮询

监控按自适应间隔采样：`ctxPollBase` 是占比低时使用的**天花板**，占比越高间隔越密，但不会低于
`ctxPollMin`。精确模式下基础间隔会自动加倍，因为事件源是主动推送而不是被轮询。有技能被使用时
会立刻触发一次采样，好让它的提示在「新鲜」窗口内被认领。

## 技能芯片

芯片画在会话的**标签栏**上，紧跟在最后一个会话标签之后。标签栏上没有会话 id ——
`data-conversation-session` 只标在会话正文上 —— 所以保证「每会话各归其位」的正是标题栏那枚
芯片：它仍以 `dsh-flash-ctx-mon-skills`（order 15）注册进
`conversation.session.header.actions`，渲染一个携带 slot 交给它的会话 id 的隐藏锚点，从该锚点
向上找到「恰好只含一个标签栏」的最近祖先，再把可见芯片挂到那里。若某个祖先里出现多于一个
标签栏，说明牵涉到另一个会话，芯片就留在标题栏；只有一个会话视图的会话根本没有标签栏，芯片
也会像以前一样留在标题栏。标签栏被重建、或又追加了标签时，由 `MutationObserver` 重新摆位。

它列出**当前会话**加载过的技能 —— 子代理与其它会话被
排除在外，因为 slot 会把「它正在为哪个会话渲染」的 id 交给组件。

检测用的是 DSH 自己的标记：技能正文被加载时输出的 `<skill_content name="X">` 块。它从两条
路径到达 —— 模型调用 `skill` 工具，以及用户在输入框敲 `/name`（这条路径**不产生**工具调用）
—— 而失败的调用不带这个块，所以失败不会被计入。名字会用技能目录（`remote.skills.list()`）
解析，弹层显示调用次数、首次/最近使用时间与目录描述，并提供**在侧栏打开**。

该追踪器刻意**独立于监控开关**：上下文监控关掉之后，芯片照常工作。

## 自动继续

在一个**未武装**的会话里，当你手动发送一条**裸的继续词**（`继续` / `continue` / `cont` / `resume` / `res`，整条消息就是这个词，不附带其它话），**自动继续模式会直接打开** —— 不再弹出询问确认弹窗：你主动输入继续词本身就是明确的开通动作。常驻指示器会立刻反映已武装的状态。

武装之后，守卫会在回合以「可重试」的判据结束时（默认等 `autoRetryGraceMs` 宽限，随后按 `autoRetryCooldownMs` 冷却与指数退避）自动补发一条「继续」，最多 `autoRetryMaxConsecutive` 次。「可重试」是**叠加判据**：只要命中其一即触发 —— ① `turn/end` 原因属于 `error` / `interrupted` / `max-tokens`；② 该回合最后一条助手输出**以「让我 / 让我来 / let me」开头**（前缀匹配，忽略前导空白与大小写）却再无后续动作 —— 多数编码/执行任务里「让我检查日志 / Let me look at the tests」这类结尾往往意味着模型只承诺了下一步而未真正完成。**自动继续是按会话记账的** —— 守卫记录绑定在当初发出「继续」的那个会话上，切换会话后新会话从「已停止」重新开始。

### 什么情况下会自动关闭 / 暂停

自动继续的解除分两档：**彻底关闭（disarmed）** 与 **暂停等人工（paused）**。

检测到**人工输入不再作为退出条件** —— 守卫待命期间收到一条不是自动「继续」回显的人类消息，守卫**保持武装**、不消耗连续预算，下一次可重试的 `turn/end` 照常自动补发「继续」。

**回合正常收尾也不再解除守卫**：`turn/end` 既不属于 `error` / `interrupted` / `max-tokens`，最后一条助手输出也不以「让我 / 让我来 / let me」开头（即不是交接桩）时——既然回合已自行跑完，就无需再补发，守卫**保持武装、继续待命**；只有当你**主动**按下停止才会彻底关闭。**未武装**的会话正常收尾则维持未武装（不会被被动武装）——继续词的入口仍然只在你想开的时候手动打开。

**模型最后一段输出是在提问时，自动继续会停下来等你的回答**：当某回合最后一条助手文字含问号（`?` 或 `？`）时，模型显然在等你的回复——于是本回合**只跳过这一次**自动补发「继续」，停下来等你的输入，而不会把「继续」抢在你的回答之前排进去。守卫**保持武装**；等你回答、下一次 `turn/end` 触发时，自动继续会按常规规则恢复正常。这不会消耗连续预算，也不会弹出退出告警。

会**彻底关闭**的情况：

1. **面板手动停止** —— 点「停止自动继续」。
2. **自动补发无法执行** —— 解析不到可 prompt 的会话、继续文本为空、或 `prompt` 注入失败（宁可站下，也不空转）。
3. **宿主拒绝排队的补发 prompt** —— 自动补发在**乐观记入后**被宿主异步拒绝（`ok: false` 或 RPC 抛错，如 `session/not-found` / `session/agent-busy` / `session/writer-held` / `gateway/*`），则守卫**彻底关闭并弹告警**——「已变绿却始终没收到「继续」」这种情况不再默默吞掉。

会**暂停（而非彻底关闭）**的情况：

3. **连续补发达上限仍未完成** —— 达到 `autoRetryMaxConsecutive`（默认 4）次后冻结为 `paused`（红色实心状态），等你人工介入。它保持挂起，**直到你显式选择重新开启**：再次把快捷面板的「自动继续」开关拨到开、或点击**图标右下角那个只在暂停时出现的小 ↻ 重新开启按钮**、或再发一条裸继续词，都会**重新武装**——预算重新播种为新的 `autoRetryMaxConsecutive`，状态环回到待命绿色。被挂起的会话**不会自己复活**，只有你再次选择开启才会。人工介入的消息会从 `paused` 恢复待命，但不会关闭守卫、也不消耗连续预算。

注意：armed 期间若处于**冷却窗口**（`autoRetryCooldownMs` 内）或**已排程**（宽限/退避倒计时中），是**保持待命**只是不发，不算关闭。

有两种「无人操作却自动站下」的情况会各弹一条 🔁 `info` 告警，说明退出原因，并在末尾附上**定位信息** `（会话 <session-id>，工作区 <cwd>）`，其中 prompt 被拒还会追加宿主的拒绝详情：**连续补发达上限而暂停**（`paused`，挂起等你）与**宿主拒绝自动补发 prompt**（→ 彻底关闭，终结「默默变绿却没收到「继续」」）。**手动点「停止自动继续」**是你自己的显式动作，能明确感知，因此不再弹退出告警（关闭动作本身照常生效）。

## 设置项

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `ctxApproxWindow` | 128000 | 无权威来源（llm-pi-ai / 请求-上下文）时的回退窗口，绝不据此判压力 |
| `ctxThresholdInfo` | 70 | 占窗口百分比 |
| `ctxThresholdWarning` | 85 | % —— 必须大于信息阈值 |
| `ctxThresholdError` | 95 | % —— 必须大于警告阈值 |
| `ctxPollBase` | 20000 | ms，占比低时的天花板 |
| `ctxPollMin` | 2000 | ms，地板 |
| `autoRetryGraceMs` | 5000 | 回合异常结束后等多久才自动补发「继续」（建议 3–8 秒） |
| `autoRetryCooldownMs` | 20000 | 同一会话两次自动补发的最大频率（间隔上限），防连发烧钱 |
| `autoRetryMaxConsecutive` | 4 | 连续补达此次数仍未完成即暂停，等人工介入 |
| `autoRetryMaxBackoffMs` | 300000 | 指数退避上限：连续失败越久间隔越长，但不超过此值 |
| `autoRetryContinueText` | `继续` | 自动补发的消息内容，连同请求 id 用于识别自身回显，请保持默认 |
| `autoRetryEchoWindowMs` | 30000 | 发「继续」后该窗口内收到的同名消息视为自身回显，不计为人工输入 |

## 依赖

| 包 | 类型 | 用途 |
| --- | --- | --- |
| `@deepseek-ai/cordis` | peer | 插件框架 |
| `dsh-flash` `>=1.0.0-0 <2.0.0-0` | peer | 提供 `quickControl`、`dshFlashAlerts` 服务与 `dsh-flash:ready` 事件 |
| `dock-base` `>=0.1.2-0 <1.0.0-0 \|\| >=0.2.0-0 <1.0.0-0` | peer，可选 | 仅 workbench 模式 |
| `@deepseek-ai/schemastery` | dependency | 设置 schema（`volatile()`） |

对核心 `dsh-flash` **没有硬依赖**：所有服务都通过 `ctx.get(...)` 解析，兼容性由 **peer 范围**声明
—— 与 `dock-flash` v3 适配器对 dock-base 的写法同形。`>=1.0.0-0 <2.0.0-0` 覆盖的正是含预发布的
1.x 线。

## 安装

```sh
dsh plugin --profile <profile> add dsh-flash-ctx-mon
```

需要 **`dsh-flash` ≥ 1.0**：它提供 `quickControl`、`dshFlashAlerts` 服务与 `dsh-flash:ready` 事件，1.x 线都满足。安装后请重启 DSH。

`cordis.patch.yml` 负责插入宿主行。它的 `name` 是**包名**，经 profile 的 `node_modules`
解析 —— **绝不是相对路径**。

浏览器半不需要任何行：模块加载器从 `package.json` 的 `exports["./client"]` 配合 `dsh.client`
发现它，并在 `/plugins/dsh-flash-ctx-mon/client.js` 提供。

## 构建

```sh
pnpm install
pnpm run build       # tsc → dist/index.js  +  esbuild → lib/client.js
pnpm test            # Vitest：src-client 纯逻辑单元测试
pnpm run typecheck
node scripts/verify-config-volatile.mjs ./dist/index.js
```

`dist/index.js` 是**有意纳入版本控制**的，理由与 `dsh-flash` 相同：git 安装只取源码、不跑任何
构建脚本，所以没有 `dist/` 的仓库会缺少 `main` 与 `exports["."]` 指向的宿主入口。
`lib/client.js` 也**有意纳入版本控制**（浏览器半以预构建产物随附）：模块加载器要求一个单文件
`window.__ModuleLoader__.load(...)` 产物，而加载器的 `require` 在运行时解析 `react`/`react-dom`，
所以它们保持 external。它的源码在 `src-client/` 下，用 esbuild 打包：

```sh
pnpm run build:client   # src-client/index.js → lib/client.js
```

`build:client` 已并入 `pnpm run build`。纯逻辑（`tokens`、`skill-detect`、`ctx-window`）被拆分到
`src-client/*.js` 模块，用 Vitest（`pnpm test`）做单元测试，并与产物真正共享；有状态的浏览器半
逻辑（偏好、token 来源、技能追踪器、提供者、i18n）刻意留在 `factory-body.js` 内联，因为它们与
该闭包的私有会话事件状态耦合。

`scripts/verify-config-volatile.mjs` 会加载构建好的宿主半，并对它重跑设置服务自己的
volatile 路径检查 —— 也就是那两个映射字段必须满足的不变量，不满足则每次写入都会被拒绝。

## 目录结构

```
src/index.ts          HOST half      → tsc → dist/index.js
src-client/index.js   浏览器半源码入口 → esbuild → lib/client.js
src-client/*.js       纯逻辑模块（tokens、skill-detect、ctx-window）—— 单元测试
lib/client.js         compiled browser half — tracked on purpose
dist/index.js         compiled host half — tracked on purpose
test/                 Vitest：各纯逻辑模块的单元测试
cordis.patch.yml      bundle layer: inserts the host row into the profile
scripts/              build-client.mjs — 面板的 esbuild 打包步骤
scripts/              verify-config-volatile.mjs — volatile-schema 检查
.github/workflows/sync-from-gitee.yml — Gitee → GitHub 镜像
```

Gitee 是权威仓库；GitHub（`github.com/tcgbp/dsh-flash-ctx-mon`）是它的镜像，也是发布用
tarball 的托管处。

## 隐私与边界（有意为之）

- **不出本机。** 监控只读 DSH 自己的会话事件与两个客户端 remote；它没有宿主路由、没有采集器、
  也没有任何对外请求。
- **精确，否则不发。** 没有会话事件用量数据时显示「等待数据」且不发告警，而不是拿消息条数
  估算。
- **技能仅限本会话。** 芯片只统计当前会话；子代理会话与其它对话排除在外。已不再保留的会话
  会显示「技能目录读取失败」并给出重试。
- **有界追踪。** 每个会话最多追踪 200 个技能（防御性上限）；只有当某次使用发生在最近 15 秒内
  时才会发出提示，所以重放一个会话的历史不会一次爆出一串提示。
- **界面语言**：面板与告警文案同时提供中英文，并跟随 DSH 的语言设置。
