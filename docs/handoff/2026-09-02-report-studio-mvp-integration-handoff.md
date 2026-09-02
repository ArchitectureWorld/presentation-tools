# Report Studio MVP 整合开发 Handoff

## 1. 当前结论

仓库已经从“UI 原型”和“架构设计”两条相对独立路线进入正式整合阶段。

当前实施基线：

```text
Repository: ArchitectureWorld/presentation-tools
Integration Branch: integration/report-studio-mvp-v0.1.0
UI Prototype: 0.8.1
Architecture Integration Baseline: 1.0.1
Target MVP Product Version: 0.1.0
```

当前通用平台**不处理 `pre-design` 接入**。任何前期策划专用状态、Gate、合同或 57 项业务映射都不进入本轮 MVP 范围。

## 2. 必须先读

1. `docs/architecture/report-studio-mvp-integration-baseline-v1.0.1.md`
2. `docs/handoff/2026-09-02-report-studio-v0.8.1-handoff.md`
3. `tools/report-studio/README.md`
4. 架构历史基线：`architecture/report-studio-mvp-baseline-v1.0.0`

发生冲突时，以 `report-studio-mvp-integration-baseline-v1.0.1.md` 的明确裁决为准。

## 3. 不得重新讨论的产品基线

- 大纲 → 草案 → 排版三阶段；
- 三阶段使用同一公共工作台外壳；
- 固定右侧批注栏；
- 草案和排版按页隔离批注作用域；
- 草案内容支持人工编辑；
- 本页素材支持展示、预览和引用；
- 项目级悬浮 Agent 跨阶段、跨页面连续存在；
- 普通聊天和批注提交最终进入同一 DSH 项目 Session；
- Agent 返回不自动等于批注已完成；
- 同一批注轮次允许继续补充问题并再次提交。

## 4. 批注模型最终语义

原型的 UI 体验保留，但正式数据模型改为：

```text
ReviewRound                         用户看到的“这一轮”
├─ reviewRoundId                    稳定
├─ draft annotations                可继续补充
├─ ReviewSubmission #1              不可变
│  └─ ReviewBatch Snapshot
├─ ReviewSubmission #2              不可变
│  └─ ReviewBatch Snapshot
└─ ...
```

迁移映射：

```text
roundId          → reviewRoundId
submissionId     → reviewSubmissionId
submissionNumber → submissionNumber
```

一轮没有改完时，不新建一个用户可见的外层轮次；而是在相同 `reviewRoundId` 下新增下一次 `ReviewSubmission`。

完成状态与生命周期分开：

```text
Annotation lifecycle: draft | submitted
Resolution:           open | resolved
ReviewRun:            created | delivered | result_linked | failed_to_deliver
```

## 5. 正式实现不能继承的原型内部做法

以下只能作为演示实现，不得进入生产核心：

- 把整个 Studio State 写入 `localStorage`；
- `staged/responded/completed` 混合状态；
- `round.commentIds` 作为历史事实；
- 通过命名规则寻找排版元素同步文字；
- 悬浮 Agent 使用内存数组和定时器模拟回复；
- UI 直接把 Agent 结果写回业务 State；
- Data URL 作为正式素材存储；
- 继续扩建单体 `prototype/app.js`。

`tools/report-studio/` 后续只保留为产品原型与回归参考。

## 6. 正式 MVP 仓库目标

```text
apps/studio-dev-harness
packages/studio-contracts
packages/studio-core
packages/studio-storage
packages/studio-dsh-plugin
packages/studio-ui
packages/studio-testkit
```

依赖边界：

```text
studio-contracts → 不依赖 UI / DSH / DB
studio-core      → 只依赖 contracts
studio-storage   → 实现 repository/provider，不做业务决策
studio-ui        → 只调用 application API / adapter
studio-dsh-plugin→ 唯一允许绑定 DSH Host / Client API 的包
studio-testkit   → fixture + fault injection
```

## 7. 开发顺序

### PR-01：整合与机器合同

- 建 pnpm workspace；
- 建 `studio-contracts`、`studio-testkit`；
- Stable ID branded types；
- Canonical Schema；
- ReviewRound / Annotation / ReviewSubmission Schema；
- Proposal / Revision / ProjectHead Schema；
- Typed errors；
- Tool contract v0.1；
- Contract tests。

### PR-02：纯领域核心

- ChangeSet 原子应用；
- Command 风险分类；
- sourceRef 正向同步和反向回写；
- ReviewRound / Submission 领域规则；
- canonicalization + stateHash；
- Domain tests。

### PR-03：存储 Spike + Provider

- ControlStore 原子单记录更新；
- ObjectStore `putVerified()`；
- ProjectHead CAS；
- Annotation draft 自动保存；
- ReviewSubmission durable publish；
- 重启恢复、幂等和 crash injection。

### PR-04：DSH Spike

- Workspace 入口；
- 当前 Session 绑定；
- `studio_get_context`；
- `studio_apply_commands`；
- ReviewSubmission → ReviewRun → Proposal 关联；
- Session / Tool Event 可追溯。

### PR-05：React UI 保真迁移

按 v0.8.1 还原：

- Studio Shell；
- 三阶段；
- 批注栏；
- ReviewRound 历史；
- 草案人工编辑；
- 本页素材；
- 悬浮 Agent；
- Candidate / Proposal 预览。

### PR-06：Revision + Layout Sync

- Proposal 接受；
- Snapshot / ChangeSet / RevisionRecord；
- Head CAS；
- LayoutPageDocument；
- `live / detached / orphaned`；
- 保持几何不变的内容同步。

### PR-07：MVP 验收

- 重启恢复；
- stale revision；
- 幂等重复提交；
- 浏览器 E2E；
- 冻结 Revision HTML / PNG 导出；
- 完整纵向场景验证。

## 8. 第一版主验收场景

```text
编辑大纲
→ 生成稳定 pageId
→ 编辑草案 heading/text/list
→ 对 block 批注
→ 自动保存
→ reviewRound + submission #1
→ DSH Agent 处理
→ Proposal
→ 用户接受
→ Revision
→ Layout live 同步
→ 发现仍未完全解决
→ 同一个 reviewRound 补充批注
→ submission #2
→ 再次 Agent 处理
→ 用户最终 resolved
→ 冻结 Revision 导出
```

这条链真实跑通，才算第一版 MVP 的核心闭环成立。

## 9. 明确暂缓

- `pre-design`；
- 多人协同；
- 动画 / 时间线；
- 跨页批量重组；
- 通用页面拆分 / 合并 / 删除；
- 高保真 PPTX 导入；
- 元素级高保真 PPTX 导出；
- 项目素材物理永久删除；
- 模板市场。

## 10. 完成定义

MVP 不能再用“UI 看起来能运行”作为完成标准。至少必须证明：

- Canonical Contract 可机械校验；
- stable ID 跨重启不变；
- draft 批注可恢复；
- 同一 ReviewRound 可完成两次以上 Submission；
- 每个 Submission 历史不可变；
- DSH Harness 真实参与；
- Agent 只能在允许范围通过 Command 写入；
- Proposal 与正式 Revision 分离；
- Head CAS 冲突不会覆盖新内容；
- live 排版同步不破坏几何和样式；
- 导出只读取冻结 Revision。
