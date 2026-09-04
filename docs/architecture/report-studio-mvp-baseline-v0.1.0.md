---
document_id: report-studio-mvp-baseline
status: historical-implementation-reference
version: 0.1.0
updated_at: 2026-09-02
repository: ArchitectureWorld/presentation-tools
---

# Report Studio MVP 基线 v0.1.0

> 本文件仅保留为 v0.1.0 历史实现参考，不是当前产品基线。Report Studio v0.1.1 当前为 candidate / stabilization-required；唯一架构母文件为 `docs/architecture/report-studio-architecture.md`，本轮实现设计为 `docs/superpowers/specs/2026-09-03-report-studio-v0.1.1-stabilization-design.md`。

## 0. 版本规则

从本次 UI × 架构整合开始，当前开发成果统一使用：

```text
Report Studio Version: v0.1.0
```

不再分别使用“架构 1.0.1 / MVP 0.1.0 / 整合版本 1.0.1”等并列版本号。

历史 UI 原型 `v0.8.1` 与历史架构分支 `v1.0.0` 只作为来源和追溯记录，不代表当前产品版本。

后续任何正式开发文档、合同、包、Handoff 和 Release 在未明确升级前均以 `v0.1.0` 为当前版本。

---

## 1. 当前产品边界

当前只建设**通用 Report Studio**。

本轮 MVP 不依赖 `ArchitectureWorld/pre-design`，不映射其业务状态、Gate、合同或专用报告流程。

未来前期策划、BIM 汇报、论文答辩等通过模板、规则包或业务 Adapter 接入，不得反向定义通用核心。

核心范围：

```text
Project
├─ Outline
├─ PageManifest
├─ DraftPageDocument
├─ Asset / PageAsset
├─ LayoutPageDocument
├─ Annotation / ReviewRound / ReviewSubmission
├─ Proposal / ChangeSet
├─ Revision / ProjectHead
└─ Export
```

DSH Harness 仍是唯一 Agent / Model Runtime。Report Studio 不自建第二套 Agent Loop、模型路由、子 Agent 调度或凭据体系。

---

## 2. UI 行为基线

历史 UI 原型 `v0.8.1` 仅作为 `v0.1.0` 的交互来源。以下行为正式继承到 `v0.1.0`：

- 大纲 → 草案 → 排版三阶段；
- 三阶段共用公共外壳；
- 固定右侧批注栏；
- 大纲按整份大纲形成批注作用域；
- 草案、排版按 `stage + pageId` 隔离批注；
- 草案内容可人工编辑；
- 本页素材与项目素材概念分离；
- 排版元素可选择、移动、批注；
- 项目级悬浮 Agent 跨阶段、跨页面持续存在；
- 普通聊天和批注任务最终进入同一个当前 DSH Session；
- Agent 返回不自动等于批注完成；
- 同一批注轮次允许持续补充并多次 `提给Agent`。

`tools/report-studio/` 作为历史原型和回归参考保留，不继续扩建其 JavaScript Mock State。

---

## 3. 批注轮次：最终语义

以 UI 原型的用户体验为准：

> Agent 一次没有处理完当前轮所有问题时，用户继续在同一轮补充和修改未解决问题，再次提交，不被迫创建新的用户可见轮次。

正式模型：

```text
ReviewRound                         用户认知中的稳定轮次
├─ reviewRoundId                    始终不变
├─ draftAnnotations                当前可编辑意见
├─ ReviewSubmission #1              第一次提交，不可变
│  └─ Annotation Snapshots
├─ ReviewSubmission #2              第二次提交，不可变
│  └─ Annotation Snapshots
└─ ReviewSubmission #N
```

### 3.1 ReviewRound

```ts
interface ReviewRound {
  reviewRoundId: ReviewRoundId
  projectId: ProjectId
  scopeKey: ScopeKey
  stage: 'outline' | 'draft' | 'layout'
  pageId?: PageId
  status: 'open' | 'resolved'
  createdAt: string
  updatedAt: string
}
```

规则：

- 首次提交当前“本轮未提交”时创建 `reviewRoundId`；
- 后续补充意见继续属于相同 `reviewRoundId`；
- Agent 返回、Proposal 生成、Revision 提交均不会自动关闭轮次；
- 只有用户明确确认问题全部解决时，轮次变为 `resolved`；
- 已发生的 Submission 永远不能原地修改。

### 3.2 ReviewSubmission

```ts
interface ReviewSubmission {
  reviewSubmissionId: ReviewSubmissionId
  reviewRoundId: ReviewRoundId
  submissionNumber: number
  baseRevision: number
  annotationSnapshots: AnnotationSnapshot[]
  requestedExecutionMode: 'review_then_commit' | 'direct_commit'
  createdAt: string
}
```

规则：

- 每点击一次 `提给Agent`，创建新的 `ReviewSubmission`；
- `submissionNumber` 在同一轮次中单调递增；
- 每次提交固定当时的 `baseRevision`、批注版本、目标和内容；
- 投递失败时幂等重试同一个 Submission；
- 新增或修改意见后再次提交，创建下一号 Submission；
- ReviewRun、Proposal、Tool Call、Revision 必须关联具体 `reviewSubmissionId`，同时保留 `reviewRoundId` 供 UI 汇总。

历史原型字段迁移：

```text
roundId          → reviewRoundId
submissionId     → reviewSubmissionId
submissionNumber → submissionNumber
```

---

## 4. 批注状态拆分

正式 `v0.1.0` 不再使用 `staged / responded / completed` 混合表达所有状态。

### Annotation lifecycle

```text
draft | submitted
```

### Resolution

```text
open | resolved
```

UI 中“已完成 / 未完成”读取 `resolution`。

Agent 返回、Proposal 生成或 Revision 生效都不自动设置 `resolved`。

### ReviewRun integration

```text
created | delivered | result_linked | failed_to_deliver
```

真正 Agent Turn / Step / Tool 状态以 DSH Session 事件为准。

---

## 5. Canonical Model 与稳定 ID

正式 MVP 重新建立 TypeScript contracts，不把原型 JavaScript State 升级为生产事实源。

最低稳定 ID：

```text
projectId
outlineNodeId
pageId
contentBlockId
listItemId
scriptBlockId
assetId
pageAssetId
layoutPageId
layoutElementId
annotationId
reviewRoundId
reviewSubmissionId
reviewRunId
proposalId
changeSetId
commandId
revisionId
```

禁止使用数组下标、DOM 顺序、自然语言位置、编辑器 JSON Path、Tiptap/OpenPencil 私有节点 ID 作为跨模块业务主键。

---

## 6. 正式修改链

```text
UI / DSH Agent
→ Domain Command
→ Schema / Stable ID / Scope / baseRevision / Risk 校验
→ ChangeSet
→ Candidate Snapshot
→ Proposal
→ 用户确认或授权 direct_commit
→ durable publish Snapshot / ChangeSet / RevisionRecord
→ ProjectHead CAS
→ 新 Revision 正式可见
```

禁止：

- UI 直接写数据库；
- Agent 直接覆盖整页 / 整项目 JSON；
- Agent 返回直接改正式 React State；
- Snapshot 未 durable publish 即前移 ProjectHead；
- 未接受 Candidate 进入正式导出。

---

## 7. 草案与排版

事实源：

- `DraftPageDocument`：页面语义内容；
- `LayoutPageDocument`：视觉几何、样式与层级；
- Tiptap / OpenPencil：可替换 Adapter；
- HTML / PNG / PDF / PPTX：导出派生物。

草案—排版同步使用稳定 `sourceRef`：

```text
live      与同页草案 / PageAsset 保持内容绑定
 detached 用户显式解除绑定
 orphaned 源对象已失效，需要人工处理
```

同步内容不得覆盖排版的 `x/y/width/height/rotation/style/zIndex`。

---

## 8. 存储与 Revision

逻辑采用两层结构：

```text
StudioControlStore
├─ ProjectHeadRecord
├─ WorkspaceViewStateRecord
├─ AnnotationDraftScopeRecord
├─ ReviewRoundControlRecord
├─ ReviewRunRecord
├─ ProposalControlRecord
└─ IdempotencyRecord

StudioObjectStore
├─ Canonical Snapshot
├─ Accepted ChangeSet
├─ RevisionRecord
├─ immutable ReviewSubmission Snapshot
├─ Candidate Snapshot
├─ 原始素材
└─ 冻结导出包
```

正式提交必须遵守：

```text
不可变对象先 durable publish
→ 最后以 baseRevision CAS 更新 ProjectHead
```

Provider 的具体实现必须经过真实 Spike；具体数据库或文件后端不是领域事实。

---

## 9. DSH 集成

```text
Studio UI
→ Studio Application API
→ DshStudioAdapter
→ 当前 DSH Session / Harness
```

首批工具：

```text
studio_get_context
studio_apply_commands
```

普通悬浮 Agent 聊天与 ReviewSubmission 进入同一当前项目 Session 时间线；但正式业务修改只能通过 Studio Command Gateway 落地。

---

## 10. v0.1.0 MVP 唯一主闭环

```text
打开 Report Studio
→ 编辑大纲
→ 生成稳定 pageId
→ 编辑 heading / text / list
→ 对 contentBlock 添加批注
→ draft 自动保存并可重启恢复
→ 首次提交创建 reviewRoundId + submission #1
→ DSH Harness 读取冻结上下文
→ Agent 调用 Studio Tool
→ 生成 Proposal
→ 用户接受
→ Revision + ProjectHead CAS
→ live 排版同步且几何不变
→ 若问题未解决，在同一 reviewRoundId 补充批注
→ submission #2
→ 再次处理
→ 用户最终标记 resolved
→ 从冻结 Revision 导出 HTML / PNG
```

只有这条链真实跑通，才算 `v0.1.0` MVP 核心闭环成立。

---

## 11. v0.1.0 暂缓

- `pre-design`；
- 多人实时协作 / CRDT；
- 动画、时间线、复杂转场；
- 跨页批量重组；
- 页面拆分、合并、删除的 Agent 通用权限；
- 高保真 PPTX 导入；
- 元素级高保真 PPTX 导出；
- 项目素材永久物理删除；
- 模板市场 / 插件市场。

OpenPencil Spike 失败时更换 LayoutAdapter，不允许阻断 Canonical Layout 和主闭环。

---

## 12. 正式仓库结构

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
│  └─ report-studio/          # 历史 UI 原型
└─ docs/
   ├─ architecture/
   ├─ handoff/
   ├─ review/
   └─ spikes/
```

---

## 13. 合并门禁

正式 MVP PR 根据涉及层级至少执行：

- Contract tests；
- TypeScript typecheck；
- Domain tests；
- Storage crash / recovery tests；
- DSH integration tests；
- Browser E2E；
- Build verification。

静态截图、Mock Agent 回复或单文件 HTML 可打开，不再构成 MVP 完成证据。

---

## 14. 当前裁决

```text
VERSION=v0.1.0
PRE_DESIGN_DEPENDENCY=none
UI_BEHAVIOR_SOURCE=historical-prototype-v0.8.1
REVIEW_ROUND=stable-round-with-multiple-immutable-submissions
AGENT_RUNTIME=DSH-only
CANONICAL_MODEL=Studio-owned
STATUS=ready-for-contract-and-vertical-slice-development
```
