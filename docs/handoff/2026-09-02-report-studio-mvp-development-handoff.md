---
document_id: report-studio-mvp-development-handoff
name: Report Studio MVP 开发交接文件
status: ready-for-implementation
version: 1.0.0
architecture_baseline: 1.0.0
updated_at: 2026-09-02
language: zh-CN
repository: ArchitectureWorld/presentation-tools
target_branch: architecture/report-studio-mvp-baseline-v1.0.0
handoff_owner: architecture
next_owner: implementation
---

# Report Studio MVP 开发交接文件

> 本文件用于将已经冻结的 Report Studio 架构交付给下一位开发者或开发 Agent。接手者不需要重新讨论产品定位、三阶段关系、DSH Harness 职责、批注机制、Agent 读写边界、Revision 或存储原则；应先完成本文规定的技术 Spike 和最小纵向闭环，再扩展功能。

## 1. 交付结论

当前架构基线 **允许开始 MVP 开发**。

本项目是通用、按页组织的汇报内容生产与排版平台，不是“前期策划”专用插件。前期策划、BIM 汇报、技术方案、论文答辩等只能作为上层模板或能力包接入，不能侵入核心领域模型。

MVP 必须打通以下真实闭环：

```text
OutlineNode
→ 稳定 PageManifest / pageId
→ 结构化 DraftPageDocument
→ 批注自动保存到 AnnotationDraftScopeRecord
→ 冻结 ReviewBatch
→ DSH Harness 驱动 Agent 调用 Studio 工具
→ Proposal / Candidate Snapshot
→ 接受或授权 direct_commit
→ 不可变 RevisionRecord + Canonical Snapshot
→ ProjectHead 原子前移
→ live Layout 投影自动同步
```

只完成三张静态 UI、假批注卡片或前端本地状态切换，不属于“最小架构基线验收”。

## 2. 权威文件与阅读顺序

1. `docs/architecture/report-studio-architecture.md`  
   唯一架构母文件，版本 `1.0.0`，所有已稳定规则的最高权威来源。
2. `docs/handoff/2026-09-02-report-studio-mvp-development-handoff.md`  
   当前文件，负责把架构转化为开发顺序、模块边界和验收门禁。
3. `docs/review/report-studio-architecture-self-review.md`  
   六轮对抗式自检、已修复问题和实现阶段风险。
4. `docs/review/report-studio-architecture-verification.txt`  
   架构文件机械校验结果和 SHA-256。

发生冲突时，以架构母文件中标记为“已稳定”的当前正文为准；ADR 次之；历史变更记录只用于追溯。

## 3. 冻结架构基线

### 3.1 三阶段与公共界面

```text
大纲阶段 → 草案阶段 → 排版阶段
```

- 三个阶段是工作视图，不是全项目唯一状态机。
- 一个大纲节点可以关联 `0—N` 页。
- 草案和排版始终共享同一个稳定 `pageId`。
- 三个阶段共用项目、页面身份、素材体系、Revision 和固定右侧批注区。
- 草案页内部为“文字内容 + 本页素材”；图片、视频、图表同属素材层级，默认显示缩略图。

### 3.2 DSH Harness 是唯一 Agent 执行面

DSH Harness 负责：

- Agent / Agent Preset；
- 模型与 Provider 路由；
- Agent Loop、Turn / Step；
- 工具调度与子 Agent；
- Session 事件、取消、继续和恢复。

Report Studio 不得自建：

- 第二套 Agent Loop；
- 模型路由器；
- 子 Agent 调度器；
- UI 直连模型；
- 排版引擎内置 AI 绕过 DSH 的执行链。

Report Studio 只向 DSH 注册结构化业务工具，并校验、执行业务 Command。

### 3.3 Canonical Model 与编辑器边界

事实源是 Report Studio 自有 Canonical Model，不是：

- DOM 或 React 状态；
- Tiptap 私有 JSON；
- OpenPencil 私有文件；
- DSH Session 对话历史；
- HTML / PDF / PPTX 导出文件。

编辑器仅通过 Adapter 接入：

```text
OutlineAdapter → 自有树模型 + React Arborist（首选）
DraftAdapter   → Tiptap / ProseMirror（首选）
LayoutAdapter  → OpenPencil（首选验证候选，可替换）
```

### 3.4 稳定 ID

所有可选择、批注、修改、引用、同步或导出的对象均使用稳定且类型明确的 ID，包括：

```text
projectId
outlineNodeId
pageId
contentBlockId
listItemId / metricItemId / tableCellId
scriptBlockId
assetId / pageAssetId
layoutElementId
annotationId
reviewBatchId
proposalId
revisionId
```

禁止使用数组下标、DOM 顺序、“第几段”或编辑器内部 JSON Path 作为业务定位。

### 3.5 批注

批注只有两个状态：

```text
draft | submitted
```

用户流程：

```text
选中目标
→ 写批注意见
→ 点击“添加到批注块”
→ 系统自动保存为 draft
→ 全部写完
→ 点击“提交给 Agent”
→ 冻结不可变 ReviewBatch
```

- 暂存是系统行为，不增加第三个用户操作。
- 批注自动保存不推动项目内容 Revision。
- 同一工作范围的 draft 批注聚合在一个 `AnnotationDraftScopeRecord` 中，通过单记录 `update()` 完成保存和提交切换。
- ReviewBatch 保存批注快照、目标、`baseRevision`、读写范围和请求执行模式，不能只保存可变 annotationId。

### 3.6 Agent 工具协议

平台第一版暴露两个核心工具：

```text
studio_get_context
studio_apply_commands
```

`studio_get_context`：

- 固定读取 `ReviewBatch.baseRevision` 对应的冻结 Snapshot；
- 返回当前任务对象、必要关联上下文和项目公共规则；
- 明确 `readableIds`、`writableIds`、`allowedCommands`；
- 补充读取不扩大写入权限；
- Head 已前进时返回 `stale_review_batch`，不得混读新内容与旧批注。

`studio_apply_commands`：

- 只接受使用稳定 ID 的对象级领域 Command；
- 校验 Schema、ID、Scope、`baseRevision`、风险和幂等；
- 不接受整页覆盖文件或脆弱 JSON Path；
- 一个 ChangeSet 的 Canonical 修改必须全有或全无。

默认写范围：

```text
大纲：当前整份大纲
草案：当前页
排版：当前页
```

排版仅可通过明确的 `live sourceRef` 回写同页草案或 PageAsset；跨页问题只能形成 `CrossScopeSuggestion`。

### 3.7 Proposal、确认与风险

所有 Agent 修改都先形成 Proposal。

默认执行：

```text
review_then_commit
```

具备权限且全部命令均为普通可逆操作时，可使用：

```text
direct_commit
```

三级风险：

```text
ordinary_reversible
structural_review_required
protected_or_deferred
```

风险等级由 `StudioCommandGateway` 计算，不能由 UI 或 Agent 自报。一个 ChangeSet 只要含结构性命令，整组必须候选确认。页面删除、跨页批量重组、永久删除素材不进入 MVP 默认 `allowedCommands`。

### 3.8 草案与排版同步

草案是页面语义内容源，排版是视觉布局事实源：

```text
Draft / PageAsset
        ↓ sourceRef
LayoutElement
```

- 草案 `live` 内容正式提交后自动同步排版；
- 同步内容，不覆盖位置、尺寸、字体、颜色、裁切和图层；
- 排版中编辑 `live` 文字时回写同页草案，并在同一 Revision 更新所有投影；
- 装饰文字可显式 `detached`，系统不得静默解除关联；
- 删除源对象时，排版元素先进入 `orphaned`，不能静默消失。

## 4. 第一版草案内容模型

```text
heading
text
list
metric_group
table
```

独立信息：

```text
scriptBlocks
pageAssets
```

MVP 最先完整支持 `heading`、`text`、`list`，但 `metric_group` 与 `table` 的 Schema 和接口须预留。页面标题是 `heading(role=page_title)`，不得另存冲突的 `Page.title`。讲解稿只存在于 `scriptBlocks`，不新增第四个“脚本阶段”。

## 5. 存储与版本实施基线

### 5.1 两层存储

```text
StudioControlStore
└─ DSH Storage Domain → dsh-storage-sqlite
   ├─ ProjectHeadRecord
   ├─ WorkspaceViewStateRecord
   ├─ AnnotationDraftScopeRecord
   ├─ ProposalControlRecord
   ├─ ReviewRunRecord
   ├─ IdempotencyRecord
   └─ 可重建索引

StudioObjectStore
└─ 内容寻址、不可变文件 Provider
   ├─ Canonical Snapshot
   ├─ Accepted ChangeSet
   ├─ RevisionRecord
   ├─ ReviewBatch
   ├─ Candidate Snapshot
   ├─ 原始素材
   ├─ 引擎派生物 / 缩略图
   └─ 冻结导出包
```

领域层只依赖 `StudioRepository`、`StudioControlStore`、`StudioObjectStore` 接口，不直接依赖 SQL、DSH 物理路径或操作系统路径。

### 5.2 Revision 策略

每个正式 Revision 保存：

- 完整 Canonical Snapshot 引用；
- 已接受 ChangeSet 引用；
- 来源审计；
- `idempotencyKey`；
- `stateHash`；
- 父 Revision 引用。

打开项目直接读取最新 Snapshot，不从第一条 Command 全量重放。回滚使用前向 Revision：历史 Snapshot 内容形成新的正式 Revision，序号继续递增。

### 5.3 ProjectHead 原子提交

正式状态只由 `ProjectHeadRecord.currentRevisionRef` 决定。提交顺序不得改变：

```text
1. 读取 Head，校验 baseRevision
2. 在内存中应用整个 ChangeSet
3. 验证 Canonical Schema / Stable IDs / Refs / Scope / Risk
4. 规范化序列化并计算 stateHash
5. durable publish 素材、Snapshot、ChangeSet、RevisionRecord
6. 对 Head 做单记录 CAS：currentRevision === baseRevision
7. Head 成功后，新 Revision 才正式可见
8. Proposal、幂等索引和派生缓存可在 Head 后对账修复
```

不得假设 DSH Storage Domain 具备跨记录事务。正式结果必须始终是“旧版本完整有效”或“新版本完整生效”。

### 5.4 ObjectStore

- SHA-256 内容寻址；
- Canonical Snapshot 使用 RFC 8785 兼容规范化 JSON；
- staging 与正式对象目录必须位于同一文件系统；
- 发布流程：临时文件 → flush / fsync → hash verify → atomic rename → 父目录持久化；
- durable publish 完成前不得被 Revision 引用；
- `derived` 内容可重建；正式 Revision 可达的 Snapshot 和原始素材不可物理删除。

### 5.5 并发边界

- 所有正式写入携带 `baseRevision`；
- 多 Session 可读，基于旧 Head 的写入整组拒绝；
- MVP 不支持多个 DSH 进程写同一个数据根；
- 数据库和对象存储要求本地磁盘；
- 网络共享盘、云同步目录、CRDT 和实时多人编辑不在 MVP 范围。

## 6. 建议仓库结构

```text
presentation-tools/
├─ package.json
├─ pnpm-workspace.yaml
├─ tsconfig.base.json
├─ docs/
│  ├─ architecture/
│  ├─ handoff/
│  ├─ review/
│  └─ spikes/
├─ packages/
│  ├─ studio-contracts/
│  ├─ studio-core/
│  ├─ studio-storage/
│  ├─ studio-dsh-plugin/
│  ├─ studio-ui/
│  └─ studio-testkit/
└─ apps/
   └─ studio-dev-harness/
```

边界：

- `studio-contracts` 不依赖 React、Tiptap、OpenPencil 或 DSH Client；
- `studio-core` 不依赖具体数据库或文件路径；
- `studio-ui` 只调用 application actions / services，不直接改存储；
- `studio-dsh-plugin` 是唯一允许导入 DSH Host / Client API 的包；
- `studio-storage` 实现 Provider，不拥有业务决策；
- `studio-testkit` 提供可重复的故障注入和 Fixture。

## 7. 开发顺序

### Phase 0：四个阻断性 Spike

结果写入 `docs/spikes/`：

1. **DSH Workspace Spike**：验证独立工作台 Slot / 路由、公共 Shell、固定批注栏及 Client/Host 边界。
2. **ReviewBatch Dispatch Spike**：验证工作台提交到当前 DSH Session，并由真实 Harness 调用两个 Studio 工具。
3. **Storage Atomicity Spike**：验证 DSH Storage Domain + SQLite 单记录 `update()`、重启恢复和同一 `baseRevision` 冲突。
4. **Layout Engine Spike**：验证 OpenPencil 嵌入、中文文本、稳定节点绑定、16:9 Frame、渲染及派生物重建。

Spike 可以替换 Adapter / Provider，但不得推翻 Canonical Model、稳定 ID、批注、Command、Revision 和 ProjectHead 协议。

### Phase 1：Contracts 与纯领域核心

先测试、后实现：

- branded stable IDs；
- Project / Outline / Page / Draft / Asset / Layout Schema；
- AnnotationDraftScope / ReviewBatch Schema；
- Command v0.1 与风险分类；
- Proposal / Revision / ProjectHead Schema；
- deterministic canonicalization + stateHash；
- ChangeSet 原子应用器；
- sourceRef 正向同步和反向回写规则。

### Phase 2：正式存储 Provider

- ObjectStore `putVerified()`；
- DSH Domain ControlStore；
- immutable Revision / Snapshot / ReviewBatch；
- Head CAS；
- AnnotationDraftScope 单记录提交；
- 幂等恢复、启动完整性检查和故障注入。

### Phase 3：最小 StudioShell 与大纲 / 草案

- 公共顶部栏与三阶段视图；
- 固定 AnnotationPanel；
- OutlineDocument 树编辑；
- PageManifest；
- Draft `heading / text / list`；
- scriptBlocks；
- pageAssets 缩略图；
- 批注自动保存、定位和批次提交。

### Phase 4：真实 DSH Harness 闭环

- ReviewBatchDispatcher；
- ReviewRun 关联；
- 两个 Studio Tool；
- 冻结 Snapshot 上下文；
- writable allowlist；
- Proposal / Candidate；
- `review_then_commit`；
- `ordinary_reversible` 的 `direct_commit`；
- Session 与 Studio 审计关联。

### Phase 5：最小排版与自动同步

- 引擎无关 `LayoutPageDocument`；
- 文字、图片、基础形状；
- `sourceRef`；
- `live / detached / orphaned`；
- 草案自动同步；
- 排版 live 文本反向回写；
- 删除引擎文件后从 Canonical Layout 重建。

### Phase 6：冻结成果与 MVP 验收

- 指定 Revision 的静态渲染；
- HTML / PDF / PNG 最小导出；
- Revision manifest 与 checksums；
- 便携项目包；
- 运行完整 44 项 MVP 验收矩阵。

PPTX 导出方式仍为后续独立决策，不阻塞当前 MVP。

## 8. 测试与合并门禁

任何 Phase 不得只凭界面截图宣布完成。

### Contract tests

- Zod Schema 正反例；
- stable ID 类型不可混用；
- Command 风险分类；
- 不同对象属性插入顺序产生相同 Canonical Hash；
- 语义改变必须改变 Hash。

### Domain tests

- ChangeSet 全部成功或全部失败；
- cross-scope command 被拒绝；
- live sourceRef 正向同步；
- live 文字反向回写；
- detached 不同步；
- 删除源对象产生 orphaned。

### Storage / crash tests

- Object durable publish 前崩溃；
- Revision 写入后、Head 更新前崩溃；
- Head 更新后、Proposal 索引更新前崩溃；
- 同一 baseRevision 并发提交；
- 相同 idempotencyKey 重试；
- ReviewBatch 写入后、Scope CAS 前崩溃；
- submitted 但无 ReviewRun 的重启重投；
- 删除 derived 后重建；
- 正式对象删除被阻止。

### DSH integration tests

- 真实 Harness 读取 ReviewBatch；
- 工具输入 / 输出进入 Session 事件；
- readable 与 writable 隔离；
- stale_review_batch；
- 当前页写范围；
- 没有 Studio 自建 Agent Loop 或隐藏模型调用。

### UI tests

- 三阶段公共区域一致；
- 右侧批注栏共用一个组件；
- 批注自动保存和刷新恢复；
- 点击批注定位内容、素材或排版元素；
- 本页素材与项目素材库删除语义分离；
- Candidate 与正式状态有明确视觉区分。

## 9. MVP 主验收场景

完整 44 项以架构母文件第 12.4 节为准。日常持续验证：

1. 大纲节点拖动后稳定 ID 不变；
2. 大纲节点创建共享 `pageId` 的草案与排版页；
3. 对指定 `blockId` / `listItemId` 创建批注；
4. draft 批注刷新恢复且不增加内容 Revision；
5. ReviewBatch 不可变、可幂等投递 DSH；
6. 真实 Agent 经两个 Studio Tool 修改当前页；
7. Gateway 拒绝越界、旧 Revision 和不允许命令；
8. Proposal 显示候选差异；
9. 接受后先写不可变对象，再 CAS 前移 Head；
10. live 排版元素同步且保留视觉属性；
11. 整轮修改可通过前向 Revision 回滚；
12. 重启后恢复正式 Head、draft 批注和待投递批次；
13. 从冻结 Revision 生成可校验静态成果。

## 10. 暂缓与禁止范围

MVP 暂缓：

- 动画、转场、时间线；
- 多人实时协同和 CRDT；
- 高保真 PPTX 导入；
- 跨页批量重组；
- 页面拆分、合并、删除的通用 Agent 权限；
- 物理永久删除项目素材；
- 完整替代 PowerPoint；
- 长篇连续文档；
- 模板市场和插件市场。

明确禁止：

- 在 React 组件内保存正式项目真源；
- 让 Tiptap JSON 或 `.op` 文件成为 Canonical Model；
- UI 直接修改数据库；
- Agent 返回整页 JSON 覆盖正式页面；
- 使用数组下标或 JSON Path 作为命令目标；
- Head 更新后再补写 Snapshot；
- 将未接受 Candidate 用于导出；
- 在 Studio 工具内部再次调用模型；
- 将前期策划专用章节和 Gate 写入通用核心。

## 11. 已知风险

| 风险 | 处理方式 |
|---|---|
| DSH 快速迭代 | 所有 DSH API 隔离在 `studio-dsh-plugin`；通过 Spike 固定兼容基线 |
| Storage Domain 无跨记录事务 | 不依赖；不可变对象先写，单 Head CAS 最后提交 |
| SQLite Provider 同步阻塞 | 仅保存小控制记录；大内容进 ObjectStore；监控事件循环阻塞 |
| OpenPencil 集成不确定 | 仅作可替换 LayoutAdapter Provider；先做 Spike |
| 素材体积 | 二进制不进控制库；内容寻址去重；预览可重建 |
| Schema 演进 | 历史对象不可变；读取迁移；新写形成当前 Schema Revision |
| 跨平台文件持久化 | Windows / macOS / Linux 故障注入通过前不得宣称 durable |
| 长历史体积 | MVP 完整 Snapshot；后续只优化 Provider 内部对象复用 |

## 12. 分支、版本与变更纪律

```text
Repository:             ArchitectureWorld/presentation-tools
Branch:                 architecture/report-studio-mvp-baseline-v1.0.0
Architecture Baseline:  1.0.0
Handoff Version:        1.0.0
```

- 已稳定规则变更必须新增 ADR 并提升架构版本；
- 单个实现 PR 只解决一个可验证纵向目标；
- PR 必须列出关联架构条款、测试命令和实际输出；
- 禁止以“UI 已完成”替代存储、恢复和真实 DSH 证据。

建议实现分支：

```text
spike/dsh-workspace-integration
spike/review-batch-dispatch
spike/storage-head-cas
spike/openpencil-layout-adapter
feat/studio-contracts-foundation
feat/studio-repository-foundation
feat/studio-shell-outline-draft
feat/dsh-review-run-loop
feat/layout-live-sync
```

## 13. 接手后的第一组动作

1. 阅读架构母文件第 0、2、3、6、7、8、11、12、15 节；
2. 建立 pnpm workspace，但不要立即引入全部 UI 依赖；
3. 先创建 `studio-contracts` 和 `studio-testkit`；
4. 为四个 Spike 先写失败条件和验收脚本；
5. 先让测试失败，再逐项实现；
6. 每个 Spike 将实际 DSH / OpenPencil 版本、API 和结论写入 `docs/spikes/`；
7. Spike 没有架构阻断后，再集成 StudioShell 和三阶段 UI；
8. 首个可合并实现必须演示 ReviewBatch → DSH Harness → Command → Proposal → Revision → Layout Sync 真实闭环。

## 14. 完成定义

只有同时满足以下条件，才能宣称 MVP 架构闭环完成：

- 真实 DSH Harness 参与执行；
- 项目内容、draft 批注和待投递批次可在重启后恢复；
- Agent 通过稳定 ID 修改允许范围；
- 越界、过期和高风险命令被确定性拒绝；
- Candidate 与正式 Revision 分离；
- Head 更新前故障不改变正式内容；
- Head 更新后能从 RevisionRecord 恢复 Proposal 和幂等结果；
- 草案和 live 排版元素保持同一语义内容；
- 导出只读取冻结 Revision；
- 架构母文件第 12.4 节 44 项验收与关键故障注入测试通过；
- 文档、类型、Tool Schema 和测试术语一致。

## 15. 交付物校验

```text
architecture_file=docs/architecture/report-studio-architecture.md
architecture_version=1.0.0
architecture_status=development-baseline-frozen
architecture_sha256=b0d6e78632576ffc3983fd9afd33b73f04d15436521fb130b20d8bc073d8caa1
architecture_lines=2519
architecture_json_blocks=21
architecture_adrs=62
architecture_mvp_items=44
architecture_consistency_items=48
architecture_errors=0
architecture_warnings=0
```

自检方法必须如实表述为 `user-approved-adversarial-self-review`，不得声称已经由独立第二 Agent 审核。未来取得真正独立审查结果时，应新增审查记录，不改写既有事实。

---

## 最终交接语句

本交付已稳定到足以开始 MVP 开发。接手者的主要任务不是继续扩写架构，而是通过四个 Spike 证明 Adapter / Provider 可行，并以一条最小纵向闭环落实已经冻结的 Canonical Model、稳定 ID、批注、DSH 工具、Proposal、Revision、ProjectHead 和排版同步协议。
