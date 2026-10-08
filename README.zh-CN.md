# dsh-flash-ctx-mon

> 核心 [`dsh-flash`](https://github.com/tcgbp/dsh-flash) 的**上下文监控**配套插件 —— 它自己注册
> 告警提供者与面板开关，而不是住在核心的 `apply()` 里。

Apache-2.0

**[English](./README.md)**

## 它做什么

两个能力，分别落在插件的两半：

1. **上下文监控** —— 直接读取 DSH 会话事件流里已有的**精确** token 用量，把模型上下文窗口的
   压力按三档递进的阈值变成 `dsh-flash` 告警。
2. **会话技能芯片** —— 会话标题栏上的一枚芯片，列出**当前会话**真正加载过的技能，并用技能
   目录补全信息。

监控**默认开启**（只有显式关闭才会关掉），并且**完全在客户端**。

## 它注册了什么

### 宿主半 —— `src/index.ts` → `dist/index.js`

一个名为 `dsh-flash-ctx-mon` 的 Cordis 插件。

| 项目 | 说明 |
| --- | --- |
| 设置命名空间 | `dsh-flash-ctx-mon` |
| 字段 | `ctxApproxWindow`、`ctxThresholdInfo`、`ctxThresholdWarning`、`ctxThresholdError`、`ctxPollBase`、`ctxPollMin`、`modelContextWindows`、`modelContextWindowSources` |
| 路由 | **无** |
| 宿主侧服务 | **无**（`inject: []`） |

**宿主半存在的唯一目的是承载设置命名空间与它的 schema。** 没有采集器、没有路由，因为宿主侧
本来就无可采集：token 用量来自 DSH 会话事件（`ctx.get('sessions')`），模型目录来自
`remote.session.modelCatalog()`，技能目录来自 `remote.skills.list()` —— 全都在浏览器里。

### 浏览器半 —— `lib/client.js`（无构建步骤）

| 注册项 | 经由 |
| --- | --- |
| 告警提供者 `dsh-flash-ctx-mon:context-alert` | `ctx.get('dockFlashAlerts').registerProvider()` |
| 面板开关 `dsh-flash-ctx-mon:monitor-context` | `ctx.get('quickControl').registerSwitch()` |
| 会话标题芯片 `dsh-flash-ctx-mon-skills` | `ctx.inject(['slots'])` → `conversation.session.header.actions` |

开关属性：`type: 'toggle'`、`group: 'system'`、`cluster: 'system-alerts'`、`order: 59`、
`icon: 'message'`，外加一个**配置**按钮。它的可见性跟随 `dsh-flash` 的
`dock-flash:system-alerts` 总开关 —— 告警注册表关掉之后，这个开关没有东西可驱动。它故意
**不带 `subtitle`**：过去印在行上的 "模型 · 12%" 实时读数，现在就在「配置」按钮打开的
面板第一屏。

> **双路发现，外加兜底轮询。** `ctx.get('quickControl')` / `ctx.get('dockFlashAlerts')` 是
> 异步解析的，所以注册有三条路径：`dock-flash:ready` 事件（`dsh-flash` 比我们晚加载）、同步
> `ctx.get()` 检查（它比我们早加载）、以及最多 15 次、每次间隔 200 ms 的兜底轮询。先成功
> 的那个会置上 `_registered`，所以不会重复注册。

## 开关

在 `dsh-flash` 快捷面板的 **⚙️ 系统 → 系统告警** 下，找到 **上下文监控**：

- **关**：向 `localStorage['dsh-flash-ctx-mon:monitor-context']` 写入 `'0'`，并对告警注册表
  调用 `setProviderEnabled(…, false)`，提供者随之停止产出告警；
- **开**：两者一起恢复。

**谁说了算。** 浏览器里那个键是权威，且**键不存在即为开**（`getItem(key) !== '0'`）。宿主
侧的字段全部是 `volatile()`，每次重启 DSH 都会把它们重置为默认值 —— 记住你选择的是浏览器。

## 配置面板

开关旁的**配置**按钮打开上下文监控面板：

| 控件 | 范围 | 步长 | 默认 |
| --- | --- | --- | --- |
| 上下文窗口大小 `ctxApproxWindow` | 64000–512000 token | 8000 | 128000 |
| 信息阈值 `ctxThresholdInfo` | 30–80 % | 1 | 70 |
| 警告阈值 `ctxThresholdWarning` | 50–92 % | 1 | 85 |
| 错误阈值 `ctxThresholdError` | 70–98 % | 1 | 95 |
| 上下文轮询基础间隔 `ctxPollBase` | 5000–60000 ms | 1000 | 20000 |
| 上下文轮询最小间隔 `ctxPollMin` | 1000–10000 ms | 500 | 2000 |

滑块下方是实时状态：**当前模型**、**窗口大小**、**窗口来源**（会话事件 / 模型目录 / 错误
解析 / 手动配置 / 内置表 / 模糊匹配 / 估算默认）、**数据来源**（精确 / 等待数据）、
**输入Token** 与 **上下文压力**；此外还有**模型窗口映射**编辑器、**刷新目录**动作，以及
告警消息样式的预览。

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

`_resolveWindow(model)` 读取 `modelContextWindows` —— 设置命名空间里那张**用户映射**表 —— 并
用 `modelContextWindowSources` 给每个结果标上来源。表里没有的模型解析结果为 `null`，调用方
回退到 `ctxApproxWindow`（即「估算默认」来源）。

**内置窗口表已经退役。** `_KNOWN_WINDOWS` 为空，目录自动填充是一个有文档说明的空实现，所以
今天映射表是真实窗口大小的唯一来源 —— 这也正是「模型窗口映射」编辑器存在的意义：教会它某个
它算错的模型。

> 两个映射字段都是 `volatile()`，而这不代表它们是**临时**的。设置服务会拒绝任何不在 volatile
> 节点下的写入路径（`Config field "…" is not volatile`），所以 `modelContextWindows` 曾经因为
> 不是 volatile，导致面板写下的每一条映射都被宿主拒绝、被客户端回滚、然后丢失 —— 被映射过的
> 模型依旧回退到 `ctxApproxWindow`。volatile 是让写入合法的前提；值本身照旧落在 profile patch
> 里，重启后仍在。

## 轮询

监控按自适应间隔采样：`ctxPollBase` 是占比低时使用的**天花板**，占比越高间隔越密，但不会低于
`ctxPollMin`。精确模式下基础间隔会自动加倍，因为事件源是主动推送而不是被轮询。有技能被使用时
会立刻触发一次采样，好让它的提示在「新鲜」窗口内被认领。

## 技能芯片

会话标题栏上的一枚芯片，以 `dsh-flash-ctx-mon-skills`（order 15）注册进
`conversation.session.header.actions`。它列出**当前会话**加载过的技能 —— 子代理与其它会话被
排除在外，因为 slot 会把「它正在为哪个会话渲染」的 id 交给组件。

检测用的是 DSH 自己的标记：技能正文被加载时输出的 `<skill_content name="X">` 块。它从两条
路径到达 —— 模型调用 `skill` 工具，以及用户在输入框敲 `/name`（这条路径**不产生**工具调用）
—— 而失败的调用不带这个块，所以失败不会被计入。名字会用技能目录（`remote.skills.list()`）
解析，弹层显示调用次数、首次/最近使用时间与目录描述，并提供**在侧栏打开**。

该追踪器刻意**独立于监控开关**：上下文监控关掉之后，芯片照常工作。

## 设置项

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `ctxApproxWindow` | 128000 | 映射表不认识的模型所用的回退窗口 |
| `ctxThresholdInfo` | 70 | 占窗口百分比 |
| `ctxThresholdWarning` | 85 | % —— 必须大于信息阈值 |
| `ctxThresholdError` | 95 | % —— 必须大于警告阈值 |
| `ctxPollBase` | 20000 | ms，占比低时的天花板 |
| `ctxPollMin` | 2000 | ms，地板 |
| `modelContextWindows` | `{}` | 模型 id → 窗口大小 |
| `modelContextWindowSources` | `{}` | 模型 id → 来源标记 |

## 依赖

| 包 | 类型 | 用途 |
| --- | --- | --- |
| `@deepseek-ai/cordis` | peer | 插件框架 |
| `dsh-flash` `>=1.0.0-0 <2.0.0-0` | peer | 提供 `quickControl`、`dockFlashAlerts` 服务与 `dock-flash:ready` 事件 |
| `dock-base` `>=0.1.2-0 <1.0.0-0 \|\| >=0.2.0-0 <1.0.0-0` | peer，可选 | 仅 workbench 模式 |
| `@deepseek-ai/schemastery` | dependency | 设置 schema（`volatile()`） |

对核心 `dsh-flash` **没有硬依赖**：所有服务都通过 `ctx.get(...)` 解析，兼容性由 **peer 范围**声明
—— 与 `dock-flash` v3 适配器对 dock-base 的写法同形。`>=1.0.0-0 <2.0.0-0` 覆盖的正是含预发布的
1.x 线。

## 安装

```sh
dsh plugin --profile <profile> add dsh-flash-ctx-mon
```

需要 **`dsh-flash` ≥ 1.0**：它提供 `quickControl`、`dockFlashAlerts` 服务与 `dock-flash:ready` 事件，1.x 线都满足。安装后请重启 DSH。

`cordis.patch.yml` 负责插入宿主行。它的 `name` 是**包名**，经 profile 的 `node_modules`
解析 —— **绝不是相对路径**。

浏览器半不需要任何行：模块加载器从 `package.json` 的 `exports["./client"]` 配合 `dsh.client`
发现它，并在 `/plugins/dsh-flash-ctx-mon/client.js` 提供。

## 构建

```sh
pnpm install
pnpm run build       # tsc → dist/index.js   （仅宿主半）
pnpm run typecheck
node scripts/verify-config-volatile.mjs ./dist/index.js
```

`dist/index.js` 是**有意纳入版本控制**的，理由与 `dsh-flash` 相同：git 安装只取源码、不跑任何
构建脚本，所以没有 `dist/` 的仓库会缺少 `main` 与 `exports["."]` 指向的宿主入口。
`lib/client.js` 是单文件直接编辑，无构建步骤，刷新页面即生效。

`scripts/verify-config-volatile.mjs` 会加载构建好的宿主半，并对它重跑设置服务自己的
volatile 路径检查 —— 也就是那两个映射字段必须满足的不变量，不满足则每次写入都会被拒绝。

## 目录结构

```
src/index.ts      HOST half      → tsc → dist/index.js
lib/client.js     BROWSER half   → no build, edited directly
dist/index.js     compiled host half — tracked on purpose
cordis.patch.yml  bundle layer: inserts the host row into the profile
scripts/          verify-config-volatile.mjs — the volatile-schema check
.github/workflows/sync-from-gitee.yml — the Gitee → GitHub mirror
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
