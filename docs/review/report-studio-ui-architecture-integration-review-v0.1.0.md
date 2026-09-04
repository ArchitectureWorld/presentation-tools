# Report Studio UI × 架构整合 Review v0.1.0

> **historical-reference**：此 Review 只记录 v0.1.0 当时裁定；其中 PASS 不能用于描述当前 v0.1.1。请改读 `2026-09-03-report-studio-v0.1.1-review-blockers-resolution.md`。

## 1. 结论

本轮完成 UI 原型与整体架构的冲突裁决后，当前统一版本为：

```text
Report Studio v0.1.0
```

结论：**PASS WITH RESOLVED CONFLICTS，可进入 MVP 实施。**

历史 UI 原型 `v0.8.1` 和历史架构基线 `v1.0.0` 仅作为来源与追溯记录，不再作为当前版本号。

## 2. 已解决冲突

### 2.1 通用平台与 pre-design

当前 `v0.1.0` 不依赖 `pre-design`。未来通过业务 Adapter / Template 接入。

### 2.2 Round 与不可变历史

保留 UI 原型“同一轮可以持续补充、多次提交”的体验，同时将每一次提交冻结为不可变 Submission：

```text
ReviewRound
├─ ReviewSubmission #1
├─ ReviewSubmission #2
└─ ReviewSubmission #N
```

`ReviewRound` 稳定，`ReviewSubmission` 每次新建。

### 2.3 批注状态

正式拆分：

```text
Annotation lifecycle = draft | submitted
Resolution           = open | resolved
ReviewRun             = created | delivered | result_linked | failed_to_deliver
```

### 2.4 草案—排版同步

保留原型体验，但正式实现改用稳定 `sourceRef`，支持 `live / detached / orphaned`，不再依赖排版元素命名约定。

### 2.5 Agent

保留悬浮 Agent 和连续时间线；正式 `v0.1.0` 必须绑定当前 DSH Session / Harness，不保留第二套 Agent Runtime。

## 3. 保留的产品行为

- 大纲 → 草案 → 排版；
- 公共外壳；
- 固定右侧批注栏；
- 页面级批注作用域；
- 历史轮次持续补充；
- 同一轮多次 `提给Agent`；
- Agent 返回不自动完成批注；
- 草案人工编辑；
- 本页素材；
- 项目级悬浮 Agent；
- 聊天与批注任务进入同一项目 Session 时间线；
- 排版同步不破坏视觉几何。

## 4. 废弃的原型内部实现

- `localStorage` 整包业务真源；
- JavaScript 单体 State 作为 Canonical Model；
- `round.commentIds` 作为历史提交真源；
- Regex / Timer Mock Agent；
- Data URL 正式素材存储；
- 排版元素命名规则作为跨阶段绑定；
- UI 直接修改正式业务数据；
- Agent 返回直接覆盖 Project State。

## 5. 仍需实现级验证

### DSH Workspace

验证工作台容器、当前 Session、焦点、键盘、滚动和 Modal 层级。

### Review Dispatch

验证 ReviewSubmission → Session → Tool Call → ReviewRun → Proposal 的真实链路与幂等重投。

### Storage

验证单记录原子 update、ProjectHead CAS、重启恢复、幂等与 crash windows。

### Layout Provider

验证 OpenPencil 或替代 Provider 的 16:9、中文、稳定映射、Canonical 重建与渲染。

Provider 验证失败只更换 Adapter / Provider，不推翻核心领域语义。

## 6. v0.1.0 准入结论

允许开始：

```text
studio-contracts
→ studio-core
→ storage / DSH spikes
→ React UI 保真迁移
→ Proposal / Revision
→ live Layout Sync
→ frozen Revision export
```

阻断项：

- Studio 自建第二套 Agent Runtime；
- UI 直接写数据库；
- Agent 整页覆盖；
- Submission 历史可原地修改；
- 同一 Round 再提交覆盖上一 Submission；
- 正式修改不带 `baseRevision`；
- Snapshot 未 durable publish 即前移 Head；
- Candidate 未接受进入正式导出；
- 仅以截图或 Mock 回复宣称 MVP 完成。

## 7. 最终状态

```text
version=v0.1.0
pre_design_dependency=none
ui_source=historical-v0.8.1
architecture_source=historical-v1.0.0
review_round_semantics=stable-round-with-multiple-immutable-submissions
status=ready-for-contract-and-vertical-slice-development
```
