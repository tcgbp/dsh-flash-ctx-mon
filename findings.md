# 发现与决策

## 需求
- 会话级通读任务：systematic 通读 `src-client/factory-body.js` 浮层风格体系与整体实现，为跨文件浮层组件复用建立**类型形状上下文**（供 overlay / auto-retry 等组件做约束）。
- 交付物形式（文档/代码）待用户确认；未确认前不径自产出。

## 模块结构（来源：src-client/index.js 头注释 + glob）
| 文件 | 角色 |
|------|------|
| `src-client/index.js` | esbuild 入口；仅 `import './factory-body.js'`，打包产物为 `lib/client.js`（运行时以 `/plugins/dsh-flash-ctx-mon/client.js` 对外） |
| `src-client/factory-body.js` | 主工厂 body（4259 行）。加载器契约 + presentational UI（React 组件 + 服务注册）+ runner。**R/E/S 样式常量全部定义于此闭包内** |
| `src-client/auto-retry.js` | 未跟踪新模块（-6278B）。纯状态机/守卫逻辑（决策原语），无 timer/无 session/无 DOM，可 Vitest 单测 |
| `src-client/tokens.js` / `skill-detect.js` / `ctx-window.js` | 能力模块（token 估算 / skill 内容识别 / context window 解析），单测存在 |
- **跨文件复用关键结论**：R/E/S 不是在模块顶层 export 的——`index.js` 直接 import factory-body.js 一个文件，esbuild 打成一个 bundle，所有常量闭包共享。**未来抽取浮层组件到独立文件时，要么和 factory-body.js 处在同一 bundle 闭包（能直接引用 R/E/S），要么显式把需要的常量作为依赖传入/导出**。auto-retry.js 保持纯决策无 UI，正是为了避免引入 R/E/S 依赖。

## 加载契约 / 渲染环境
- 无构建；经 `window.__ModuleLoader__.load({ id: 'dsh-flash-ctx-mon', factory: ... })` 加载。
- 渲染 `h(...)` = `React.createElement` + 显式 `key:`；hooks：`useState` / `useEffect` / `useRef` / `Component`（ErrorBoundary 用 class）。
- 可选 require `react-dom/client` → `ReactDOMClient`（root.render 用于 chip 挂载）。

## 样式常量（复用浮层组件必须匹配的命名与回退色）
- `R.*`（圆角，L2318-2325）：`xs 4px / sm 8px / md 12px / lg 16px / xl 20px / panel 28px`，均 `var(--dsw-radius-*, <回退>)`。
- `E.prominent`（阴影，L2326-2328）：`var(--dsw-elevation-prominent, <回退>)`。
- `S.*` 本地样式对象（L2330-2731）：键命名模式 `param*`、`monitorModal*`（mask/modal/head/title/close/body/divider/sectionTitle）、`alertPreview*`（group/row/icon/msg/cond/card/toggle）、`sectionFoldToggle`、`skills*`/`skill*`（skillChip/skillChipIcon/skillMeta/skillDesc/skillRow/skillRowHead/skillName/skillBadge/skillPath/skillOpenBtn/skillsLeadCard/skillsSectionTitle）、`mem*`（memColumnCard/memSubSectionLabel/memLiveDataGrid/memLiveDataLabel/memLiveDataValue/memUsageBarTrack/memUsageBarFill）、`tabPageChevron*`（tabPageChevron/tabPageChevronOpen）、`sliderRow/slider/value`、`switchIcon`。
- auto-retry 状态颜色/文案映射：`stopped #868e96` / `armed #2f9e44` / `scheduled #e8590c` / `paused #e03131`。
- CSS 变量一律带硬编码回退色（如 `var(--dsw-alias-label-secondary, #8b949e)`）。

## i18n
- zh/en + `LOCALES`；`detectLocaleTag` / `resolveLocaleKey` / `t(key)`（取数）/ `L(key)`（取键）；观察 `<html lang>` 切换。

## 偏好系统
- `_alertPref(key)` 读、`_writeAlertPref(key, val)` 写；含 `ctxPollBase/ctxPollMin`、`autoRetryCooldownMs`、`autoRetryGraceMs`、`autoRetryMaxBackoffMs`、`ctxApproxWindow`、`modelContextWindows`、`modelContextWindowSources`、`monitor-context` toggle 等。
- CWS_* 窗口来源常量：`CWS_USER_MAPPING` / `CWS_CATALOG_AUTO` / `CWS_CATALOG_UNKNOWN` / `CWS_REQUEST_CONTEXT` / `CWS_APPROX_DEFAULT`。
- `_persistWindow(windowValue, model, opts)`：`modelContextWindows` 非对象时重置 `{}`；同值跳过；`opts.clobber` = `'always'`（error-extraction 权威，覆盖任何已有）或 `'same-source-only'`（仅 srcLabel 自身来源时才就地更新；用户编辑/catalog-auto 视为覆盖）。用户映射意图（user intent）优先于自动探测。

## SessionEventTokenSource（数据源，in-line 于 factory-body.js）
- 数据路径：`ctx.get('sessions')` → `binding(sessionId)` → `eventSource` → entries（过滤 `entry.type==='event'` → `entry.event`）→ 提取 usage。
- **无条件订阅** `_sessions.list` store（Critical Rule 12），用于检测：无 session 时出现、以及用户切换 session。
- 会话解析：`_sessions.scopeOf(ctx)` → 无则 `_findMaterializedSession()`（扫 `list.getSnapshot().ids` 找含 `binding().eventSource` 者）。
- Bind 重试：每 1000ms 轮询、`_bindRetryCount` 上限 30 次后放弃、`_bindRetryTimer` 防重入。
- 会话切换处理：list 变化 → 新 id ≠ 当前 → `_reset()` + `_bindToSession()`；无 id 且当前有 → reset 并进入 bind retry。
- `getTokenEstimate()` 返回形状：`{ source: 'precise'|'unavailable', pressureTokens(=input+cacheRead+cacheWrite), inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, reasoningTokens, contextWindow, windowSource, windowConfirmed, model }`。
- `getAutoRetryView()`（runner 快照，供 overlay）：armed/paused/sessionId/remaining/backoffLevel/cooldownUntil/lastSendAt/lastRequestId 等，形状按 PYAPP pack（`_makeAutoRetryView`）。
- `armAutoRetry` / `disarmAutoRetry` 公开给持久 overlay（§6）。
- 窗口解析 **读时实时**（`_resolveWindow(_model)`）：用户映射优先（`windowConfirmed=true`）；unmapped 回退 `_contextWindow`+`CWS_REQUEST_CONTEXT`；再无 → `ctxApproxWindow`+`CWS_APPROX_DEFAULT`（guess，`windowConfirmed=false`，绝不能用来判断压力）。用户编辑立即生效。

## 上下文告警 provider
- id `dsh-flash-ctx-mon:context-alert`，`start(cb, ctx)` / `stop()`。
- 自适应轮询：`nextInterval = max(pollMin, round(pollBase * (1-ratio)^2 + pollMin))`；precise 模式下放大 2 倍；precise 但无确认窗口 → 用 pollMin 快速拿到本模型窗口；skill 使用订阅回调立即提前 poll。
- skill 使用告警：`skillTracker.claimNewSkills(now)` 一次性认领（认领后即使被 evict 也不再来——避免重复 toast 与全局 cap 冲突）；no second 永久重报的 skills alert（持久视图放 session-header chip + 面板 skills section）。

## Auto-retry / auto-continue（决策委托 ./auto-retry.js）
- `RETRYABLE_END_REASONS = ['error','interrupted','max-tokens']`；`isRetryableEnd(reason)` 按 `reason.kind`。
- `backoffDelayMs(graceMs, level, maxBackoffMs)` = `min(grace*2^level, cap)`，level 钳到 20。
- `scheduleCooldown` / `inCooldown`；`makeDisarmedState` / `armState`（纯状态构造器）。
- 状态机：`stopped | armed | scheduled | paused`；状态按 sessionId 隔离于 `_retryBySession`。
- 单发射 guard：`_retryTimer`（一个 setTimeout，一次只能有一个 pending emit）；`_scheduleAutoRetryEmit` 只在 armed 且不在 cooldown 时安排，backoff 从 record level 派生。
- 用户回流/继续：`_handleTurnEnd(reason)` —— retryable end 才 arm+schedule；非 retryable → disarm；remaining<=0 → 冻结 paused 等人接手。
- 注入回话：attemptSeq = `rec.maxConsecutive - rec.remaining + 1`；`requestIdForAttempt(_retryRequestIdCache, retryAttemptKey(sessionId, attemptSeq), gen)` 幂等生成 requestId；`source = { kind:'user', rpcId: requestId, autocontinue: true }` —— 自回显检测靠同一 rpcId。
- `_activeTokenSource`=null 声明；`_autoRetryStore` live bridge（UI 层创建）驱动 overlay guard；`stop()` 清 `_retryBySession` 与 `_retryRequestIdCache`。
- Runner 组合 INLINE 于 token source 之上，复用 `_sessions/_sessionId/_ctx` 与 `session.prompt(...)`（长度>=2 用数组参数否则 `{content}` 形状）。

## Open-turn ledger / watchdog（form ①，未完成会话检测）
- 纯模块 `src-client/unfinished-turn.js`：`makeLedger()` / `noteOpenTurn` / `noteClosedTurn`（FIFO 退役最旧 residual、清空后删 key）/ `openTurnsOf` / `hasOpenTurn` / `openTurnAfter` / `openTurnAgeMs` / `clearOpenTurns` / `unsettledTurnsAt` / `isUnsettledAndStopped`。纯数据 + guards，无 timer/DOM/session；**只提醒，绝不 auto-continue**（与 auto-retry 反向）。
- **已修复的跨函数 ReferenceError**：`getUnsettledTurns` / `dismissOpenTurns` 原先误放在 `createSessionSkillTracker` 的 return 对象里，引用了只在 `createSessionEventTokenSource` 闭包（L1143）声明的 `_openTurnLedger` → 运行时会 ReferenceError。已把两个方法迁到 token-source return 对象（跟随 `getAutoRetryView` 之后）；tokens 单测不覆盖此接线，靠 tsc / build 门捕获。
- 记账点：`turn/start` → `noteOpenTurn`（事件自带时间，replay-safe）；`turn/end` → `noteClosedTurn`（错误提取前）；history replace 清当前 session；`dismissOpenTurns(sessionId)` 清指定 session。
- **Unsettled 指示器**（与 auto-retry badge 同一 Bridge 模式）：`_unsettledStore` module-level 可选 bridge `{notify(view)}`；`_makeUnsettledView()` 返回 `{ unsettled: unsettledTurnsAt(_openTurnLedger, Date.now(), 60000) }`；`_publishUnsettledView()` 在每条 mutate 路径（turn/start、turn/end、history-replace clear、dismiss）及每次 bind 后调用；UI 在 `_applyInner` 时装填并 prime、dispose 清空 + `_clearUnsettledDomIndicator()`。
- DOM 效果：`html[data-ctx-mon-unsettled] [data-dsh-flash-trigger][data-ctx-mon-unsettled-count]::after` 红色计数 pill（`ctx-mon-unsettled-indicator` stylesheet 惰性注入）；trigger 印章 `data-ctx-mon-unsettled-count` + `title`；count 0/无 view 全清。overlay 经 `_activeTokenSource.getUnsettledTurns()` 读快照（read-only）。

## Modal / 面板结构
- 主结构 `monitorModalMask > monitorModal > (monitorModalHead + monitorModalBody)`（head 含 title + close）。
- body 顺序固定：`skillSectionEl, fieldEls, autoRetryEl, alertPreviewEl, ctxLiveDataEl`（L3418 附近，`SessionSkillsSection lead`）。
- 各参考 section 默认折叠（`sectionFoldToggle` + status）；alert preview 独立三点折叠。
- ErrorBoundary：`PanelErrorBoundary extends Component`，渲染错误兜底 + Retry 按钮。

## 技术决策
| 决策 | 理由 |
|------|------|
| 决策逻辑抽到 auto-retry.js 纯模块 | 直接 Vitest 单测；不引入 R/E/S/闭包依赖 |
| Runner 组合 INLINE 于 token source | 复用 `_sessions/_sessionId/_ctx`，避免双份 session 绑定 |
| overlay 组件全部在 factory-body.js 闭包内 | R/E/S 非模块级导出，同闭包可直接引用 |
| 窗口读时实时解析 | 用户映射编辑即时生效，避免陈旧缓存 |

## 遇到的问题
| 问题 | 解决方案 |
|------|---------|
| `_openTurnLedger` 被 `createSessionSkillTracker` return 对象里的方法引用（跨函数 ReferenceError） | 已把 `getUnsettledTurns` / `dismissOpenTurns` 迁到 `createSessionEventTokenSource` return 对象，与 `_openTurnLedger` 同闭包；tsc/build 门验证 |
| 未完成会话的提醒需求（硬中断检测） | open-turn accounting + watchdog timeout（consumer-held expectation，不轮询 agent 端点，不新增 event type）；只 paint 红色计数，绝不 auto-continue，return control to user |
