# Report Studio 存储与版本架构独立审查包

## 审查目的

这是一个通用汇报工作台的开发前架构门禁。请作为独立架构审查 Agent，重点判断下面的存储与版本方案是否：

1. 在 DSH Harness / 插件边界内可实现；
2. 不假设 DSH Storage Domain 具备跨记录事务；
3. 在进程崩溃、部分写入、重复提交和并发提交下不会让正式项目进入半提交状态；
4. 能保持 Annotation、ReviewBatch、Proposal、Revision、Snapshot、素材和导出的一致性；
5. 对 MVP 不过度设计，同时保留未来替换 Provider 的边界；
6. 没有会导致数据损坏、不可恢复、错误 GC、Hash/Head 不一致或 Schema 迁移死锁的缺口。

请忽略文案风格和 UI 细节。只指出可复现、可解释的架构风险。每条意见必须给出：严重级别、对应小节、失败场景、最小修正建议。若没有阻断性问题，请明确写出“未发现阻断开发的问题”，并列出仍需通过实现测试验证的非阻断项。

## 已冻结且不得倒置的上层约束

- DSH Harness 是唯一 Agent / 模型执行面；Report Studio 不自建 Agent Loop。
- Report Studio 使用自有 Canonical Model、稳定 ID、对象级 Command、Proposal 与项目级 Revision。
- Agent 默认只在明确 writableIds / allowedCommands 范围内写入。
- Annotation 只有 draft / submitted；ReviewBatch 是不可变批注快照。
- 一个 ChangeSet 的 Canonical 修改必须全部成功或全部失败。
- 草案是语义内容源，LayoutPageDocument 是引擎无关视觉事实；引擎文件是可重建派生物。
- 最终导出只能基于一个冻结正式 Revision。

## 11. 存储、版本、素材接入与导出

### 11.1 决策结论【已稳定】

MVP 本地架构采用两层存储，而不是把所有内容塞进一个数据库或一个项目 JSON：

```text
StudioRepository
├─ StudioControlStore
│  └─ DSH Storage Domain → dsh-storage-sqlite
│     ├─ ProjectHeadRecord
│     ├─ WorkspaceViewState
│     ├─ AnnotationScopeRecord
│     ├─ ReviewBatchIndex / ReviewRun
│     ├─ Proposal
│     ├─ Idempotency
│     └─ Object / Revision Index
│
└─ StudioObjectStore
   └─ 本地内容寻址、不可变对象存储
      ├─ Canonical Snapshot
      ├─ Candidate Snapshot
      ├─ 原始素材
      ├─ 缩略图与预览
      ├─ Layout Engine 派生文件
      └─ 冻结导出包
```

逻辑领域服务只依赖 `StudioRepository`、`StudioControlStore` 和 `StudioObjectStore` 接口，不直接依赖 SQLite API、DSH 后端路径或操作系统文件路径。未来切换为 PostgreSQL + 对象存储时，不改变 Canonical Model、Agent 工具、Command 或 Revision 语义。

### 11.2 方案对比与选择

| 方案 | 优点 | 主要问题 | 结论 |
|---|---|---|---|
| 纯 JSON 文件 | 可读、便于人工检查和复制 | 高频修改需要重写文件；并发、索引、批注自动保存和状态查询较弱 | 只用于诊断、便携包和测试 Fixture，不作为主存储 |
| 插件直接维护一套 SQLite 业务表 | 可使用完整 SQL 事务和查询 | 绕开 DSH Storage seam；重复生命周期、配置、备份和兼容工作；核心容易绑定物理表 | 不作为 MVP 默认路线，保留为 Provider 失败时的后备实现 |
| DSH Storage Domain + SQLite + 不可变对象存储 | 与 DSH 生命周期一致；控制记录按 key 原子持久化；大文件不进入数据库；Provider 可替换 | DSH Domain 不提供跨记录事务，且仍处于快速演进期 | **采用。通过不可变对象先写、Project Head 最后原子更新规避跨记录事务要求** |
| 纯命令日志 / Event Sourcing | 日志紧凑，可解释每一步 | 打开项目、回滚和导出需要长链重放；Schema 演进与历史命令兼容复杂 | 不采用为唯一事实源 |
| 仅保存完整快照 | 恢复、回滚、导出简单 | 无法直接解释改动，历史体积增加 | 与 ChangeSet 组合使用，不单独使用 |

最终采用：

> **完整 Canonical Snapshot 负责确定性恢复与导出，已接受 ChangeSet 负责差异、解释和审计，Project Head 负责唯一正式可见状态。**

### 11.3 控制面记录

#### ProjectHeadRecord

`ProjectHeadRecord` 是每个项目唯一的可变正式 Head：

```json
{
  "projectId": "project_001",
  "currentRevision": 18,
  "currentRevisionId": "revision_018",
  "currentSnapshotHash": "sha256:8f4b...",
  "headVersion": 18,
  "updatedAt": "2026-09-02T02:40:00Z"
}
```

约束：

- `currentRevision` 单调递增；
- `headVersion` 用于控制存储的原子更新与幂等检查；
- 正式读取必须先读取 Head，再读取其指向的 Revision 和 Snapshot；
- 任何未被 Head 或正式 Revision 链引用的候选 / Revision 对象都不属于当前正式状态。

#### WorkspaceViewState

```json
{
  "projectId": "project_001",
  "lastOpenedStage": "draft",
  "lastOpenedPageId": "page_004",
  "updatedAt": "2026-09-02T02:41:00Z"
}
```

它只恢复界面，不推动内容 Revision，也不进入导出。

### 11.4 Revision 物理策略【已稳定】

MVP 采用“完整不可变快照 + 已接受 ChangeSet”的混合策略。每次正式提交形成一个不可变 `RevisionRecord`：

```json
{
  "revisionId": "revision_019",
  "projectId": "project_001",
  "revisionNumber": 19,
  "parentRevisionId": "revision_018",
  "baseRevision": 18,
  "snapshotRef": {
    "provider": "studio_object_store",
    "algorithm": "sha256",
    "hash": "sha256:3d91..."
  },
  "snapshotSchemaVersion": 1,
  "stateHash": "sha256:3d91...",
  "changeSet": {
    "changeSetId": "changeset_204",
    "commandSchemaVersion": 1,
    "commandIds": ["command_701", "command_702"]
  },
  "source": {
    "type": "dsh_agent",
    "proposalId": "proposal_052",
    "reviewBatchId": "review_batch_032"
  },
  "committedAt": "2026-09-02T02:42:00Z"
}
```

规则：

1. Snapshot 是结构化 Canonical Model 的完整冻结包，不包含原始二进制、Tiptap 私有 JSON、OpenPencil 私有事实或 UI 临时状态；
2. 正常打开当前项目直接读取 Head 对应 Snapshot，不从第一条 Command 重放；
3. ChangeSet 与命令结果随 Revision 保存，用于解释、差异、审计和后续诊断；
4. 回滚不是把 Head 直接倒退，而是以历史 Snapshot 内容创建一个新的前向 Revision；
5. 候选 Proposal 可拥有 `CandidateSnapshot`，但它不是正式 Revision；接受后才创建正式 Revision 并尝试更新 Head；
6. MVP 每个正式 Revision 保存完整 Snapshot。未来可在 Provider 内部改为“周期检查点 + 增量对象复用”，但不得改变外部 Revision 语义或要求 Agent 重放历史命令。

### 11.5 原子提交协议【已稳定】

DSH Storage Domain 的单次记录写入具备原子和持久语义，但不提供平台所需的跨记录事务。Report Studio 因此采用“不可变对象先写，Head 最后提交”的协议：

```text
1. 读取 ProjectHead，校验 baseRevision
2. 在内存中应用整个 ChangeSet
3. 校验 Canonical Schema、稳定 ID、引用、作用域和风险
4. 确定性序列化 Snapshot，计算 stateHash
5. 先写入并校验所有新增素材 / Snapshot / Candidate 对象
6. 写入不可变 RevisionRecord
7. 对 ProjectHead 执行 expectedRevision 条件更新
8. Head 更新成功后，Revision 才正式可见
9. 更新 Proposal 状态和二级索引；失败时由对账任务修复
10. 异步重建引擎投影、缩略图和导出缓存
```

可见性规则：

| 故障位置 | 正式结果 |
|---|---|
| Snapshot 或素材写入前失败 | Head 不变，无正式修改 |
| 不可变对象写入后、Head 更新前失败 | Head 不变，只产生不可见孤儿对象，可清理 |
| `baseRevision` 冲突导致 Head 更新失败 | 新对象不可见，ChangeSet 整组拒绝 |
| Head 更新后、Proposal 状态更新前崩溃 | 新 Revision 已正式生效；系统依据 Revision 的 `proposalId` 对账修复 Proposal |
| 引擎投影或预览生成失败 | Canonical Revision 不回滚；记录告警并重建派生物 |

Head 更新必须通过控制存储的原子 `update` 完成，并在更新函数中再次检查 `currentRevision === baseRevision`。不能先覆盖当前内容，再补写 Revision。

### 11.6 批注自动保存与 ReviewBatch 提交协议【已稳定】

草案批注不进入项目内容 Revision。每个工作范围使用一个带 `scopeVersion` 的 `AnnotationScopeRecord` 聚合尚未提交的 draft 批注；每条 Annotation 仍保留自己的 `annotationVersion`。

提交批注时：

```text
1. 读取 AnnotationScopeRecord 的 scopeVersion 及各 Annotation.annotationVersion
2. 重新解析全部目标锚点并生成不可变 ReviewBatch
3. 先持久化 ReviewBatch 快照
4. 原子更新 AnnotationScopeRecord：
   - 再次检查 scopeVersion 与各 Annotation.annotationVersion
   - 将所含批注标记为 submitted
   - 写入 submittedBatchId
   - scopeVersion + 1
5. 只有第 4 步成功，批次才允许投递 DSH Harness
6. 若投递前崩溃，启动恢复扫描“已提交但无 ReviewRun”的批次并安全重试
```

第 3 步后、第 4 步前失败只会产生不可调度的孤儿 ReviewBatch；不会把部分批注误标为已提交。重试必须复用幂等键，不能生成重复业务任务。

### 11.7 StudioObjectStore【已稳定边界】

对象存储使用内容寻址和不可变发布：

```text
<root>/objects/sha256/ab/<full-hash>
<root>/staging/<candidate-id>/...
<root>/derived/<engine-or-renderer>/<content-hash>/...
<root>/exports/<project-id>/<revision-id>/...
```

规则：

- 正式对象键由内容哈希决定，不使用原始文件名作为唯一定位；
- 写入流程为临时文件 → flush / fsync → 哈希复核 → 原子 rename；
- 数据库 / Revision 只能引用已经持久化并通过哈希校验的对象；
- 相同内容自动去重；
- 原始文件名、来源、许可证和生成信息保存在 Asset 元数据中；
- `derived` 中的缩略图、视频预览、OpenPencil 文件和页面渲染可删除并重建；
- `objects` 中被正式 Revision 引用的原始素材和 Snapshot 不得随意删除。

### 11.8 Asset Ingestion【已稳定】

无论素材来自人工上传、DSH Agent 检索还是 AI 生成，都先进入统一接入流程：

```text
外部文件或生成结果
→ 类型、大小、安全和可读取性校验
→ 提取元数据、来源和授权信息
→ 写入 staging 并计算 SHA-256
→ 生成缩略图 / 预览
→ 返回临时 AssetCandidate
→ ChangeSet / Proposal 校验
→ 原始对象先进入 StudioObjectStore
→ 正式 Revision 注册 Asset 并建立 PageAsset 引用
```

DSH Agent 需要新素材时，可由 DSH Harness 调用已有工具取得 Artifact Reference，再把该引用作为 `ingest_asset` 输入。Report Studio 不自建第二套生成 Agent。

从本页移除只删除 PageAsset 引用。项目素材“删除”在 MVP 中转换为 `archived`；不执行物理 Blob 删除。

### 11.9 并发与单进程边界【已稳定】

MVP 采用项目级乐观并发控制：

- 所有正式 ChangeSet 必须携带 `baseRevision`；
- 多个 DSH Session 可以读取同一项目，但只有基于当前 Head 的写入可以成功；
- Head 已变化时，Proposal 标记为 `stale`，不得自动合并或覆盖；
- DSH Storage Domain 在单进程内排序写入，Studio 仍必须执行 `baseRevision` 条件检查；
- MVP 不支持多个 DSH 进程同时写同一存储根；
- MVP 数据库和对象存储要求本地磁盘。网络共享盘、云同步目录和多实例写入不作为受支持部署方式；
- 对象级并发、CRDT 和多人实时共同编辑留到 MVP 后。

### 11.10 Schema 演进【已稳定】

每一层分别版本化：

```text
StorageEnvelopeVersion
CanonicalSnapshotSchemaVersion
DocumentSchemaVersion
CommandSchemaVersion
LayoutSchemaVersion
EngineArtifactVersion
ExportManifestVersion
```

规则：

1. DSH Domain 的物理 format version 只在控制记录物理布局不可兼容时变化；普通业务字段演进使用记录内 `schemaVersion`；
2. 读取旧 Snapshot 时，Repository 使用纯函数迁移链在内存中投影到当前 Schema；
3. 历史 Revision 和其哈希对象不原地改写；
4. 对旧项目进行正式编辑时，第一次新提交自然产生当前 Schema 的新 Revision；
5. 遇到高于当前程序支持的 Schema 时，以只读方式打开并阻止写入；
6. Engine Artifact 版本不兼容时直接失效并从 Canonical Layout 重建，不迁移为事实数据。

### 11.11 完整性、恢复与垃圾回收【已稳定边界】

- Snapshot、素材、RevisionRecord 和导出包均保存 SHA-256；读取时校验；
- 启动时检查 ProjectHead → RevisionRecord → Snapshot 的可达链；
- Head 指向对象缺失或哈希错误时停止写入，进入恢复模式，不静默回退；
- Proposal、ReviewBatch、ReviewRun 的状态可通过 Revision 来源引用和幂等键对账；
- 孤儿 Snapshot、候选对象、失败的 AssetCandidate 和派生缓存按照保留期清理；
- GC 只能删除从任何 ProjectHead、正式 Revision、待处理 Proposal、冻结导出包均不可达的对象；
- 正式 Revision 历史在 MVP 中默认保留，不做自动裁剪。

### 11.12 备份与便携项目包【已稳定边界】

备份不依赖直接复制一个正在写入的 SQLite 文件。平台提供基于冻结 Revision 的便携项目包：

```text
ReportStudioProjectBundle
├─ bundle-manifest.json
├─ RevisionRecord
├─ Canonical Snapshot
├─ 所有可达原始素材
├─ 项目规则与必要模板
├─ checksums.json
└─ 可选：引擎派生文件与导出成果
```

导入时先校验 Manifest 和所有哈希，再以新项目或显式恢复流程注册。插件升级、卸载或 Profile 调整不得默认删除 Studio 数据根。

### 11.13 冻结成果导出【已稳定】

HTML、PDF、PNG、PPTX 都从同一个冻结正式 Revision 读取 Canonical Snapshot 和已确认素材：

```text
ProjectHead / 指定 Revision
→ Immutable Canonical Snapshot
→ Draft / Layout Canonical Projection
→ 排版引擎或确定性渲染器
→ HTML / PDF / PNG / PPTX
```

导出器不能直接读取当前 UI 临时状态、未接受 Proposal、未提交批注或未经 Head 提交的 Candidate Snapshot。导出包记录 `revisionId`、`stateHash`、渲染器版本、字体清单和所有输出文件哈希。

PPTX 第一版采用整页高清图还是元素级可编辑导出仍待讨论，不影响 Canonical Model 和 Revision 存储。

---

## 与本决策相关的一致性验收条款

一版实现或架构修改只有同时满足以下条件，才算没有走偏：

1. 平台仍是通用汇报工作台，业务模板未侵入核心模型。
2. DSH Harness 仍是唯一 Agent / 模型执行面。
3. Studio 工具只提供受控上下文和业务写入，不在工具内部另起模型调用。
4. Project、Outline、Page、Draft、Asset、Layout、Annotation、Proposal、Revision 职责不重叠。
5. `PageManifest` 是页面身份、顺序、归属和阶段状态的唯一来源。
6. 页面标题以 `heading(role=page_title)` 为内容事实，不另存冲突副本。
7. 草案讲解稿保存在 `scriptBlocks`，不混入页面展示内容。
8. 项目 Asset 与 PageAsset 引用严格分离。
9. LayoutPageDocument 引擎无关；引擎节点只存在于可重建 Binding。
10. 所有可操作对象使用类型明确的稳定 ID，包括嵌套内容项。
11. 批注只有 `draft / submitted` 两种状态，自动保存不推动项目内容 Revision。
12. ReviewBatch 冻结批注快照、目标、范围、`baseRevision` 和执行模式。
13. AgentContextBundle 区分完整可读信息与显式可写白名单。
14. 草案 / 排版默认只写当前页；排版仅能通过 `live sourceRef` 回写同页源对象。
15. Agent 使用对象级领域 Command，不覆盖整页，不使用脆弱 JSON Path。
16. `CrossScopeSuggestion`、自动同步、预览和告警不是模型可执行 Command。
17. 一个 ChangeSet 的 Canonical 修改全部成功或全部失败。
18. Agent 修改始终形成 Proposal；候选预览不冒充正式 Revision。
19. `review_then_commit` 与 `direct_commit` 共用校验、Proposal、Revision 和审计；`direct_commit` 仅适用于 `ordinary_reversible`。
20. 项目内容 Revision 与 Annotation、ReviewRun、DSH Session 状态分离。
21. `live` 正向同步与排版反向回写均以草案 / PageAsset 为语义源并保留视觉属性。
22. 导出只读取冻结正式 Revision。
23. 编辑器、存储和排版引擎均位于 Adapter / Provider 后，可替换而不破坏核心数据。
24. 待验证和待讨论事项有明确标记，未被写成已稳定事实。
25. 所有模型可见的 Studio 输入和工具结果能够从 DSH Session / Tool 事件追溯，不存在隐藏上下文通道。
26. Command v0.1 的 `ordinary_reversible / structural_review_required / protected_or_deferred` 风险策略由 Gateway 强制执行，不能由 UI 或 DSH Agent 自报风险等级。
27. 页面删除、跨页批量重组和永久删除项目素材不在 MVP 默认 `allowedCommands` 中。
28. `ProjectManifest` 不再保存可与控制面冲突的当前 Revision 或最近打开阶段；正式 Head 与界面状态分别由 `ProjectHeadRecord` 和 `WorkspaceViewState` 表达。
29. 当前正式项目只通过 ProjectHead 解析；RevisionRecord、Snapshot 或 Candidate 单独存在不等于正式生效。
30. Revision 同时保留完整 Snapshot 与已接受 ChangeSet；系统既不依赖全量命令重放，也不丢失修改原因。
31. 存储提交遵循“不可变对象先写、Head 最后更新”，不依赖跨记录或跨文件事务。
32. 数据库不存大二进制、OpenPencil 私有文件或最终导出正文；这些由 StudioObjectStore 管理。
33. 所有正式对象引用都指向已写入并通过哈希校验的内容；失败只留下不可见孤儿对象。
34. 历史 Revision 不原地迁移，Schema 兼容通过确定性读取迁移与新 Revision 完成。
35. 项目级 `baseRevision` 冲突会整组拒绝，不允许最后写入者静默覆盖。
36. 回滚产生新的前向 Revision；删除派生物可重建，删除正式可达对象被禁止。
37. 备份和导出以冻结 Revision 为边界，可通过 Manifest 与哈希独立验证。

## 本轮新增 ADR

| 编号 | 日期 | 决策 | 状态 |
|---|---|---|---|
| ADR-039 | 2026-09-02 | MVP 本地存储采用 DSH 原生控制存储与 Studio 内容寻址对象存储双层结构 | 已稳定 |
| ADR-040 | 2026-09-02 | 本地 ControlStore 首选 DSH Storage Domain 路由到 dsh-storage-sqlite | 开发基线首选实现 |
| ADR-041 | 2026-09-02 | 正式 Revision 同时保存完整 Canonical Snapshot 引用与已接受 ChangeSet | 已稳定 |
| ADR-042 | 2026-09-02 | 当前正式状态由单一 ProjectHead 指针决定，提交采用不可变对象先写、Head 最后原子更新 | 已稳定 |
| ADR-043 | 2026-09-02 | ProjectManifest 不保存当前 Revision 和最近打开阶段；二者分别属于 ProjectHeadRecord 与 WorkspaceViewState | 已稳定 |
| ADR-044 | 2026-09-02 | 原始素材、Snapshot、Candidate、引擎派生物和导出包使用内容寻址对象存储与哈希校验 | 已稳定边界 |
| ADR-045 | 2026-09-02 | MVP 使用项目级 baseRevision 乐观并发控制，不支持多进程共享同一存储根 | 已稳定 |
| ADR-046 | 2026-09-02 | 历史 Revision 不原地迁移；Schema 通过记录内版本和确定性读取迁移演进 | 已稳定 |
| ADR-047 | 2026-09-02 | 回滚创建新的前向 Revision，正式可达对象默认保留，GC 只处理不可达对象 | 已稳定 |
| ADR-048 | 2026-09-02 | ReviewBatch 先持久化快照，再以 scopeVersion + Annotation.annotationVersion 条件提交批注范围，投递通过幂等恢复完成 | 已稳定 |
| ADR-049 | 2026-09-02 | 便携项目包以冻结 Revision 和可达对象图为边界，不依赖复制正在运行的数据库 | 已稳定边界 |
