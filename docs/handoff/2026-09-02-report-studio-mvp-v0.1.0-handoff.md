# Report Studio v0.1.0 MVP 开发 Handoff

## 当前状态

```text
Repository: ArchitectureWorld/presentation-tools
Branch: integration/report-studio-mvp-v0.1.0
Current Version: v0.1.0
Status: ready-for-contract-and-vertical-slice-development
```

历史 UI 原型 `v0.8.1` 与历史架构基线 `v1.0.0` 仅作为来源，不代表当前版本。

当前通用平台不处理 `pre-design` 接入。

## 权威文件

1. `docs/architecture/report-studio-mvp-baseline-v0.1.0.md`
2. `docs/review/report-studio-ui-architecture-integration-review-v0.1.0.md`
3. 本 Handoff
4. `tools/report-studio/` 历史 UI 原型，仅作交互回归参考

发生冲突时，以 `report-studio-mvp-baseline-v0.1.0.md` 为最高实施权威。

## 已冻结产品行为

- 大纲 → 草案 → 排版三阶段；
- 公共工作台外壳；
- 固定右侧批注栏；
- 大纲整份作用域，草案/排版按页作用域；
- 草案内容人工编辑；
- 本页素材；
- 项目级悬浮 Agent；
- 普通聊天与批注任务最终进入同一当前 DSH Session；
- Agent 返回不自动完成批注；
- 同一批注轮次可持续补充，并多次 `提给Agent`。

## 批注正式模型

```text
ReviewRound                         用户看到的一轮
├─ reviewRoundId                    稳定
├─ ReviewSubmission #1              不可变
├─ ReviewSubmission #2              不可变
└─ ReviewSubmission #N
```

```text
Annotation lifecycle = draft | submitted
Resolution           = open | resolved
ReviewRun             = created | delivered | result_linked | failed_to_deliver
```

同一轮未解决完时，只新增下一次 ReviewSubmission，不创建新的用户可见 Round。

## 正式实现不得继承的 Mock 做法

- localStorage 作为业务真源；
- 原型 JavaScript State 作为 Canonical Model；
- round.commentIds 作为历史提交真源；
- Timer / Regex 模拟 Agent；
- Data URL 作为正式素材存储；
- 命名规则代替稳定 sourceRef；
- UI 直接写正式状态；
- Agent 直接覆盖正式 Project State。

## 目标代码结构

```text
apps/studio-dev-harness
packages/studio-contracts
packages/studio-core
packages/studio-storage
packages/studio-dsh-plugin
packages/studio-ui
packages/studio-testkit
```

## 开发顺序

### PR-01 Contracts

- pnpm workspace；
- stable branded IDs；
- Canonical Schema；
- Annotation / ReviewRound / ReviewSubmission Schema；
- Proposal / Revision / ProjectHead Schema；
- Command v0.1；
- `studio_get_context` / `studio_apply_commands` Tool Schema；
- Typed Errors；
- Contract tests。

### PR-02 Core

- ChangeSet 原子应用；
- Command 风险分类；
- canonicalization / stateHash；
- ReviewRound / Submission 领域规则；
- sourceRef live / detached / orphaned；
- Domain tests。

### PR-03 Storage

- ControlStore；
- ObjectStore `putVerified()`；
- ProjectHead CAS；
- Annotation 自动保存；
- ReviewSubmission immutable publish；
- 重启、幂等、故障注入。

### PR-04 DSH

- 工作台入口；
- 当前 Session 绑定；
- ReviewSubmission 投递；
- 两个 Studio Tool；
- ReviewRun / Proposal / Tool Event 关联。

### PR-05 UI

按历史原型保真迁移到 React：

- Studio Shell；
- 三阶段；
- 批注栏与历史 Round；
- 草案编辑；
- 本页素材；
- 悬浮 Agent；
- Proposal / Candidate 预览。

### PR-06 Revision + Layout

- Proposal 接受；
- Snapshot / ChangeSet / RevisionRecord；
- Head CAS；
- LayoutPageDocument；
- live sourceRef 同步。

### PR-07 MVP 验收

- 重启恢复；
- stale revision；
- 同一 Round 至少两次 Submission；
- 浏览器 E2E；
- 冻结 Revision HTML / PNG 导出。

## v0.1.0 主验收链

```text
编辑大纲
→ 稳定 pageId
→ 编辑 heading/text/list
→ 添加批注
→ draft 自动保存
→ ReviewRound + Submission #1
→ DSH Agent
→ Proposal
→ 用户接受
→ Revision + ProjectHead CAS
→ live Layout 同步
→ 同一 ReviewRound 补充意见
→ Submission #2
→ 再次 Agent 处理
→ 用户 resolved
→ 冻结 Revision 导出
```

只有这条真实链路跑通，才算 `v0.1.0` MVP 核心完成。

## 暂缓

- pre-design；
- 多人协同 / CRDT；
- 动画 / 时间线；
- 跨页批量重组；
- 页面拆分 / 合并 / 删除 Agent 通用权限；
- 高保真 PPTX 导入；
- 元素级高保真 PPTX 导出；
- 项目素材永久删除；
- 模板 / 插件市场。
