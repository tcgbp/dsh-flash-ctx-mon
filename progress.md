# 进度日志

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
