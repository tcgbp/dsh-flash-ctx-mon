# 进度日志

## 会话：已中断/已暂停(paused)会话可重新开启自动继续

### 需求与用户确认
- 用户问：**已中断状态会话为什么无法开启自动继续模式**（观察「开关打不开」）。
- 诊断：`interrupted` 本身是「可重试结束」之一（`error/interrupted/max-tokens`），**不是**被它拦下的；
  真正拦路的是**连续预算耗尽后冻结在 `paused`**（记录仍 `armed: true`，`remaining<=0`）——
  旧 `_armAutoRetry` 只在 `!rec.armed` 时才重新播种预算，导致开关/继续词对 paused 都是**静默空操作**；且 resident 面板 `armDisabled` 对 paused/stopped 一律禁用。
- 经 `ask_user_question` 确认修复方向：**允许把已暂停(paused)的会话重新武装（推荐）** —— 显式用户动作重新播种预算并解除 paused，保留「预算防烧钱」护栏。

### 已执行操作
- [x] `src-client/factory-body.js`：
  - `_armAutoRetry(force)`：新增 `force` 分支 —— `armed && paused`（预算耗尽）时清掉 `paused`/`pending`/`nextEmitAtMs`/`backoffLevel`/`cooldownUntil`/`lastRequestId`/`echoedAt`，把 `remaining` 重新播种为新的 `autoRetryMaxConsecutive`，并更新 doc 注释。
  - 显式用户路径（公共 `armAutoRetry`、`_autoArmOnContinue`）带 `force=true`；
    `_handleTurnEnd`（可重试结束自动再武装）与重绑时按持久化偏好恢复**不带 force** —— 被挂起会话不会自行复活。
  - `armDisabled` 改为：仅无 view/source、`scheduled`（已排程）、或已 armed 且仍有预算时禁用；`stopped` 与 `paused` 均可点「立即武装」重新开启。
- [x] `node scripts/build-client.mjs` 重建 `lib/client.js`（183.7kb）：bundle 含 `force && rec.paused` 再武装分支、新 `armDisabled`、`_armAutoRetry(true)`。
- [x] 更新 CHANGELOG.md Unreleased（新增「被预算挂起的会话可重新开启」段 + internal）、README.md / README.zh-CN.md（paused 段：显式重新开启并重播预算）、docs/auto-retry-integration-design.zh-CN.md（§5 新增 5c）。

### 测试
- [x] `npx tsc -p tsconfig.json --noEmit`（exit 0）。
- [x] `npx vitest run --pool=threads`：**94/94**。
- [x] `node scripts/build-client.mjs` exit 0。

### 约束遵守
- 仅改动本方文件；未触碰用户 dsh-flash 重构 ` M` 文件；未设置 `sandbox_permissions`。

### 待办
- [ ]（如需要）GUI 刷新验证：把预算烧尽挂起的会话拨「自动继续」开关（或点「立即武装」）→ 状态从红色 paused 回到绿色待命并继续自动补发；未武装/已武装会话行为不受影响。

## 会话：（未提交待续）去掉「已退出自动继续」手动停止退出告警

### 需求与用户确认
- 用户看到退出告警「已按你的操作停止自动继续（会话 …，工作区 …）」，认为**没信息量**，要求**去掉这条告警**。
- 经 `ask_user_question` 确认：**仅 manual（推荐）** —— 只去掉**手动「停止自动继续」**的退出 info 弹窗；**budget（连续补发达上限 → paused）**的退出告警保留。
- 边界：**手动停止的解除行为本体保留** —— `disarmAutoRetry('manual')` 仍照常关闭守卫，只是不再弹 info 提醒。

### 已执行操作
- [x] `src-client/factory-body.js`：
  - `AUTO_RETRY_EXIT_REASONS` → `['budget']`（删 `'manual'`），更新注释：手动停止是显式用户动作、不言自明，静默站下；仅预算耗尽在无任何用户操作时弹告警。
  - `autoRetryExitedReasonKey` 收敛为单分支（恒返回 `autoRetryExitedReasonBudget`），并更新 doc 注释。
  - 删除 `autoRetryExitedReasonManual` i18n 键（zh+en）。
  - 更新 `_noteAutoRetryExit` / `_disarmAutoRetry` / 快速开关 manual-off 处的注释（不再提示 manual 会弹退出告警）。
- [x] `node scripts/build-client.mjs` 重建 `lib/client.js`（182.8kb）：bundle 含 `AUTO_RETRY_EXIT_REASONS=["budget"]`、`autoRetryExitedReasonBudget`，且无 `autoRetryExitedReasonManual` / 中文「已按你的操作停止自动继续」 / 英文 "Stopped by your action — auto-continue off" 残留。
- [x] 更新 README.md / README.zh-CN.md（退出告警段落：仅 budget 弹告警带定位；手动停止不弹）、CHANGELOG.md Unreleased（新增「手动停止不再弹退出告警」段 + internal 修订）、docs/auto-retry-integration-design.zh-CN.md（§5 5b 修订说明）。

### 测试
- [x] `npx tsc -p tsconfig.json --noEmit`（exit 0）。
- [x] `npx vitest run --pool=threads`：**94/94**（tokens 12 + skill-detect 11 + ctx-window 15 + auto-retry 40 + unfinished-turn 16）。
- [x] `python`/全量 build：`node scripts/build-client.mjs` 与 `npm run build` 均 exit 0；bundle grep 复核无 manual 退出告警残留。

### 约束遵守
- 仅改动本方文件（src-client/factory-body.js + lib/client.js + README×2 + CHANGELOG + docs design + progress/task_plan）；未触碰用户 dsh-flash 重构 ` M` 文件；未设置 `sandbox_permissions`（本会话策略 danger-full-access、审批禁用）。

### 待办
- [ ]（如需要）GUI 浏览器刷新验证：手动「停止自动继续」不再弹 🔁 退出告警；连续补发达上限仍弹（budget，带定位后缀）。

## 会话：（未提交待续）直接武装「继续」词 + 正常结束不再解除守卫

### 当前位置
> 下方是已完成的直接武装改造与正常结束不解除守卫（settled 退出移除）摘要。

### 需求与用户确认
- 用户要求：**只要用户手动输入 继续 / continue / resume 等消息，就自动打开自动继续模式；不再弹窗让用户再次点击确认**。
- 用户要求：**去掉正常结束这个退出条件** —— 经 `ask_user_question` 确认选择 **方案 1「改为：正常结束也自动继续」+ 选项 (A)「仅已武装会话」**：已武装会话的回合正常收尾**保持武装**、继续待命补发；未武装会话的回合正常收尾**保持未武装**（不会被被动武装，输入继续词入口保留）。

### 已执行操作
- [x] `src-client/factory-body.js`：`_matchesContinueWord` 新增 `resume` / `res`（整词匹配，`继续`/`continue`/`cont` + 配置文本保持）。
- [x] `_maybePromptAutoRetry` → 改名 **`_autoArmOnContinue`**：不再设置 pending / 冷却 / bridge 转发，命中裸继续词时直接 `_armAutoRetry()`（武装幂等；调用点仍先短路已武装会话）。
- [x] **全量移除询问/确认管线（非仅禁用）**：`_continuePromptBridge` / `_continuePromptPending` / `_continuePromptAt` / `CONTINUE_PROMPT_COOLDOWN_MS` 声明；`_armAutoRetry` 内的 pending 回收块；provider `poll()` 的 offer 告警块（`ctx-auto-continue-offer-<ts>` 及其 `auto-continue-enable/decline` 两个 action）；`_flushOfferPoll` / `_promptHandler`；provider `start()` / `stop()` 的 bridge 接线；`_reset()` / `_applyInner()` / `dispose()` 的 pending 清理；两组 `continuePrompt*` i18n 键（zh+en 各 6 条，含 Close/Armed）。
- [x] **正常结束不再解除守卫（settled 退出移除，全量删除）**：
  - `_handleTurnEnd` 重写：retryable → `_armAutoRetry()`；settled → **已武装** 会话保持武装走统一尾部继续待命、**未武装** 会话直接 `return`（不 disarm、不被动武装）；统一尾部处理 `remaining<=0` 冻结 `paused`（`_noteAutoRetryExit('budget')`）或 `_scheduleAutoRetryEmit()`。
  - `AUTO_RETRY_EXIT_REASONS` → `['manual', 'budget']`（删 `'settled'`）。
  - `autoRetryExitedReasonKey` 删 settled 分支（防御性未知原因默认回退到 budget/“auto-continue stopped”文案，结构性不可达）。
  - 删除 `autoRetryExitedReasonSettled` i18n 键（zh+en）。
- [x] `node scripts/build-client.mjs` 重建 `lib/client.js`（183.1kb）：bundle 含新 `_handleTurnEnd`（retryable→arm；settled→已武装保持 / 未武装 return；统一尾部 budget-freeze + schedule），且无 `settled`（退出场景）/ `autoRetryExitedReasonSettled` / `_maybePromptAutoRetry` / `_continuePrompt*` / `continuePrompt*` / `auto-continue-offer` / `_flushOfferPoll` 残留（`unsettled` 指示器计数与此无关，属另一功能）。
- [x] 更新 README.md / README.zh-CN.md（自动继续章节：正常收尾不再解除守卫）、CHANGELOG.md Unreleased、design 文档（§4 状态机 / §5 护栏）、findings.md（`_handleTurnEnd` 描述）。

### 测试
- [x] `npx tsc --noEmit`（exit 0）。
- [x] `npx vitest run --pool=threads`：**94/94**（tokens 12 + skill-detect 11 + ctx-window 15 + auto-retry 40 + unfinished-turn 16）。
- [x] bundle grep 复核（上述残留清零）。

### 约束遵守
- 仅改动本方文件（src-client/factory-body.js + lib/client.js + README×2 + CHANGELOG + docs design + findings + progress/task_plan）；
  未触碰用户 dsh-flash 重构 ` M` 文件。
- 纯闭包/`var` 风格；新增行为有守卫护栏（连续预算默认 4 次冻结 paused + 手动「停止」彻底关闭），非无限无人空转。

### 待办
- [ ]（如需要）GUI 浏览器验证：未武装会话输入「继续」即刻开启且无确认弹窗；已武装会话跑一个正常回合后自动继续保持开启。

---

## 会话：2026-11-14（快捷面板「自动继续」开关：落到弹窗通知下方 + 修正图标 + 去掉配置按钮 + 随主开关显隐）

### 需求与用户确认
- 用户反馈①：快捷面板里「自动继续」开关 **没有显示**，只有打开的配置（可视化调整）
  页面里才看得到。澄清：**开关应显示在快捷面板中**。
- 用户初次确认方案：开关**常驻始终显示**（开=arm / 关=stop 当前会话）——后经多轮反馈收敛为：
  **落在 弹窗通知 开关下方**、**去掉多余 ⚙ 配置按钮**、**系统告警总开关关闭时整行隐藏**。
- 用户反馈②（第一轮修复后）：**icon 仍没正确显示**。
- 用户反馈③：**自动继续 放到 弹窗通知 开关下面**。
- 用户反馈④：**自动继续 咋多出了个配置按钮** → 去掉 `config`。
- 用户反馈⑤：**系统告警总开关关闭时 自动继续 没有隐藏** → `visible` 改为 `_getAlertsOn()`。

### 根因（两处，均已对照 dsh-flash 客户端源码 `_ICON_PATHS` / `_switchIcon` 实证）
1. **开关不显示**：`registerSwitch({ id: RUNNER_QUICK_KEY … })` 原 `visible: _getRunnerActive()`
   只在当前会话 auto-retry 处于 armed/scheduled/paused 时渲染开关行；stopped（默认）时不渲染。
2. **图标不显示**：开关 `icon: 'refresh'` 不在 dsh-flash 的 monochrome 字形集 `_ICON_PATHS`
   （共有 sliders/blocks/doc/pin/ruler/eye/close-on-blur/rail/theme/palette/expand/more/bell/
   toast/globe/link/log/chip/**message**/signal/queue/clock/shield/bot/play/pause/scroll/plus，
   没有 refresh）。`_switchIcon` 对未知名字走 `if (!paths) return h('span',{style},icon)`，
   把字面量 "refresh" 当纯文本渲染 —— 正是「图标没正确显示」的现象。
   （上下文监控开关用 `icon:'message'`，在集合内，所以显示正常。）

### 已执行操作
- [x] `src-client/factory-body.js`：① `icon: 'refresh'` → `icon: 'scroll'`（集合内，语义≈继续，
      且与 message 区分；注释说明为何不能用 refresh）；② `order: 60` → `62`（把开关挪到
      「弹窗通知」Toast 开关正下方：cluster 内按 order 升序，57 系统告警 / 59 上下文监控 /
      61 弹窗通知 / 62 自动继续，位于 80/81 主机滑杆之上）；③ 去掉 `config` 字段（dsh-flash
      对 ON 且带 config 的 toggle 会在行内渲染 ⚙ 配置按钮，该入口只属于上下文监控开关）；
      ④ `visible: true` → `visible: () => _getAlertsOn()`（系统告警总开关关闭时随之隐藏，
      与上下文监控开关一致）。
      `_getRunnerActive()` 仍用于 `getValue`（选中态实时反映 armed/scheduled/paused）。
- [x] `node scripts/build-client.mjs` 重建 `lib/client.js`（183.2kb）：bundle 内 `icon: "scroll"`、
      `order: 62`、无 `config`、`visible: function(){ return _getAlertsOn() }` 均已落库；
      无陈旧 `icon:"refresh"` / `order: 60` / 自动继续上的 `config`。
- [x] 更新 README.md / README.zh-CN.md 开关章节说明。

### 测试
- [x] `npx tsc --noEmit`（exit 0）、`npx vitest run --pool=threads`（94/94）、bundle grep 复核。

### 约束遵守
- 仅改动本方文件（src-client/factory-body.js + lib/client.js + README×2 + progress/task_plan）；
  未触碰用户 dsh-flash 重构 ` M` 文件。

### 待办
- [ ]（如需要）提交本轮改动；GUI 浏览器验证：快捷面板系统告警下顺序为 系统告警 → 上下文监控 →
      弹窗通知 → **自动继续**（无 ⚙ 配置按钮、图标单色 scroll；**系统告警总开关关闭时整行隐藏**，
      重新打开后自动继续随即出现）。

---

## 会话：2026-11-14（退出告警带定位 + 人工输入不再退出自动继续）

### 当前状态
- **阶段：** 已完成 —— 两处行为修改，三门口令通过，文档同步。

### 需求与用户确认
- 需求①：**「已退出自动继续」弹窗要展示工作区 + 会话信息**，方便用户定位是哪个上下文退出了。
- 需求②：**检测到人工输入不作为退出自动继续的条件**（此前人工输入到手即 `_disarmAutoRetry('human')` 清零退出，现改为保持 armed、不消耗连续预算）。

### 已执行操作（本会话累计）
- [x] **i18n**：`zh`/`en` 字典各新增定位后缀键（`autoRetryExitedLocSid/LocWs/LocSep/LocOpen/LocClose`，均含 `{value}` 占位）；删除已死的 `autoRetryExitedReasonHuman`（zh+en 两行）。
- [x] `autoRetryExitedReasonKey()` 移除 `'human'` 分支。
- [x] 新增 `autoRetryExitedLocate(sessionId, workspace)` 纯辅助：按可用信息拼装定位后缀 `（会话 <sid>，工作区 <cwd>）`，无信息返回空串。
- [x] token-source 闭包新增 `_sessionWorkspace(sessionId)`（读 `_sessions.list.getSnapshot().byId[sid].cwd`，null-safe）。
- [x] `_noteAutoRetryExit()` 记录 `workspace: _sessionWorkspace(sid)` 随 `_autoRetryExitedPending` 一并带上。
- [x] provider `poll()` 的 exited info 告警 message 末尾追加定位后缀（reason 文本 + locate）。
- [x] `AUTO_RETRY_EXIT_REASONS` 移除 `'human'`。
- [x] `_handleUserMessage()`：非自身回显的人工输入分支 `_disarmAutoRetry('human')` → **保持 armed 空操作**（守卫仅在 settle/budget 或显式「停止」时退出）。
- [x] 同步文档：`docs/auto-retry-integration-design.zh-CN.md`（§2/§4/§5 修订 + 新增 §5b 定位说明）、`README.md`、`README.zh-CN.md`。

### 测试结果（2026-11-14 实测）
- [x] `npx tsc --noEmit`：exit 0。
- [x] `npx vitest run --pool=threads`：**94 passed (94)**（tokens 12 + skill-detect 11 + ctx-window 15 + auto-retry 40 + unfinished-turn 16）。
- [x] `node scripts/build-client.mjs`：lib/client.js 重建 OK（187.0kb）；bundle 含 `autoRetryExitedLocate`/`_sessionWorkspace`，且无 `disarming auto-retry` / `autoRetryExitedReasonHuman` 残留。

### 约束遵守
- 仅改动本方文件（src-client/factory-body.js + lib/client.js + docs + README×2 + progress/task_plan）；未触碰用户 dsh-flash 重构 ` M` 文件。
- 沿用纯模块/闭包风格，环境守卫仍用 `var`、无箭头/模板串。

### 待办
- [ ]（如需要）提交本轮改动（src-client + lib + docs + README + 规划文件）；GUI 浏览器验证退出告警渲染与定位后缀。

---

## 会话：2026-11-12（复用 dsh-flash 信息告警弹窗询问「开启自动继续」）

### 当前状态
- **阶段：** 已实现 —— 自定义 `ContinuePromptModal` 完全移除，改为由 context alert provider 向 `dshFlashAlerts` 注册表发布一条 **info 级告警**（🔁「开启自动重试？」），复用 dsh-flash 自己的 toast/detail 弹窗承接「开启自动继续 / 暂不」选择。三门口令通过。

### 需求与用户确认
- 用户要求：**复用信息级别告警弹窗来询问用户是否开启自动继续，而不是自定义的弹窗。**
- 用户通过 `ask_user_question` 确认三项：
  1. 路线 = 按 provider 注入 info 告警（复用 dsh-flash 现有 toast/detail 弹窗，action 按钮「开启自动继续」「暂不」）。
  2. 自定义 `ContinuePromptModal` = 完全移除。
  3. 常驻指示器（armed/paused 状态 + flash 图标开关）= 保留（与询问弹窗是独立功能）。

### 已执行操作（本会话累计）
- [x] 在 `createSessionContextProvider.poll()` 尾部注入 continue-offer 告警：
  - id `ctx-auto-continue-offer-<at>`（时间戳后缀 → 每次手动继续独立，dismiss 只影响当次；不记录冷却）。
  - severity `info`、icon `🔁`、dismissible、title=`continuePromptTitle`、message=`continuePromptBody`。
  - actions：`auto-continue-enable`（primary，绿色语义）→ `_activeTokenSource.armAutoRetry()` + 清 pending + 立即 re-poll（`{message: continuePromptArmed, close:true}`）；`auto-continue-decline`（「暂不」）→ 记录 `_continuePromptAt[sid]=Date.now()` + 清 pending + 立即 re-poll（`{message:null, close:true}`）。
  - registry 对 genuinely-new id 才弹 toast，重复 emit 同 id 保持安静。
- [x] token source 返回对象新增 `getSessionId()`；`_reset()`（每次会话切换/重绑/stop 时执行）内 `_continuePromptPending=null`，杜绝旧会话 pending 泄漏到新会话。
- [x] provider 内新增 `_flushOfferPoll()`（清 timer + 立即 `poll()` re-emit）与 `_promptHandler`（bridge handler，按引用保存在 `stop()` 中按身份清空）。
- [x] provider `start()` 安装 `_continuePromptBridge.handler = _promptHandler`（数据层 → provider 的即时刷新通道）；`stop()` 按身份清空。
- [x] **完全移除** `ContinuePromptModal` 组件、`CONTINUE_BTN`、`openContinuePrompt`、`closeContinuePrompt`、`_continuePromptRoot`/`_continuePromptHost` 声明，及 `_applyInner` 里的 `_continuePromptBridge.handler = openContinuePrompt` 与 `dispose()` 里的 `closeContinuePrompt()`。
- [x] 语义保留：`_maybePromptAutoRetry` 的 guards（已武装短路 / `_matchesContinueWord` / 按会话冷却 `_continuePromptAt`）与设置 pending 逻辑**零改动**；「暂不」记录冷却、普通 dismiss 不记录冷却的对账保持正确。
- [x] 保留 `_continuePromptBridge`/`_continuePromptPending`（重定位为数据层 → provider 通道），常驻指示器未动。

### 测试结果（2026-11-12 实测）
- [x] `npx tsc --noEmit`：exit 0。
- [x] `npx vitest run --pool=threads`：Test Files 5 passed (5)，**Tests 80 passed (80)**（tokens 12 + skill-detect 11 + ctx-window 15 + auto-retry 26 + unfinished-turn 16）。
- [x] `node scripts/build-client.mjs`：lib/client.js 重建 exit 0；bundle 含 `ctx-auto-continue-offer` 且无任何已删符号（`openContinuePrompt/closeContinuePrompt/ContinuePromptModal/_continuePromptRoot/_continuePromptHost`）残留。

### 约束遵守（用户红线）
- 复用 dsh-flash 注册表信息级告警弹窗，不再自造 React modal。
- `_maybePromptAutoRetry` 语义与冷却对账保持不变；未改动的 ` M` 文件（package.json、README×2、docs/auto-retry-integration-design、docs/tcgbp yml）未触碰。
- 不设置 `sandbox_permissions`；无破坏性 checkout。

### 待办
- [ ]（如需要）GUI 浏览器验证 info 告警弹窗实际渲染与续提互动（受鉴权 / 无真实中断会话限制，机器可验证门为上方三项）。

---

## 会话：2026-11-12（open-turn watchdog / unsettled 指示器）

### 当前状态
- **阶段：** 交付验证中——open-turn 记账 + watchdog 过期提醒进入 flm 后已完成接线，三门口令通过，文档更新中。

### 已执行操作（本会话累计）
- [x] 新增纯模块 `src-client/unfinished-turn.js`（`makeLedger` / `noteOpenTurn` / `noteClosedTurn` / `openTurnsOf` / `hasOpenTurn` / `openTurnAfter` / `openTurnAgeMs` / `clearOpenTurns` / `unsettledTurnsAt` / `isUnsettledAndStopped`），测试 `test/unfinished-turn.test.js`（16 用例）。
- [x] **修复跨函数 ReferenceError**：`getUnsettledTurns` / `dismissOpenTurns` 原在 `createSessionSkillTracker` return 对象内引用仅 token-source 闭包声明的 `_openTurnLedger`。已把两者迁到 `createSessionEventTokenSource` return 对象（`_openTurnLedger` 唯一声明于该闭包）。
- [x] 接线 `_publishUnsettledView()`：turn/start 后、turn/end 后、history-replace 清当前 session 后（L1838 `clearOpenTurns` 之后）、`dismissOpenTurns` 内、每次 `source.start` 的 bind 后。
- [x] Bridge 指示器：module-level `_unsettledStore`（`{notify}`）在 `_applyInner` 时装填并 prime（读 `_activeTokenSource.getUnsettledTurns()`），dispose 清空 + `_clearUnsettledDomIndicator()`；`_ensureUnsettledIndicatorStyle` / `_syncUnsettledDomIndicator` / `_clearUnsettledDomIndicator` 照 auto-retry 指示器模式（`html[data-ctx-mon-unsettled] [data-dsh-flash-trigger][data-ctx-mon-unsettled-count]::after` 红色计数 pill，stylesh `ctx-mon-unsettled-indicator` 惰性注入）。
- [x] overlay 读快照路径定案：经 `_activeTokenSource.getUnsettledTurns()`（token-source return 对象），非 `_activeSkillTracker`。
- [x] 产出 `docs/detecting-unfinished-session.zh-CN.md`（open-turn accounting / watchdog timeout / owning-handle-loss；只提醒不自动续）。

### 约束遵守（用户红线）
- 只提醒、绝不 auto-continue（返回 control 给用户，防 hard interrupt 重复计费）——与 auto-retry 的 auto-continue 相反。
- 不轮询 `agent/status` / `agent`；不新增 session event `type`；只用已文档化扩展点。
- 纯模块优先（对齐 `auto-retry.test.js`），watchdog 语义来自 `unsettledTurnsAt(ledger, now, grace=60000)`。

### 测试结果（2026-11-12 实测）
- [x] `npx tsc --noEmit`：exit 0。
- [x] `npx vitest run --pool=threads`：Test Files 5 passed (5)，**Tests 78 passed (78)**（tokens 12 + skill-detect 11 + ctx-window 15 + auto-retry 24 + unfinished-turn 16）。
- [x] `node scripts/build-client.mjs`：lib/client.js 重建 exit 0。

### 待办
- [ ]（如需要）在 GUI 浏览器验证 resident badge 实际渲染（受鉴权 / 无真实中断会话限制，机器可验证门为上方三项）。
- [ ] 提交本轮改动（src-client 变更 + lib + docs + 测试 + 规划文件）。

---

## 会话：2026-11-10（通读与交付）

### 当前状态
- **阶段：** 5 - 交付（auto-retry 已提交，通读文档定稿，正在向用户交付）

### 已执行操作（本会话累计）
- [x] 通读 src-client/factory-body.js 全量（含 L4063-4097 monitor-context 补读），确立 R/E/S、Modal 结构、provider/token-source/runner 公开 API、i18n、偏好、状态机。
- [x] findings.md 完整落盘（模块结构、加载契约、样式常量、i18n、偏好、TokenSource、告警 provider、auto-retry、Modal 结构、技术决策）。
- [x] 交付物形式与优先级经用户确认：**文档**；auto-retry 先提交后转交通读文档。
- [x] 产出 `docs/overlay-type-shapes.zh-CN.md`（§1-§7 定稿，14780B），§2 含 R/E/S 三常量与 Modal 通用骨架真实值，§6 跨文件复用清单。

### 本会话关键事件（git / 构建）
- [x] auto-retry 提交 `0c9c423`（runner 基座）+ `a8cd61f`（resident auto-retry glow indicator + continue-prompt modal；将 localStorage 键改为 `dsh-flash:system-alerts`）。
- [x] **误操作记录**：中间误对 factory-body.js / lib/client.js 执行 `git checkout --`，丢弃用户在共享 checkout 并发改写的 dsh-flash 重构改名（dockFlashAlerts→dshFlashAlerts、dock-flash:ready→dsh-flash:ready）。已与用户确认方案为「恢复它们到 dsh-flash 并同步 lib」。
- [x] 恢复完成：factory-body.js 7 处服务名/事件名 + 1 处注释已改回 dshFlashAlerts / dsh-flash:ready；`pnpm build:client` 重建 lib/client.js 与其正式同步；两文件 grep 均无 `dockFlashAlerts`/`dock-flash:ready` 残留。
- [x] 工作区其余 ` M`（package.json、README×2、docs/auto-retry-integration-design、docs/tcgbp__dsh-flash-ctx-mon.yml）为**用户 dsh-flash 重构**，按用户指示不处理、不提交。

### 测试结果（2026-11-10 实测）
- [x] `npx vitest run --pool=threads`：Test Files 4 passed (4)，**Tests 62 passed (62)**（tokens 12 + skill-detect 11 + ctx-window 15 + auto-retry 24）——与文档 §7 声明一致。
- [x] `node scripts/build-client.mjs`：lib/client.js 重建 exit 0。
- [x] `npx tsc --noEmit`：exit 0。

### 待办
- [ ] 向用户交付 `docs/overlay-type-shapes.zh-CN.md`（核心交付物）。
- [ ] 告知用户：dsh-flash 重构的 factory-body/lib 已按其确认恢复并同步 lib；其余重构文件由其自行收尾。

### 错误
| 错误 | 解决方案 |
|------|---------|
| 误 checkout 丢弃用户 dsh-flash 改名 | 恢复 + build:client 同步 lib（用户确认） |
| vitest forks pool 失败（Win 沙箱） | 改用 --pool=threads，62/62 通过 |
