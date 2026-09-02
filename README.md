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

## v0.1.0 第一阶段目标

**优先完成“大纲 + 草案”阶段，并达到可以直接本地安装、直接使用的状态。**

排版阶段整体进入 `v0.2.0`。v0.1.0 可以保留“排版”入口，但排版正式能力不阻塞第一阶段发布。

## 当前权威文件

1. [Report Studio v0.1.0 MVP 基线](docs/architecture/report-studio-mvp-baseline-v0.1.0.md)
2. [Report Studio v0.1.0 本地安装与部署说明](docs/deployment/report-studio-v0.1.0-local-deployment.md)
3. [Report Studio v0.1.0 整合 Review](docs/review/report-studio-ui-architecture-integration-review-v0.1.0.md)
4. [Report Studio v0.1.0 开发 Handoff](docs/handoff/2026-09-02-report-studio-mvp-v0.1.0-handoff.md)

历史 `v1.0.1` 整合文件已标记为 `Superseded`，不得再作为实施依据。

## v0.1.0 必须可直接使用的能力

### 大纲

- 新建、修改、删除大纲节点；
- 层级与顺序调整；
- Stable ID；
- Agent 生成 / 修改；
- 大纲批注与 ReviewRound。

### 草案

- 稳定 `pageId`；
- 页面切换；
- heading / text / list；
- 讲解稿；
- 本页素材基础引用；
- 人工直接编辑；
- 页面 / 内容块批注；
- Agent 生成 / 修改。

### Agent / 批注 / 数据

```text
ReviewRound / reviewRoundId
├─ ReviewSubmission #1
├─ ReviewSubmission #2
└─ ReviewSubmission #N
```

同一批注轮次可以持续补充并多次 `提给Agent`；每次 Submission 历史不可变。Agent 返回不自动等于问题解决。

同时必须具备：

```text
DSH Harness
Proposal
Revision
ProjectHead
Persistence
Restart Recovery
baseRevision Conflict Protection
```

## v0.1.0 主闭环

```text
新建项目
→ 编辑大纲
→ Agent 协助修改
→ 稳定 pageId
→ 编辑草案 heading/text/list/讲解稿
→ 添加批注并自动保存
→ ReviewRound + Submission #1
→ DSH Agent
→ Proposal
→ 用户接受
→ Revision
→ 同一 ReviewRound 补充问题
→ Submission #2
→ 再次 Agent 处理
→ 用户 resolved
→ 重启后完整恢复
```

## v0.2.0

排版第二阶段处理：

```text
LayoutPageDocument
OpenPencil / Layout Adapter
元素拖拽与样式
sourceRef
live / detached / orphaned
草案 ↔ 排版同步
布局渲染与排版输出
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
   ├─ deployment/
   ├─ handoff/
   ├─ review/
   └─ spikes/
```

## 本地部署

开发 Agent、本地开发人员和验收人员统一从以下文件开始：

```text
docs/deployment/report-studio-v0.1.0-local-deployment.md
```

该文件负责给出：环境检查、安装、启动、DSH 绑定、数据目录、测试、E2E、本地验收和故障定位步骤。实现过程中任何部署方式改变都必须同步更新该文件。

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
- v0.1.0 不以排版完成为发布条件；
- 本地安装部署说明必须与可运行代码保持同步。
