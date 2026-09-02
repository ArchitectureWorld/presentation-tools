# Report Studio UI × 架构整合 Review v1.0.1

## 1. 结论

本轮针对 `main` 中 UI 原型 `v0.8.1` 与 `architecture/report-studio-mvp-baseline-v1.0.0` 架构基线进行冲突裁决后，结论为：

**PASS WITH RESOLVED CONFLICTS：可以进入 MVP 实施。**

本次整合不再处理 `pre-design`，并正式采用 UI 原型的“同一批注轮次可持续补充、多次提交”语义。

## 2. 已解决冲突

### 2.1 通用平台与 `pre-design` 耦合

问题：旧 UI Handoff / DSH 集成文档曾把 `pre-design` 现有业务状态、Gate 和合同当成第一轮正式接入对象；通用平台架构则要求业务模板不得反向定义核心。

裁决：

```text
当前 MVP = 通用 Report Studio only
pre-design = 暂缓，未来通过业务 Adapter / Template 接入
```

结果：**已解决**。

### 2.2 Round 与 immutable ReviewBatch 冲突

问题：UI 原型允许同一 `roundId` 持续补充、再次提交；架构旧表述偏向每次新增意见形成新 ReviewBatch，导致 UI 用户心智与不可变审计模型冲突。

裁决：

```text
ReviewRound = 稳定用户轮次
ReviewSubmission = 每次提交
ReviewBatch Snapshot = 每次提交冻结不可变快照
```

因此：

```text
一个 ReviewRound
可以包含 N 个 ReviewSubmission
每个 Submission 都有独立 baseRevision 和不可变批注 Snapshot
```

结果：**已解决**。

### 2.3 批注状态混用

问题：原型的 `staged / submitted / responded / completed` 同时表达保存、Agent 处理和人工完成状态；正式架构只有 `draft / submitted`。

裁决：拆为：

```text
Annotation lifecycle = draft | submitted
Resolution           = open | resolved
ReviewRun             = created | delivered | result_linked | failed_to_deliver
```

结果：**已解决**。

### 2.4 草案到排版的同步实现

问题：原型通过排版元素命名规则硬编码同步；正式架构要求稳定 `sourceRef`。

裁决：保留 UI 行为，替换实现为：

```text
Draft / PageAsset
→ stable sourceRef
→ LayoutElement
```

并保留 `live / detached / orphaned`。

结果：**已解决**。

### 2.5 Agent 窗口与真正 Harness

问题：原型悬浮 Agent 是前端内存时间线 + 模拟回复。

裁决：保留完整交互外观和时间线体验；正式 MVP 所有普通聊天与 ReviewSubmission 均绑定同一个当前 DSH Session。业务修改只能走 Studio Command Gateway。

结果：**已解决**。

## 3. 明确保留的 UI 行为

以下不再作为架构争议项：

- 三阶段公共外壳；
- 固定右侧批注栏；
- 页面级作用域；
- 批注历史轮次；
- 历史轮次继续补充；
- 同一轮多次 `提给Agent`；
- Agent 返回不自动完成批注；
- 草案人工编辑；
- 本页素材；
- 项目级悬浮 Agent；
- 聊天与批注任务进入同一项目级时间线；
- 排版同步时不破坏视觉几何。

## 4. 明确废弃的原型内部实现

- `localStorage` 整包业务真源；
- JavaScript 单体 State 作为正式 Canonical Model；
- `round.commentIds` 作为历史提交真源；
- 模拟 Agent Timer / Regex 作为生产能力；
- Data URL 作为项目素材正式存储；
- 通过排版元素命名约定进行跨阶段绑定；
- UI 直接修改正式业务数据；
- Agent 返回直接写 Project State。

## 5. 仍需 Spike 验证但不再阻塞架构方向

### DSH Workspace

需验证：

- 独立工作台容器 / 路由；
- 焦点、键盘、滚动、Modal 层级；
- 当前 Session 稳定绑定方式。

### DSH Review Dispatch

需验证：

- ReviewSubmission 投递；
- Session 消息关联；
- Tool Call / ReviewRun / Proposal 关联；
- 中断与重投。

### Storage

需验证：

- 当前可用 Storage Provider；
- 单记录原子 update；
- ProjectHead CAS；
- 重启恢复；
- 幂等重复请求；
- crash windows。

### Layout Provider

需验证 OpenPencil 或替代 Provider：

- 16:9 Frame；
- 中文文本；
- 稳定元素映射；
- Canonical Layout 重建；
- 渲染输出。

Provider Spike 失败时只替换 Adapter / Provider，不推翻 Canonical Model、ReviewRound、ReviewSubmission、Revision 与 ProjectHead 语义。

## 6. MVP 准入门槛

现在允许开始：

```text
studio-contracts
→ studio-core
→ storage / DSH spike
→ React UI 保真迁移
→ Proposal / Revision
→ live Layout Sync
→ Export
```

以下行为仍应阻断合并：

- Studio 自建第二套 Agent Runtime；
- UI 直接写数据库；
- Agent 使用整页覆盖；
- Submission 历史可被原地修改；
- 同一 round 再次提交覆盖第一次 Submission；
- 不带 `baseRevision` 的正式 Agent 修改；
- Snapshot 未 durable publish 即前移 Head；
- Candidate 未接受即进入正式导出；
- 只靠截图或 Mock 回复宣称 MVP 完成。

## 7. 最终状态

```text
ui_baseline=0.8.1
architecture_integration=1.0.1
mvp_target=0.1.0
pre_design_dependency=none_for_current_mvp
review_round_semantics=stable_round_with_multiple_immutable_submissions
status=ready_for_contract_and_vertical-slice-development
```
