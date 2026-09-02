---
document_id: report-studio-mvp-integration-baseline
status: implementation-authority
version: 1.0.1
ui_prototype_version: 0.8.1
architecture_source_version: 1.0.0
mvp_product_version: 0.1.0
updated_at: 2026-09-02
repository: ArchitectureWorld/presentation-tools
---

# Report Studio MVP 整合实施基线 v1.0.1

## 0. 文件定位

本文件是 UI 原型 `v0.8.1` 与架构基线 `v1.0.0` 进入 MVP 开发前的**冲突裁决与实施权威文件**。

规则优先级：

1. 本文件明确修订或裁决的内容；
2. `architecture/report-studio-mvp-baseline-v1.0.0` 中的冻结架构规则；
3. `main` 中 `Report Studio v0.8.1` 的产品交互与视觉行为；
4. 历史 handoff、审查包和过程分支。

本文件只解决整合冲突和 MVP 落地边界，不重新复制全部架构细节。

---

## 1. 产品边界

### 1.1 当前只建设通用 Report Studio

MVP 当前不依赖 `ArchitectureWorld/pre-design`，也不需要映射其业务状态、Gate、合同或专用报告流程。

Report Studio 是独立的通用汇报生产平台，核心只处理：

```text
Project
├─ Outline
├─ PageManifest
├─ DraftPageDocument
├─ PageAsset / Asset
├─ LayoutPageDocument
├─ Annotation / ReviewRound / ReviewSubmission
├─ Proposal / ChangeSet
├─ Revision / ProjectHead
└─ Export
```

前期策划、BIM 汇报、论文答辩等未来只能以模板、规则包或业务 Adapter 接入，不得反向定义核心模型。

### 1.2 DSH 仍是唯一 Agent Harness

Report Studio 不自建模型路由、Agent Loop、子 Agent 系统或独立凭据体系。

项目级悬浮 Agent、普通聊天、批注提交都必须最终进入当前绑定的 DSH Session / Harness。

---

## 2. UI 原型的权威范围

以下行为以 `Report Studio v0.8.1` 为产品验收基线，MVP 迁移时不得无理由改变：

- 大纲 → 草案 → 排版三阶段；
- 三阶段共用公共外壳和固定右侧批注栏；
- 大纲按整份大纲形成批注作用域；
- 草案、排版按 `stage + pageId` 隔离批注作用域；
- 草案内容可人工编辑；
- 本页素材与项目素材概念分离；
- 排版元素可选择、移动并接受批注；
- 项目级悬浮 Agent 跨页面、跨阶段连续存在；
- 普通聊天与批注提交在同一个项目级会话时间线中可追溯；
- 同一批注轮次允许后续继续补充意见并再次“提给Agent”；
- Agent 返回结果不自动等于批注已完成；
- 完成/未完成由用户实际确认问题是否解决。

`tools/report-studio/` 在 MVP 开发期间视为**只读产品原型基线**，正式代码不继续堆叠在 `prototype/app.js` 或 `src/studio-model.js` 中。

---

## 3. 关键整合修订：批注轮次模型

### 3.1 结论

采用 UI 原型的产品语义：

> 一个用户认知中的“轮次”可以持续存在；Agent 第一次没有把全部问题处理到位时，用户可以在同一轮次继续补充、编辑未完成问题并再次提交。

同时保留架构对不可变历史、审计、幂等和恢复的要求。

因此正式领域模型调整为：

```text
ReviewRound / ReviewThread        ← 用户看到的稳定“这一轮”
├─ reviewRoundId                  ← 稳定，不因再次提交而变化
├─ scopeKey
├─ stage / pageId
├─ open/resolved 状态
├─ 当前可编辑 draftAnnotations
├─ ReviewSubmission #1            ← 每次“提给Agent”产生一个不可变提交
│  └─ immutable ReviewBatchSnapshot
├─ ReviewSubmission #2
│  └─ immutable ReviewBatchSnapshot
└─ ReviewSubmission #N
   └─ immutable ReviewBatchSnapshot
```

### 3.2 ReviewRound

`ReviewRound` 是 UI 与领域共同认可的稳定容器：

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

- 首次对当前“本轮未提交”点击 `提给Agent` 时创建 `reviewRoundId`；
- 后续补充意见仍挂在同一个 `reviewRoundId`；
- `reviewRoundId` 不因为 Agent 再次处理而变化；
- 整个轮次只有在用户明确认为问题全部解决时才进入 `resolved`；
- 历史轮次可重新打开或继续补充，但不能修改已发生的历史 Submission Snapshot。

### 3.3 ReviewSubmission / ReviewBatchSnapshot

每一次 `提给Agent` 都创建新的不可变提交：

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

约束：

- `submissionNumber` 在同一 `reviewRoundId` 内从 1 单调增加；
- 每次 Submission 固定当时的 `baseRevision`、批注版本、目标与内容；
- 已提交的 Snapshot 永不原地修改；
- Agent 执行失败时幂等重投同一 Submission，不创建重复业务提交；
- 用户新增或修改意见后再次提交，创建下一号 Submission；
- DSH `ReviewRun`、Proposal、Tool Call 与 Revision 必须关联到具体 `reviewSubmissionId`，同时保留 `reviewRoundId` 便于 UI 汇总。

### 3.4 与 v0.8.1 字段的迁移映射

```text
prototype roundId          → reviewRoundId
prototype submissionId     → reviewSubmissionId
prototype submissionNumber → submissionNumber
prototype round.commentIds → 运行时 UI 投影，不作为不可变历史真源
```

正式实现不得继续把可变 `commentIds` 列表当成历史 Submission 内容；历史由 Annotation Snapshot 冻结。

---

## 4. 批注状态拆分

原型中的 `staged / submitted / responded / completed` 混合了生命周期、Agent 执行状态和问题解决状态。正式实现拆成三个正交维度：

### 4.1 Annotation lifecycle

```text
draft | submitted
```

- `draft`：当前轮次中可继续编辑，已自动持久化；
- `submitted`：至少已经进入一个不可变 ReviewSubmission Snapshot。

同一条业务意见若再次修改，应产生新的 annotationVersion；旧 Submission 仍保留旧 Snapshot。

### 4.2 Resolution state

```text
open | resolved
```

这是 UI 中“未完成 / 已完成”的真实来源。

Agent 返回、Proposal 生成或 Revision 提交都不会自动将其改为 `resolved`。

### 4.3 ReviewRun integration state

```text
created | delivered | result_linked | failed_to_deliver
```

Agent 运行中的更细状态仍以 DSH Session / Turn / Tool Event 为准，不在 Studio 再复制一套 Agent 状态机。

---

## 5. Canonical Model 与稳定 ID

正式 MVP 必须重新建立 TypeScript contracts，不直接升级原型的 JavaScript State。

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

禁止使用：

- 数组下标；
- DOM 顺序；
- “第几段”自然语言位置；
- 编辑器私有 JSON Path；
- OpenPencil/Tiptap 内部节点 ID 作为跨模块主键。

---

## 6. 正式内容修改链

所有正式内容修改统一经过：

```text
UI / DSH Agent
→ Domain Command
→ Schema / ID / Scope / baseRevision / Risk 校验
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
- Agent 直接覆盖整页 JSON；
- Agent 直接修改 React State 后当成正式结果；
- Head 在 Snapshot durable publish 前前移；
- Candidate 未接受就用于正式导出。

---

## 7. 草案与排版

### 7.1 事实源

- 草案：页面语义内容事实源；
- LayoutPageDocument：视觉几何、样式、层级事实源；
- Tiptap / OpenPencil：可替换 Adapter；
- HTML / PNG / PDF / PPTX：导出派生物。

### 7.2 sourceRef

正式排版同步使用稳定 `sourceRef`，不再依赖 `layout-${pageId}-title` 等命名约定。

```text
live      与同页草案 / PageAsset 保持内容同步
 detached 用户明确解除语义绑定
 orphaned 原源对象失效，需要人工处理
```

同步内容不得静默覆盖 `x/y/width/height/rotation/style/zIndex`。

---

## 8. 存储基线

沿用架构 `v1.0.0` 的两层结构：

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
├─ immutable ReviewSubmission / ReviewBatch Snapshot
├─ Candidate Snapshot
├─ 原始素材
└─ 冻结导出包
```

MVP 必须通过真实 Spike 验证 DSH Storage Provider 的单记录原子更新和重启恢复；未经验证前，不把某个具体 Provider 当作不可替换领域事实。

---

## 9. DSH 集成

第一版只要求建立稳定边界：

```text
Studio UI
→ Studio Application API
→ DshStudioAdapter
→ 当前 DSH Session / Harness
```

首批 Studio Tool：

```text
studio_get_context
studio_apply_commands
```

普通悬浮 Agent 聊天和 ReviewSubmission 投递进入同一个项目 Session 时间线，但二者语义不同：

- 普通聊天是对话；
- ReviewSubmission 是可追踪结构化任务；
- 真正业务修改只能由 Studio Command Gateway 落地。

---

## 10. MVP 第一条纵向闭环

第一版只要可靠打通以下完整链路即可宣称 MVP 基础闭环完成：

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
→ 正式 Revision + ProjectHead CAS
→ live 排版内容同步且几何不变
→ 若问题未解决，在同一 reviewRoundId 补充批注
→ submission #2
→ 再次处理
→ 用户最终标记 round resolved
→ 从冻结 Revision 导出 HTML / PNG
```

---

## 11. MVP 暂缓

第一版暂缓：

- `pre-design` 业务接入；
- 高保真 PPTX 导入；
- 元素级高保真 PPTX 导出；
- 多人实时协作 / CRDT；
- 动画、时间线、复杂转场；
- 跨页批量重组；
- 页面拆分、合并、删除的 Agent 通用权限；
- 项目素材永久物理删除；
- 完整模板市场和插件市场。

OpenPencil 若 Spike 不通过，只替换 LayoutAdapter；不能阻塞 Canonical Layout 和完整纵向闭环。

---

## 12. 建议正式仓库结构

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
│  └─ report-studio/           # v0.8.1 只读产品原型
└─ docs/
   ├─ architecture/
   ├─ handoff/
   ├─ review/
   └─ spikes/
```

---

## 13. 版本体系

从 MVP 开始分离不同版本概念：

```text
UI Prototype Version       0.8.1
Architecture Integration   1.0.1
MVP Product Version        0.1.0
Contract Version           0.1.0
Storage Schema Version     1
```

`0.8.1` 只代表冻结交互原型，不再作为正式产品全部层级的唯一版本号。

---

## 14. 合并门禁

任何正式 MVP PR 必须至少满足与其层级对应的：

- Contract tests；
- TypeScript typecheck；
- Domain tests；
- Storage crash / recovery tests；
- DSH integration tests；
- Browser E2E；
- 构建验证。

不得再以静态截图、Mock Agent 回复或单文件 HTML 能打开作为 MVP 完成证据。

---

## 15. 本次整合裁决摘要

```text
DECISION-001  当前通用平台不接 pre-design。
DECISION-002  UI v0.8.1 是交互与视觉行为基线。
DECISION-003  同一用户批注轮次可持续补充和再次提交。
DECISION-004  每次“提给Agent”产生新的不可变 ReviewSubmission Snapshot。
DECISION-005  roundId 演进为 reviewRoundId；submissionId 演进为 reviewSubmissionId。
DECISION-006  “完成/未完成”从 Annotation 生命周期中拆为 resolutionState。
DECISION-007  DSH Harness 仍是唯一 Agent Runtime。
DECISION-008  正式代码重新建立 TypeScript Canonical Contracts，不扩建 Mock State。
DECISION-009  草案—排版同步改用稳定 sourceRef。
DECISION-010  MVP 先打一条完整纵向闭环，再横向扩功能。
```
