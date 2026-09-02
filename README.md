# Presentation Tools

面向专业汇报生产流程的通用 Report Studio 仓库。

## 当前版本

```text
Report Studio v0.1.0
```

这是 UI 原型与整体架构完成整合后的唯一当前版本号。

历史来源：

- UI 原型 `v0.8.1`：仅作为交互与视觉回归基线；
- 架构基线 `v1.0.0`：仅作为历史架构来源；
- 二者都不再代表当前产品版本。

当前 MVP 不依赖 `pre-design`。

## 当前权威文件

1. [Report Studio v0.1.0 MVP 基线](docs/architecture/report-studio-mvp-baseline-v0.1.0.md)
2. [Report Studio v0.1.0 整合 Review](docs/review/report-studio-ui-architecture-integration-review-v0.1.0.md)
3. [Report Studio v0.1.0 开发 Handoff](docs/handoff/2026-09-02-report-studio-mvp-v0.1.0-handoff.md)

历史 `v1.0.1` 整合文件已标记为 `Superseded`，不得再作为实施依据。

## 产品基线

Report Studio `v0.1.0` 保留以下已经稳定的产品行为：

- 大纲 → 草案 → 排版三阶段；
- 公共工作台外壳；
- 固定右侧批注栏；
- 页面级批注作用域；
- 草案人工编辑；
- 本页素材；
- 排版交互；
- 项目级悬浮 Agent；
- 同一批注轮次可以持续补充并多次 `提给Agent`；
- Agent 返回不自动等于批注完成。

## 批注正式模型

```text
ReviewRound / reviewRoundId          稳定用户轮次
├─ ReviewSubmission #1              不可变提交
├─ ReviewSubmission #2              不可变提交
└─ ReviewSubmission #N
```

这样既保留 UI 中“还是这一轮”的连续体验，又保证每次提交的 `baseRevision`、批注快照、Agent 执行、Proposal 与 Revision 都可独立审计和恢复。

## v0.1.0 MVP 主闭环

```text
大纲
→ 稳定 pageId
→ 草案 heading/text/list
→ draft 批注自动保存
→ ReviewRound + ReviewSubmission
→ DSH Harness
→ studio_get_context / studio_apply_commands
→ Proposal
→ Revision + ProjectHead CAS
→ live Layout 同步
→ 同一 ReviewRound 再次提交
→ resolved
→ 冻结 Revision HTML / PNG 导出
```

## 正式代码目标结构

```text
presentation-tools/
├─ apps/
│  └─ studio-dev-harness/
├─ packages/
│  ├─ studio-contracts/
│  ├─ studio-core/
│  ├─ studio-storage/
│  ├─ studio-dsh-plugin/
│  ├─ studio-ui/
│  └─ studio-testkit/
├─ tools/
│  └─ report-studio/          # 历史 UI 原型与回归参考
└─ docs/
   ├─ architecture/
   ├─ handoff/
   ├─ review/
   └─ spikes/
```

## 历史 UI 原型

原型仍可用于视觉和交互回归：

```text
tools/report-studio/dist/report-studio-prototype-v0.8.1.html
```

但 `tools/report-studio/` 不再继续扩建为正式业务核心。正式 MVP 必须重新建立 TypeScript Canonical Contracts、稳定 ID、Command、Proposal、Revision、ProjectHead、Storage 与 DSH Adapter。

## 实施边界

- DSH Harness 是唯一 Agent / Model Runtime；
- Report Studio 拥有 Canonical Model；
- UI 不直接写存储；
- Agent 不直接覆盖 Project State；
- 每次 ReviewSubmission 历史不可变；
- 草案与排版通过稳定 `sourceRef` 同步；
- 最终导出只读取冻结正式 Revision。
