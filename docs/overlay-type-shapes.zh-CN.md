# 跨文件浮层组件可复用的类型形状参考（`factory-body.js` 浮层样式体系通读）

> 状态：**文档定稿（存档）** · 通读交付物（只读，未改动任何功能代码）。
>
> 目的：把 `src-client/factory-body.js` 的浮层（overlay / modal）样式体系与整体实现整理成一份
> **跨文件可复用的默认类型形状参考**，作为后续新增浮层组件（auto-retry 弹窗、monitor 配置弹窗、skills
> 面板/弹窗等）的统一类型与常量来源，避免各组件各自为政地硬编码样式与结构。
>
> 依据源码（本次通读核实到的准确行号）：
> - [src-client/factory-body.js](src-client/factory-body.js)（4259 行通读；浮层相关 region 集中于 L865-2672：
>   SessionEventTokenSource → SessionSkillTracker → AlertProvider → ErrorBoundary → Styles，组件与宿主逻辑见 §4、§6）
> - [src-client/auto-retry.js](src-client/auto-retry.js)（166 行纯模块，自动继续判定原语）
> - [src-client/tokens.js](src-client/tokens.js)（令牌/窗口推定原语，纯模块）
> - 设计文档：[docs/auto-retry-integration-design.zh-CN.md](docs/auto-retry-integration-design.zh-CN.md)

---

## 1. 一句话结论（跨文件约束）

`factory-body.js` 经由单 esbuild 打包入口 `src-client/index.js`（仅 `import './factory-body.js'`）产出
`lib/client.js`（运行时 `/plugins/dsh-flash-ctx-mon/client.js`），**全插件共用同一个打包闭包**。

因此：

- 浮层样式常量（`R`/`E`/`S`，定义于 factory-body.js L2318-2330 同一闭包内）**无法被跨文件模块 `import`**，
  只能被「同闭包内的组件」直接引用，或由入口模块显式传递给跨文件组件。
- 渲染环境为 `h()`（=`React.createElement`）+ 显式 `key:`；hooks 与 class Component（仅 `PanelErrorBoundary`，
  L2270 定义）；可选的 `ReactDOMClient`（`createRoot`）用于向 `document.body`/宿主节点挂载独立面板。
- 跨文件可复用组件（如新增 auto-retry 弹窗、复用 overlay 形状的扩展面板）**必须**通过参数从入口闭包接收
  R/E/S 样式常量与公开方法，而不能自己再 `import` 一份。

---

## 2. 样式体系（可复用形状 R/S/E）

浮层相关样式集中定义于 **`//#region Styles`（L2316-2672）**，由三个常量构成：圆角组 `R`（L2318-2325）、
阴影组 `E`（L2326-2328）、本地样式对象 `S`（L2330-2668），全部处于单 esbuild 打包闭包内（§1）。

**① 圆角组 `R`（L2318-2325）** —— 六个档位，全部是「CSS 变量 + 后备值」字符串：

| 键 | 值 |
|----|----|
| `R.xs` | `var(--dsw-radius-xs, 4px)` |
| `R.sm` | `var(--dsw-radius-sm, 8px)` |
| `R.md` | `var(--dsw-radius-md, 12px)` |
| `R.lg` | `var(--dsw-radius-lg, 16px)` |
| `R.xl` | `var(--dsw-radius-xl, 20px)` |
| `R.panel` | `var(--dsw-radius-panel, 28px)` |

**② 阴影组 `E`（L2326-2328）** —— 目前仅 `E.prominent` 一项：CSS 变量 + 三层后备
（0.5px 描边 + 8px 弥散 + 20px 弥散），`boxShadow` 用。

**③ 对象 `S`（L2330-2668）** —— 浮层可视面的唯一真源，按用途分组（新增样式往里加，勿另起色板）：

| 键 | 用途 |
|----|------|
| `paramGrid`/`paramCell`/`paramLabel`/`paramHint`/`switchIcon`/`sliderRow`/`slider`/`value` | MonitorConfigModal 参数网格（两列 label 在上、slider 在下的单元格） |
| `autoRetryTextInput` | 自动继续触发词输入框（`R.sm`、0.5px 边框、`--dsw-alias-bg-layer-1`） |
| `monitorModalMask`/`monitorModal`/`monitorModalHead`/`monitorModalTitle`/`monitorModalClose` | 配置弹窗骨架（mask 全屏 `zIndex:2200`；容器 `R.panel` + `E.prominent` 阴影，90vw/680px/80vh 限制） |
| `monitorModalBody`/`monitorModalDivider`/`monitorModalSectionTitle` | 弹窗主体滚动区（flex 1 + overflow-y auto + 细滚动条）、分区分隔线、分节标题 |
| `alertPreviewToggle`/`sectionFoldToggle` | 折叠开关（同式：无背景、无边框、次级色小字） |
| `skillsSectionTitle`/`skillsLeadCard` | skills 段标题 + 段头引导卡（品牌色左缘 2px rail） |
| `alertPreviewCard`/`alertPreviewGroup`/`alertPreviewRow`/`alertPreviewIcon`/`alertPreviewMsg`/`alertPreviewCond` | 上下文警报预览卡片（行 = 图标 + 信息 + 条件，次级色弱化） |
| `memColumnCard`/`memSubSectionLabel`/`memLiveDataGrid`/`memLiveDataLabel`/`memLiveDataValue`/`memUsageBarTrack`/`memUsageBarFill` | 上下文实时数据段（两列网格 + 4px 用量条，`width`/`background` 均 0.3s ease 过渡） |
| `tabPageChevron`/`tabPageChevronOpen` | tab 页折叠指示（8px chevron，展开旋转 90°） |
| `skillChip`/`skillChipIcon` | header 胶囊词条（`borderRadius:999px`、240px 上限、省略号） |
| `skillRow`/`skillRowHead`/`skillName`/`skillBadge`/`skillMeta`/`skillDesc`/`skillPathRow`/`skillPath`/`skillOpenBtn` | 弹窗内 skills 明细行（等宽 skill 名、药丸徽章、rtl 首页路径、打开按钮 `R.xs`） |

> 额外：`ModelWindowMapEditor` 内局部 `srcBadgeColors`（L2708-2716）给窗口来源打色标，覆盖
> `CWS_REQUEST_CONTEXT`/`CWS_CATALOG_AUTO`/`CWS_CATALOG_UNKNOWN`/`CWS_ERROR_EXTRACTED`/`CWS_USER_MAPPING`/
> `CWS_BUILTIN_TABLE`/`CWS_FUZZY_MATCH`/`CWS_APPROX_DEFAULT` 八种 tag。
> auto-retry runner 弹窗的状态色另存于 **L3119-3123**（`stopped #868e96` / `armed #2f9e44` /
> `scheduled #e8590c` / `paused #e03131`），与 `S` 定义分离。

### 2.1 弹窗/面板通用形状（Modal 骨架，用 `S.monitorModal*`）

所有监控面板（monitor-config、auto-retry、skills 弹窗）共用同一套骨架，真实值如下
（monitorModalMask L2393-2401、monitorModal L2402-2413、头部 L2414-2420、标题 L2421-2426、
关闭 L2427-2440、主体 L2441-2447）：

| 部件 | 形状（含后备值） |
|------|------------------|
| 遮罩 `monitorModalMask` | `position:fixed; inset:0; zIndex:2200`，背景 `--dsw-alias-bg-mask-1`（#0000003d），flex 居中 |
| 容器 `monitorModal` | `background:--dsw-alias-bg-layer-2`（#fff），**`border:0`**、`borderRadius:R.panel`、`boxShadow:E.prominent`，`90vw/680px/80vh` 上限，flex 纵向、`overflow:hidden` |
| 头部 `monitorModalHead` | flex 两端对齐，`padding:10px 14px`，下缘 0.5px 分隔线 |
| 标题 `monitorModalTitle` | 500 字重 / 16px / 24px 行高，`--dsw-alias-label-primary`（#000） |
| 关闭 `monitorModalClose` | 28×28 图标按钮，`border:0`、`borderRadius:R.sm`、透明底、次级色，`cursor:pointer` |
| 主体 `monitorModalBody` | `flex:1` + `overflowY:auto` + `padding:10px 14px`，细滚动条（`scrollbarWidth:thin`） |

> 注意：`R` 只有圆角档位，**不存在 `R.border`/`R.bg`/`R.text`/`R.title`**；底色用 `--dsw-alias-bg-layer-2`、
> 边框用 0.5px `--dsw-alias-border-l2`、正文与标题用 `--dsw-alias-label-primary/-secondary`——不要把
> 这些 CSS 变量错写成 `R.*`。

monitor modal 主体的区块顺序**固定**（L3417-3419 附近核实）：`skillSectionEl（lead skills 卡）→ 字段区 →
autoRetryEl → alertPreviewEl → ctxLiveDataEl`。

### 2.2 渲染契约

- `h()`：`React.createElement`；列表一律显式 `key:`。
- ErrorBoundary（`PanelErrorBoundary`，class Component）包裹每个独立面板，失败时降级显示错误卡片而非整页崩溃。
- `ReactDOMClient.createRoot(host)` 用于挂载独立面板（host 为新建 `document.createElement` 节点），
  使用点：L73-74（模块级可选引入）、L2992/L2996-2999（monitor container）、L3685/L3699-3700（skills chip host）。

---

## 3. 生命周期 / 状态隔离

- **按会话隔离**：所有可武装状态「armed/paused/remaining/backoffLevel/cooldownUntil」按 `sessionId` 各存一份，
  存放于 `_retryBySession`（`Object.create(null)`）；弹窗只显示当前绑定会话的状态。
- 事件消费走 ctx-mon 现有模型：`sessions.scopeOf(ctx)` 得当前活动会话 → `sessions.binding(id).eventSource`
  读会话事件（方案 A，纯会话内自救，**不引全局 mux**）。
- `SessionEventTokenSource` 只读订阅 `_sessions.list`（Critical Rule 12，L1515-1560）；
  `_scheduleBindRetry` 1000ms/30 次（L1492-1512）。

---

## 4. 公开 API（provider / token-source / runner 形状）

### 4.1 告警 provider（context-alert，`dsh-flash-ctx-mon:context-alert`）

| 方法 | 形状 |
|------|------|
| `start(cb, ctx)` | 入参：通知回调 + 宿主 ctx。内部**创建并启动 SessionEventTokenSource**（`createSessionEventTokenSource()` → `tokenSource.start(ctx)`）、订阅 skill 追踪并立即 `poll()`。**无返回值**（L2236-2254）。 |
| `stop()` | 清空回调、清定时器与 skill 订阅、`tokenSource.stop()`，并把 `_activeTokenSource` 置空（L2255-2261）。可反复调用，幂等。 |

### 4.2 TokenSource 公开方法（`_activeTokenSource` 暴露）

| 方法 | 形状 / 返回 |
|------|------------|
| `getTokenEstimate()` | 严格双形状：`{source:'unavailable'}` 或 `{source:'precise', pressureTokens, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, reasoningTokens, contextWindow, windowSource, windowConfirmed, model}`（L1609-1654）。 |
| `armAutoRetry()` / `disarmAutoRetry()` | 无参，按当前绑定 session 生效。 |
| `getAutoRetryView()` | 快照：`{state:'stopped'|'armed'|'scheduled'|'paused', sessionId, remaining, maxConsecutive, backoffLevel, cooldownUntil, nextEmitAtMs, lastSendAt, lastRequestId, inCooldown, continueText, graceMs, cooldownMs, maxBackoffMs, echoWindowMs, attemptIndex?}`（L1164-1190）。 |

> `state` 计算：无记录→`stopped`；`paused`→`paused`；`pending`→`scheduled`；否则→`armed`（L1168）。
> `attemptIndex = Math.max(1, maxConsecutive - remaining + 1)`（仅当记录有 `maxConsecutive` 时；否则 `0`，L1184-1188）。

### 4.3 runner（内联于 `createSessionEventTokenSource` L909；状态 L935-967、视图 L1164-1190、发布 L1194-1198）

- 内联于 token source 闭包内，复用 `_sessions`/`_sessionId`/`_ctx`，并直呼 `session.prompt(...)` 补发「继续」。
- 状态按 sessionId 隔离；overlay 经 `_activeTokenSource` 暴露的方法驱动 guard；
- **bridge**：`_autoRetryStore`（UI 层创建，`null` 时 no-op）→ `notify(view)` 把快照推给浮层组件，避免与
  token-source 初始化竞态（`_publishAutoRetryView` L1194-1198）。
- 业务原语全部来自 `src-client/auto-retry.js`：`isRetryableEnd` / `backoffDelayMs` / `inCooldown` /
  `shouldAutoContinue` / `consumeContinuation` / `isSelfEcho` / `retryAttemptKey` /
  `requestIdForAttempt`。核心判定：`backoffDelayMs = min(graceMs*2^level, maxBackoffMs)`（level 上限 20）。

### 4.4 窗口解析与持久化

- `_resolveWindow` 读时解析优先级链（L835-860 核实）：
  1. llm-pi-ai 模型配置（`_llmPiAiState.providers[].models[].contextWindow`）→ `CWS_USER_MAPPING`、
     `windowConfirmed = true`（L839-846）；
  2. 传统用户映射 `modelContextWindows`（来源按 `modelContextWindowSources` provenance 标记，
     L849-857）→ `windowConfirmed = true`；
  3. 缓存 `_contextWindow` + `CWS_REQUEST_CONTEXT`（请求 header 解析，仅当 `_contextWindowModel` 匹配当前
     `_model`，L1627-1630）→ `windowConfirmed = true`；
  4. 兜底 `ctxApproxWindow` + `CWS_APPROX_DEFAULT` → `windowConfirmed = false`（**绝不据此判压力**，L1635-1637）。
- `_persistWindow(opts)`（L1216-1244）：`opts.clobber` 仅显式传 `'always'` 时才允许覆盖**异源**已有记录
  （L1230）；来源为 `CWS_USER_MAPPING` 的条目永不覆盖（user intent > auto-detected，L1226）。

---

## 5. i18n 与偏好系统

### 5.1 i18n（`t(key)` / `L(key)` 双字形，中文简体为主）

| 项目 | 值 |
|------|----|
| 语言 | `zh` / `en`（`LOCALES`） |
| 检测 | `detectLocaleTag()`（读 `<html lang>`；缺省回退 `navigator.language` → `'en'`，L258-264） |
| 解析 | `resolveLocaleKey(tag)`（BCP-47 → `'zh' | 'en'`，L267-271） |
| 取用 | `t(key)`（键不存在时回退 `en` 再回退键名本体，L287-290）、`L(key)`（返回取用函数，随 locale 变化更新，L293-295） |

> 文案键集中在独立 key 集合（非内联中文硬编码），保证 `en` 也可见。

### 5.2 偏好（settings namespace `dsh-flash-ctx-mon`，另有 `llm-pi-ai`）

| 偏好 | 说明 |
|------|------|
| `ctxPollBase` (20000) / `ctxPollMin` (2000) | 上下文轮询基础间隔与下限（L307-308） |
| `autoRetryGraceMs` (5000) | 宽限期 |
| `autoRetryCooldownMs` (20000) | 冷却窗口 |
| `autoRetryMaxConsecutive` (4) | 连续补发上限 |
| `autoRetryMaxBackoffMs` (300000) | 退避上限 |
| `autoRetryContinueText` (`'继续'`) | 补发文案（连同请求 ID 用于识别自身回显） |
| `autoRetryEchoWindowMs` (30000) | 回显识别窗口 |
| `ctxApproxWindow` | 近似窗口兜底 |
| `modelContextWindows` / `modelContextWindowSources` | 用户映射与来源记录 |
| `monitor-context` toggle（`dsh-flash-ctx-mon:monitor-context`） | 监控芯片开关（L4070） |

每个偏好在浮层组件内**读时实时解析**（`_alertPref(key)`），不缓存陈旧值；用户编辑映射立即生效。

---

## 6. 跨文件复用清单（新增浮层组件须遵守）

新增跨文件浮层组件（例如从 `auto-retry.js` 导出组件、或在独立文件中实现新弹窗）时：

1. **不要** `import` R/E/S（它们不在模块级导出，L2318-2330 仅存在于闭包内）。
2. 由入口（factory-body.js）把 R/E/S 与 `_activeTokenSource`/`_autoRetryStore` 等作为**参数**传进来。
3. 复用 §4 的公开方法形状驱动：guard 状态经 `getAutoRetryView()` 读、经 `armAutoRetry/disarmAutoRetry` 写。
4. 浮层外观：用 §2 的 `R`/`E`/`S` 常量，避免新起色板；Modal 结构复用 §2.1 形状与区块顺序。
5. 渲染、错误边界、`ReactDOMClient` 挂载，遵循 §2.2 契约。

已落盘的复用例子：auto-retry 设计文档（[docs/auto-retry-integration-design.zh-CN.md](docs/auto-retry-integration-design.zh-CN.md)）
§4-§6 即依据本参考的形状产出，auto-retry 提交（commit 0c9c423）已包含其纯原语实现与 62/62 测试。

---

## 7. 测试与验证状态

- 现有测试：`npm test` **62/62 通过**（`test/auto-retry.test.js` 24 例、ctx-window 15、tokens 12、skill-detect 11 等）。
- `node scripts/build-client.mjs` 确定性重建 `lib/client.js` exit 0；`npx tsc --noEmit` exit 0。
- 本交付物为只读文档，未改动实现，故无需新增运行测试；相关断言已在上述测试中覆盖。

*(本文件为通读交付物，供 overlay/auto-retry 后续开发复用。)*
