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
