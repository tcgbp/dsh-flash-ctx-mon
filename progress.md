# 进度日志

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
