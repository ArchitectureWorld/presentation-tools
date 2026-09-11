# Report Studio v0.1.0 MVP 开发 Handoff

> **historical-reference**：此文件只描述 v0.1.0 当时状态，不是当前版本、发布状态或部署说明。请改读 `2026-09-03-report-studio-v0.1.1-stabilization-handoff.md`。

## 当前状态

```text
Repository: ArchitectureWorld/presentation-tools
Branch: integration/report-studio-mvp-v0.1.0
Current Version: v0.1.0
Status: ready-for-outline-draft-implementation
```

历史 UI 原型 `v0.8.1` 与历史架构基线 `v1.0.0` 仅作为来源，不代表当前版本。当前通用平台不处理 `pre-design` 接入。

## v0.1.0 当前目标

**以最快速度完成“大纲 + 草案”阶段，使其可以直接投入实际使用。**

排版阶段整体后移到 `v0.2.0`。v0.1.0 顶部可以保留“排版”入口，但允许显示为第二阶段功能，不得因为排版尚未开发阻塞 v0.1.0 发布。

## 权威文件

1. `docs/architecture/report-studio-mvp-baseline-v0.1.0.md`
2. `docs/deployment/report-studio-v0.1.0-local-deployment.md`
3. `docs/review/report-studio-ui-architecture-integration-review-v0.1.0.md`
4. 本 Handoff
5. `tools/report-studio/` 历史 UI 原型，仅作交互回归参考

发生冲突时，以架构基线为最高实施权威；安装、启动和本地验收以 Deployment 文档为准。

## v0.1.0 必须直接可用的能力

### 大纲

- 新建、编辑、删除大纲节点；
- 一级/二级层级调整；
- 顺序调整；
- 稳定 `outlineNodeId`；
- Agent 生成/修改大纲；
- 大纲批注与 ReviewRound；
- 从大纲建立稳定页面关系。

### 草案

- 稳定 `pageId`；
- 页面切换；
- heading / text / list；
- 讲解稿；
- 本页素材基础引用；
- 人工直接编辑；
- 内容块/页面批注；
- Agent 生成、修改和补充草案。

### 批注与 Agent

```text
ReviewRound                         用户看到的一轮
├─ ReviewSubmission #1              不可变
├─ ReviewSubmission #2              不可变
└─ ReviewSubmission #N
```

同一轮未解决完时，不创建新的用户可见 Round，只新增下一次 ReviewSubmission。

```text
Annotation lifecycle = draft | submitted
Resolution           = open | resolved
ReviewRun             = created | delivered | result_linked | failed_to_deliver
```

Agent 返回不自动等于批注完成；只有用户确认问题解决后才进入 `resolved`。

### 可直接使用所必须的底层

- Stable IDs；
- Canonical Contracts；
- DSH 当前 Session；
- `studio_get_context` / `studio_apply_commands`；
- Proposal；
- Revision；
- ProjectHead；
- 正式持久化；
- 重启恢复；
- `baseRevision` 冲突保护；
- 基础浏览器 E2E。

## 正式实现不得继承的 Mock 做法

- localStorage 作为业务真源；
- 原型 JavaScript State 作为 Canonical Model；
- round.commentIds 作为历史提交真源；
- Timer / Regex 模拟 Agent；
- Data URL 作为正式素材存储；
- UI 直接写正式状态；
- Agent 直接覆盖正式 Project State；
- 继续扩建单体 `prototype/app.js`。

## v0.1.0 目标代码结构

```text
apps/studio-dev-harness
packages/studio-contracts
packages/studio-core
packages/studio-storage
packages/studio-dsh-plugin
packages/studio-ui
packages/studio-testkit
```

`studio-ui` 在 v0.1.0 只需完整实现 Outline + Draft；Layout 只保留边界和后续入口。

## 最快开发顺序

### PR-01：最小 Contracts + Testkit

- pnpm workspace；
- stable branded IDs；
- Outline / Page / Draft Canonical Schema；
- Annotation / ReviewRound / ReviewSubmission Schema；
- Proposal / Revision / ProjectHead Schema；
- Command v0.1 最小字段；
- 两个 Studio Tool Schema；
- Typed Errors；
- Contract tests。

### PR-02：Outline + Draft Core

- 大纲树操作；
- 大纲 → pageId；
- Draft heading/text/list/script；
- ReviewRound / Submission 规则；
- ChangeSet 原子应用；
- canonicalization / stateHash；
- Domain tests。

### PR-03：Storage + Recovery

- ControlStore；
- ObjectStore；
- ProjectHead CAS；
- draft 批注自动保存；
- ReviewSubmission immutable publish；
- Revision；
- 重启、幂等、故障注入。

### PR-04：DSH 闭环

- 当前 Session 绑定；
- ReviewSubmission 投递；
- `studio_get_context`；
- `studio_apply_commands`；
- ReviewRun / Proposal / Tool Event 关联；
- 普通悬浮 Agent 聊天复用同一 Session。

### PR-05：React Outline + Draft 保真迁移

按历史 UI 原型保留体验：

- Studio Shell；
- 大纲阶段；
- 草案阶段；
- 页面导航；
- 固定右侧批注栏；
- 历史 ReviewRound；
- 草案人工编辑；
- 本页素材；
- 悬浮 Agent；
- Proposal / Candidate 预览。

### PR-06：v0.1.0 实用化验收

- 大纲/草案完整 E2E；
- 同一 Round 至少两次 Submission；
- DSH 真实 Agent 闭环；
- 重启恢复；
- stale revision；
- 本地安装部署说明实机校验。

### v0.2.0：排版阶段

- LayoutPageDocument；
- OpenPencil / Layout Adapter；
- 元素拖拽与视觉样式；
- sourceRef；
- live / detached / orphaned；
- 草案 ↔ 排版同步；
- 排版输出深化。

## v0.1.0 主验收链

```text
新建项目
→ 编辑大纲
→ Agent 协助修改大纲
→ 大纲节点建立稳定 pageId
→ 编辑草案 heading/text/list/讲解稿
→ 添加批注
→ draft 自动保存
→ ReviewRound + Submission #1
→ DSH Agent
→ Proposal
→ 用户接受
→ Revision + ProjectHead CAS
→ 发现问题未完全解决
→ 同一 ReviewRound 补充意见
→ Submission #2
→ 再次 Agent 处理
→ 用户 resolved
→ 关闭并重启
→ 项目、大纲、草案、Revision、批注和历史 Submission 全部恢复
```

只有这条真实链路跑通，才算 `v0.1.0` 第一阶段完成。

## 安装部署要求

本地安装和部署必须遵循：

```text
docs/deployment/report-studio-v0.1.0-local-deployment.md
```

该文件必须随实现持续更新。任何 PR 如果改变 Node/pnpm、启动命令、环境变量、数据目录、DSH 插件安装方式、Storage Provider 或测试命令，都必须同步修改 Deployment 文档。

目标是让新的开发 Agent 克隆仓库后能够按照一个文件完成：

```text
环境检查
→ 安装
→ 启动
→ DSH 绑定
→ 测试
→ 本地验收
→ 故障定位
```

## 暂缓

- 排版正式能力（进入 v0.2.0）；
- pre-design；
- 多人协同 / CRDT；
- 动画 / 时间线；
- 跨页批量重组；
- 页面拆分 / 合并 / 删除 Agent 通用权限；
- 高保真 PPTX 导入；
- 元素级高保真 PPTX 导出；
- 项目素材永久删除；
- 模板 / 插件市场。
