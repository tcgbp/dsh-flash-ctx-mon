# 任务计划：通读 src-client/factory-body.js 浮层风格体系

## 目标

为跨文件浮层组件复用建立 factory-body.js 的类型形状上下文（样式常量 R/E/S、Modal 结构、provider/token-source/runner 公开 API、i18n、偏好、状态机），产出一份可被 overlay/auto-retry 组件复用的约束性通读记录。交付物形式已确认：**文档**（非代码抽取）。

## 当前阶段

阶段 4（测试与验证）已完成；阶段 5（交付）进行中。

## 各阶段

### 阶段 1：需求与发现
- [x] 理解用户意图（通读建立类型形状上下文，交付物形式未界定）
- [x] 确定约束条件和需求（无构建、模块加载契约、R/E/S 闭包内定义）
- [x] 将发现记录到 findings.md（已完整落盘）
- **状态：** complete

### 阶段 2：规划与结构
- [x] 确定技术方案（跨文件组件需同闭包引用 R/E/S 或显式传依赖）
- [x] 记录决策及理由（findings.md「技术决策」表）
- [x] 确认交付物形式 **= 文档**（用户确认）
- **状态：** complete

### 阶段 3：实现
- [x] 产出通读交付物 `docs/overlay-type-shapes.zh-CN.md`（§1-§7 定稿落盘，14780B）
- [x] auto-retry 功能提交：`0c9c423`（runner 基座）+ `a8cd61f`（residential glow indicator + continue-prompt modal）共 4 个功能文件（README.md、README.zh-CN.md、lib/client.js、src-client/factory-body.js），已 commit。
- **状态：** complete

### 阶段 4：测试与验证
- [x] `npx vitest run --pool=threads`：**62/62 通过**（auto-retry 24 + ctx-window 15 + tokens 12 + skill-detect 11）
- [x] `node scripts/build-client.mjs`：lib/client.js 确定性重建 exit 0
- [x] `npx tsc --noEmit`：exit 0
- [x] 修复本次会话误操作：误 git checkout 丢弃的用户 dsh-flash 重构改名（dockFlashAlerts→dshFlashAlerts、dock-flash:ready→dsh-flash:ready）已恢复到 factory-body.js 并 build:client 同步 lib/client.js；两文件均无 dock 残留，与 package.json/README 一致。
- **状态：** complete

### 阶段 5：交付
- [x] 检查输出文件（docs/overlay-type-shapes.zh-CN.md 定稿；通过 real git status 核查工作区）
- [ ] 交付给用户
- **状态：** in_progress

## 关键问题

1. ✅ 已决：交付物形式 = 文档。
2. ✅ 已决：auto-retry 先提交并验证（已提交 a8cd61f），再转交通读交付物。
3. 工作区剩余 ` M` 文件（package.json、README×2、docs/auto-retry-integration-design、docs/tcgbp yml）= 用户在共享 checkout 内正在进行的 **dsh-flash 重构改名**（dockFlashAlerts→dshFlashAlerts 等）；用户明确「dsh-flash 那边在重构，你不要管」→ **不提交、不改动**，保持用户版本。
4. 通读文档为只读存档，引用 commit 0c9c423 描述撰写当时状态，作为历史快照自洽。

## 已做决策

| 决策 | 理由 |
|------|------|
| 决策逻辑抽到 auto-retry.js 纯模块，可 Vitest 单测 | 不引入 R/E/S/闭包依赖，可单测 |
| Runner 组合 INLINE 于 token source 之上 | 复用 `_sessions/_sessionId/_ctx` 与 `session.prompt(...)` |
| overlay 组件全部内嵌于 factory-body.js 闭包 | R/E/S 非模块级导出，同闭包可直接引用；跨文件需传依赖 |
| context window 读时实时解析 | 用户映射编辑立即生效，避免陈旧缓存 |
| skill 告警一次性认领（claimNewSkills） | 避免重复 toast；evict 后不复活 |
| 无条件订阅 `_sessions.list`（Critical Rule 12） | 检测 session 出现与切换 |
| dsh-flash 重构改名在 ctx-mon 侧不处理、不提交 | 用户明确重构由 dsh-flash 侧进行，ctx-mon 只还原我误删的用户改动 |

## 遇到的错误

| 错误 | 尝试次数 | 解决方案 |
|------|---------|---------|
| 误 `git checkout --` 丢弃用户并发 dsh-flash 改名（factory-body/lib） | 1 | 与用户确认后按「恢复+同步 lib」方案，逐处改回 dshFlashAlerts/dsh-flash:ready，build:client 重建 lib |
| vitest forks pool 在 Win 沙箱失败 | 1 | 改用 `--pool=threads`，62/62 通过 |

## 备注
- 通读覆盖：L1-160、L161-560、L561-890、L891-1220、L1221-1780、L1781-2330、L2330-2731、L2732-2954、L2955-3084、L3085-3199、L3200-3279、L3286-3668、L3678-3730、L3730-4234、L4063-4097。
- R.* L2318-2325、E.prominent L2326-2328、S.* L2330 起；overlay 组件（hostSkillsChip/SkillsTabChip/SessionSkillsSection）位于 L3673+。
- 最终工作区状态以 `git status` 实时核查为准（存在用户并发写入）。

---

## 后续任务：continue-offer 改用 dsh-flash info 告警弹窗（2026-11-12）

**目标**：按用户要求把「是否开启自动继续」的询问从自定义 React modal 换成复用 `dshFlashAlerts` 注册表的**信息级告警**弹窗。

**方案（用户已确认）**：provider 注入 —— context alert 提供者的 `poll()` 在读到一个对本会话、未武装的 pending continue-offer 时，push 一条 info 告警（id `ctx-auto-continue-offer-<at>`，🔁，dismissible），复用 dsh-flash 的 toast/detail 弹窗；两个 action 按钮「开启自动继续」「暂不」完成选择后清 pending 并立即 re-poll 撤下告警。

**已完成**
- [x] `createSessionContextProvider.poll()` 注入 offer 告警及两个 action（enable→`armAutoRetry()`；decline→记录冷却 `_continuePromptAt[sid]=now`）。
- [x] 新增闭包辅助 `_flushOfferPoll()`（清 timer + 立即 re-poll）与按引用保存的 bridge handler `_promptHandler`；provider `start()` 安装、`stop()` 按身份清空。
- [x] token source 暴露 `getSessionId()`；`_reset()` 清空 `_continuePromptPending`（会话切换不泄漏旧 offer）。
- [x] **完全移除** `ContinuePromptModal` / `CONTINUE_BTN` / `openContinuePrompt` / `closeContinuePrompt` / `_continuePromptRoot` / `_continuePromptHost` 及对应接线（`_applyInner`、`dispose`）。
- [x] `_maybePromptAutoRetry` guards/冷却语义零改动；bridge/pending 保留为数据层→provider 通道；常驻指示器未动。
- [x] 三门口令通过：`tsc --noEmit`、`vitest --pool=threads`（80/80）、`build-client.mjs`（bundle 含新逻辑、无已删符号）。
- [x] 更新 progress.md / CHANGELOG.md；不改用户 ` M` 文件。

**待办**
- [ ]（如需要）GUI 浏览器验证 info 告警 toast/detail 弹窗实际渲染与「开启/暂不」互动。

---

### 后续任务（已取代上一条）：继续词直接武装，移除询问/确认（用户最新要求）

**目标**：按用户最新要求 —— **只要用户手动输入 继续 / continue / resume 等消息，就自动打开自动继续模式，不再弹窗让用户再次点击确认**。上一条「把询问从自定义 modal 换成 dsh-flash info 告警」本身也随之失去意义：**根本没有询问了**。

**方案（用户确认）**：`_maybePromptAutoRetry` 改为 `_autoArmOnContinue` 直接调用 `_armAutoRetry()`（武装幂等；调用点仍先短路已武装会话）；`_matchesContinueWord` 增补 `resume` / `res`；询问/确认整套管线（bridge / pending / cooldown / offer 告警块及其两 action / `_flushOfferPoll` / `_promptHandler` / 各清理点 / `continuePrompt*` i18n）**全量移除**，避免陈旧代码再度弹出对话框。

**已完成**
- [x] `_matchesContinueWord` 增 `resume`/`res`；`_autoArmOnContinue` 直接武装。
- [x] 移除 `_continuePromptBridge`/`_continuePromptPending`/`_continuePromptAt`/`CONTINUE_PROMPT_COOLDOWN_MS`、`_armAutoRetry` 回收块、provider poll offer 告警块及两 action、`_flushOfferPoll`/`_promptHandler`、provider start/stop 接线、`_reset`/`_applyInner`/`dispose` pending 清理、`continuePrompt*` i18n（zh+en）。
- [x] 三门口令通过：`tsc --noEmit`、`vitest --pool=threads`（94/94）、`build-client.mjs`（bundle 含 `_autoArmOnContinue`/`resume`，无残留符号）。
- [x] 更新 README×2 / CHANGELOG / progress / 本文件；不改用户 ` M` 文件。

**待办**
- [ ]（如需要）GUI 浏览器验证未武装会话输入「继续」即刻开启且无确认弹窗。

---

## 后续任务：退出告警带定位 + 人工输入不再退出自动继续（2026-11-14）

**目标**：按用户要求改两处 —— ①「已退出自动继续」info 告警展示工作区 + 会话信息便于定位；② 检测到人工输入不再作为退出自动继续的条件。

**方案（用户确认）**：`_noteAutoRetryExit` 退出时经 `_sessionWorkspace(sid)` 解析 cwd 存入 `_autoRetryExitedPending.workspace`；provider poll 的 exited 告警 message 用 `autoRetryExitedLocate` 追加 `（会话 <sid>，工作区 <cwd>）` 后缀。`_handleUserMessage` 非自身回显分支删除 `_disarmAutoRetry('human')`，守卫保持 armed。

**已完成**
- [x] i18n：zh/en 新增 `autoRetryExitedLoc*` 定位键；删除 `autoRetryExitedReasonHuman`。
- [x] `autoRetryExitedReasonKey`/`AUTO_RETRY_EXIT_REASONS` 移除 `'human'`。
- [x] `autoRetryExitedLocate()` + `_sessionWorkspace()` + `_noteAutoRetryExit` 带 workspace + provider 告警 message 拼装后缀。
- [x] `_handleUserMessage` 人工输入不再 disarm。
- [x] 同步 docs/auto-retry-integration-design.zh-CN.md + README×2。
- [x] 三门口令通过：`tsc --noEmit`、`vitest --pool=threads`（94/94）、`build-client.mjs`（bundle 含新逻辑、无已删符号）。

**待办**
- [ ]（如需要）提交本轮改动；GUI 浏览器验证退出告警定位后缀。

---

## 后续任务：快捷面板「自动继续」开关完善（位置/图标/配置按钮/主开关显隐）（2026-11-14）

**目标**：按用户多轮反馈完善「自动继续」开关（`dsh-flash-ctx-mon:auto-continue`）。
根因：① `visible: _getRunnerActive()` 只在 auto-retry 运行时才渲染开关行；② `icon: 'refresh'`
不在 dsh-flash monochrome 字形集 `_ICON_PATHS` 内，`_switchIcon` 对未知名字回退渲染字面量文本。
后续用户又要求：③ 放到 弹窗通知 开关下面；④ 去掉多余 ⚙ 配置按钮；⑤ 系统告警总开关关闭时隐藏。
收敛方案：图标用 `scroll`；`order: 62`（落在 Toast(order 61) 之下、主机滑杆 80/81 之上）；
不提供 `config`；`visible: () => _getAlertsOn()`（随系统告警总开关显隐，与上下文监控一致，
但**不**按 runner 激活态显隐 —— 停止时仍可见、可一键再武装）。

**已完成**
- [x] `src-client/factory-body.js`：`icon: 'refresh'` → `'scroll'`；`order: 60` → `62`；
      `config` 字段删除；`visible: true` → `visible: () => _getAlertsOn()`；
      `getValue` 仍用 `_getRunnerActive()`。
- [x] `node scripts/build-client.mjs` 重建 `lib/client.js`（183.2kb）：bundle 内 `icon: "scroll"`、
      `order: 62`、自动继续无 `config`、`visible` 读 `_getAlertsOn()`，无陈旧残留。
- [x] 同步 README.md / README.zh-CN.md 开关章节、progress.md。

**待办**
- [ ] `npx tsc --noEmit`、`npx vitest run --pool=threads`、bundle grep 复核（本轮已跑：tsc 0、
      94/94、无残留）；GUI 浏览器验证快捷面板系统告警下顺序为 系统告警 → 上下文监控 → 弹窗通知 →
      自动继续（无 ⚙ 按钮、图标 scroll），且系统告警总开关关闭时自动继续整行隐藏、重开后随之出现。

---

## 后续任务：正常结束不再解除守卫（移除 settled 退出条件）（用户最新要求）

**目标**：按用户要求**去掉正常结束这个退出条件**。用户经 `ask_user_question` 确认：**方案 1「改为：正常结束也自动继续」+ 选项 (A)「仅已武装会话」** —— 已武装会话的回合正常收尾**保持武装**、继续待命补发（不 disarm、不弹退出告警）；未武装会话的回合正常收尾**保持未武装**（不会被被动武装，输入继续词入口保留）。

**方案（用户确认）**：与移除询问管线一致，采用**全量删除** settled 退出路径，不留下可复活的陈旧代码：
- `_handleTurnEnd`：retryable → `_armAutoRetry()`；settled → 已武装会话跳过 re-arm 直落统一尾部继续待命、未武装会话直接 `return`（不 disarm、不被动武装）；统一尾部收敛 `remaining<=0` 冻结 `paused`（`_noteAutoRetryExit('budget')`）或 `_scheduleAutoRetryEmit()`。
- `AUTO_RETRY_EXIT_REASONS` → `['manual','budget']`（删 `'settled'`）；`autoRetryExitedReasonKey` 删 settled 分支（防御性回退 budget 文案，结构性不可达）；删除 `autoRetryExitedReasonSettled`（zh+en）。
- 守卫护栏仍在：连续预算默认 4 次冻结 `paused` 等人 + 面板手动「停止」彻底关闭 —— 非无限无人空转。

**已完成**
- [x] `_handleTurnEnd` 重写、`AUTO_RETRY_EXIT_REASONS`/`autoRetryExitedReasonKey`/i18n settled 清理。
- [x] `build-client.mjs` 重建（183.1kb）：bundle 含新 `_handleTurnEnd`，退出场景 `settled`/`autoRetryExitedReasonSettled`/`_maybePromptAutoRetry`/`_continuePrompt*` 零残留（`unsettled` 指示器与删除内容无关）。
- [x] 同步 README×2 / CHANGELOG / docs design / findings / progress / 本文件；不改用户 ` M` 文件。

**待办**
- [ ] 三门口令通过（本轮已跑：`tsc --noEmit` exit 0、`vitest --pool=threads` 94/94、bundle grep 复核）；GUI 浏览器验证已武装会话跑一个正常回合后自动继续保持开启。

---

## 后续任务：去掉手动「停止自动继续」的退出告警（仅保留 budget 告警）（用户最新要求）

**目标**：用户看到退出告警「已按你的操作停止自动继续（会话 …，工作区 …）」后认为**没信息量**，要求去掉这条告警。经 `ask_user_question` 确认：**仅 manual（推荐）** —— 只去掉手动停止的 🔁 info 弹窗，**budget（连续补发达上限 → paused）**告警保留（它发生在无任何用户操作时，被告知才有意义）。

**边界（必须保留）**：手动「停止自动继续」本身照常**关闭守卫** —— 只是不再弹退出 info 提醒。

**方案（用户确认）**：`AUTO_RETRY_EXIT_REASONS` 收敛为 `['budget']`，让 `_noteAutoRetryExit('manual')` 在入口即 return（静默）；`autoRetryExitedReasonKey` 收敛为单分支恒返回 `autoRetryExitedReasonBudget`；删除 `autoRetryExitedReasonManual` i18n（zh+en）。

**已完成**
- [x] `src-client/factory-body.js`：`AUTO_RETRY_EXIT_REASONS` → `['budget']`（注释说明手动停止为显式动作、静默站下）；`autoRetryExitedReasonKey` 单分支；删除 `autoRetryExitedReasonManual`（zh+en）；更新 `_noteAutoRetryExit` / `_disarmAutoRetry` / 快速开关 manual-off 注释。
- [x] `node scripts/build-client.mjs`（182.8kb）与 `npm run build` 均 exit 0：bundle 含 `AUTO_RETRY_EXIT_REASONS=["budget"]` / `autoRetryExitedReasonBudget`，无 `autoRetryExitedReasonManual` / 中英「已按你的操作停止自动继续 / Stopped by your action」残留。
- [x] 同步 README×2（退出告警段落：仅 budget 弹告警带定位、手动停止不弹）、CHANGELOG、docs/auto-retry-integration-design.zh-CN.md（§5 5b 修订）、progress、本文件；不改用户 ` M` 文件。

**待办**
- [ ] 三门口令通过（本轮已跑：`tsc --noEmit` exit 0、`vitest --pool=threads` 94/94、bundle grep 无残留）；GUI 浏览器验证：点「停止自动继续」不再弹 🔁 退出告警，连续补发达上限仍弹（budget + 定位后缀）。

---

## 后续任务：允许把被预算挂起(paused)的会话重新开启自动继续（用户最新要求）

**背景**：用户问「**已中断状态会话为什么无法开启自动继续模式**」（观察「开关打不开」）。诊断结论——
`interrupted` 本身属于「可重试结束」（`error/interrupted/max-tokens`），**不是**被它拦下；真正拦路的是
**连续预算耗尽冻结到 `paused`**：该记录仍 `armed: true`、`remaining<=0`，而旧 `_armAutoRetry` 只在
`!rec.armed` 时才重新播种预算 → 开关 / 继续词对 paused 均为静默空操作，且 resident `armDisabled` 对
paused/stopped 一律禁用 → 一旦暂停无路可回。

**经 `ask_user_question` 确认方案（推荐）**：**允许把已暂停(paused)的会话重新武装** ——
**显式用户动作**（快捷「自动继续」开关拨开、resident「立即武装」按钮、或裸继续词入口）调用
`_armAutoRetry(true)`：对 `armed && paused` 记录清除 `paused`/`pending`/`backoffLevel`/`cooldownUntil`
并把 `remaining` 重新播种为新的 `autoRetryMaxConsecutive`；护栏保留 —— 内部路径（`_handleTurnEnd`
可重试结束自动再武装、重绑按持久化偏好恢复）**不带 force**，故被挂起会话不会自行复活。

**已完成**
- [x] `src-client/factory-body.js`：`_armAutoRetry(force)` 新增 paused 再武装分支；公共 `armAutoRetry`
      与 `_autoArmOnContinue` 带 `force=true`；`armDisabled` 改为 stopped/paused 可点「立即武装」、
      仅 无view/source、scheduled、已armed且有预算 时禁用。
- [x] `node scripts/build-client.mjs`（183.7kb）exit 0：bundle 含 `force && rec.paused` 再武装分支、
      新 `armDisabled`、`_armAutoRetry(true)`。
- [x] 同步 CHANGELOG / README×2 / docs design（§5 新增 5c）/ progress / 本文件；不改用户 ` M` 文件。

**待办**
- [ ] 三门口令通过（本轮已跑：`tsc --noEmit` exit 0、`vitest --pool=threads` 94/94、build exit 0）；
      GUI 浏览器验证：预算烧尽挂起的会话拨「自动继续」开关（或点「立即武装」）→ 红色 paused 回到绿色
      待命并继续自动补发；未武装/已武装正常会话行为不变。
