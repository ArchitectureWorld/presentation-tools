# Presentation Tools

面向专业汇报生产流程的通用 Report Studio 仓库。

## 当前状态

仓库已经从“UI 原型验证”进入“UI × 架构整合并启动 MVP 开发”阶段。

```text
UI Prototype Version       0.8.1
Architecture Integration   1.0.1
Target MVP Product Version 0.1.0
Contract Version           0.1.0（待实现）
Storage Schema Version     1（待实现）
```

当前 MVP **不依赖 `pre-design`**。前期策划等业务未来只通过模板、规则包或业务 Adapter 接入，不进入通用核心。

## 当前权威入口

1. [MVP 整合实施基线](docs/architecture/report-studio-mvp-integration-baseline-v1.0.1.md)
2. [MVP 整合开发 Handoff](docs/handoff/2026-09-02-report-studio-mvp-integration-handoff.md)
3. [UI × 架构整合 Review](docs/review/report-studio-ui-architecture-integration-review-v1.0.1.md)
4. [Report Studio v0.8.1 UI 原型 Handoff](docs/handoff/2026-09-02-report-studio-v0.8.1-handoff.md)

## UI 原型

| 工具 | 版本 | 状态 | 入口 |
|---|---:|---|---|
| Report Studio 三阶段交互原型 | `0.8.1` | 冻结产品/交互基线；Mock Adapter | [`tools/report-studio/`](tools/report-studio/) |

原型验证：

- 大纲 → 草案 → 排版三阶段；
- 固定右侧批注栏；
- 页面级批注作用域；
- 历史批注轮次持续补充和多次 `提给Agent`；
- 草案人工编辑；
- 本页素材；
- 排版交互；
- 项目级悬浮 Agent。

直接体验：

```text
tools/report-studio/dist/report-studio-prototype-v0.8.1.html
```

`tools/report-studio/` 后续作为**只读产品原型和回归基线**。正式 MVP 不继续扩建其中的 JavaScript Mock State。

## 批注正式语义

本轮整合明确以 UI 原型的用户体验为准：Agent 一次没有解决完全部问题时，用户可以继续在同一个轮次补充并再次提交。

正式模型：

```text
ReviewRound / reviewRoundId          稳定用户轮次
├─ ReviewSubmission #1              不可变提交快照
├─ ReviewSubmission #2              不可变提交快照
└─ ReviewSubmission #N
```

```text
prototype roundId          → reviewRoundId
prototype submissionId     → reviewSubmissionId
prototype submissionNumber → submissionNumber
```

这样同时保留：

- UI 中“还是这一轮”的连续体验；
- 每次提交不可变；
- 每次 Agent 执行可审计；
- `baseRevision`、幂等、恢复和 Proposal/Revision 可准确关联。

## MVP 目标

第一版不横向铺满所有高级功能，优先打通一条真实纵向闭环：

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
→ 同一 ReviewRound 可再次提交
→ resolved
→ 冻结 Revision HTML / PNG 导出
```

## 目标仓库结构

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
│  └─ report-studio/          # v0.8.1 UI 原型
└─ docs/
   ├─ architecture/
   ├─ handoff/
   ├─ review/
   └─ spikes/
```

## 原型验证

原型仍可执行：

```bash
cd tools/report-studio
npm test
npm run build
npm run verify:release
npm run verify:browser
```

当前 `v0.8.1` 发布版本元数据仍由以下文件共同约束：

1. `tools/report-studio/VERSION`
2. `tools/report-studio/package.json`
3. `tools/report-studio/release-manifest.json`
4. 单文件 HTML `report-studio-build` 元数据
5. 原型 Release Notes 与 Handoff

这些规则只管理冻结原型发布，不等同于 MVP 产品版本。

## 实施边界

正式 MVP 必须遵守：

- DSH Harness 是唯一 Agent / Model Runtime；
- Report Studio 拥有 Canonical Model、稳定 ID、Command、Proposal、Revision 和 ProjectHead；
- UI 不直接写存储；
- Agent 不直接覆盖 Project State；
- 每次 ReviewSubmission 都保留不可变 Snapshot；
- 草案与排版通过稳定 `sourceRef` 同步；
- 最终导出只读取冻结正式 Revision。
