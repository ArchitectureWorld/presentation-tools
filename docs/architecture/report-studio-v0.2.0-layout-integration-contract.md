---
document_id: report-studio-v0.2.0-layout-integration-contract
status: convergence-contract
product_version: 0.2.0-alpha.3
branch: feat/report-studio-v0.2.0-layout
v0_1_1_main_merge: 8e08aa28129e75058fa1a3037522ca874cd7ddbf
convergence_merge: 3b3ed6e0fc30648fa8917a66d7fd76fd4707db22
updated_at: 2026-09-04
---

# Report Studio v0.2.0 排版接入合同

## 1. 目的

本合同固定“Report Studio Canonical Snapshot 中的语义内容如何成为排版来源”的唯一边界。排版领域不读取 DOM、旧版简化页面、编辑器私有 JSON、Data URL 或附件字节；它只消费经过 Report Studio Canonical 校验的项目快照、项目级 Revision、选定页面和 ObjectRef-backed PageAsset 投影。

当前实现位于：

```text
packages/studio-layout-integration/
```

正式公共入口：

```js
buildLayoutSourceProjection({
  snapshot,
  pageId,
  projectRevision,
  sourceStateHash,
  resolvedPageAssets,
})
```

兼容查询入口：

```js
buildLayoutSourceIndex(input)
```

它只返回 `buildLayoutSourceProjection(input).sources`。旧的 `buildLayoutSourceIndex(draftPage, resolvedPageAssets)` 调用方式已经禁止，因为它会迫使调用方在页面中重复携带或猜测项目身份。

两个入口均为纯函数：不读写 Repository、不修改输入、不调用 DSH，也不依赖具体画布引擎。

## 2. Project ID 与 pre-design 标准化边界

这是本次 V0.1.1 → V0.2.0 合流必须重点保持的跨系统不变量。

```text
pre-design
  project.json.projectId
  pages/drafts/*.json.projectId
        ↓ Presentation Standard Project Directory 0.1.0
Report Studio
  CanonicalSnapshot.project.projectId
        ↓ Layout Source Projection
LayoutPageDocument.projectId
```

唯一事实源是：

```text
CanonicalSnapshot.project.projectId
```

Canonical Page 不再重复保存 `projectId`，Layout 调用方也不得传入 `projectId` 覆盖值。这样可避免出现“项目文件一个 ID、页面内部一个 ID、排版再造一个 ID”的三套身份。

```text
PROJECT_ID_STANDARD_IMPACT=NO_SCHEMA_CHANGE
PRE_DESIGN_CHANGE_REQUIRED=NO
PRESENTATION_STANDARD_VERSION=0.1.0
CONTRACT_SCHEMA_HASH=5bd329fcc8503ff7a48b3430e41b38dd264ae486cee7372a39cbbcccc2de2ebc
```

对 pre-design 的要求保持不变：

1. 创建项目时生成一个稳定 `projectId`；
2. `project.json.projectId` 与每个 `DraftPageDocument.projectId` 必须一致；
3. 重复导出、改名、调整章节和修改内容不得重新生成 `projectId`；
4. 不需要新增排版字段，不需要修改 Contract 0.1.0 Schema；
5. `layouts/` 继续由 Presentation 管理，pre-design 不覆盖、不重建。

本次修正完全发生在 Presentation 内部：从 Canonical Snapshot 选择项目身份，并把它传入 LayoutPageDocument。

## 3. 输入合同

### 3.1 snapshot

`snapshot` 必须通过 Report Studio `assertCanonicalSnapshot()`。它至少提供：

```js
{
  project: {
    projectId,
    projectRulesId,
    outlineDocumentId,
  },
  outline: [],
  pages: [],
}
```

页面由 `pageId` 在 `snapshot.pages` 中选择。调用方不得直接传递脱离项目快照的 DraftPage，也不得传入另一个 `projectId`。

### 3.2 projectRevision

`projectRevision` 是 Report Studio 的项目级单调 Revision，必须是非负安全整数。它不是 Draft 私有版本，也不是 pre-design 产品版本。

### 3.3 sourceStateHash

`sourceStateHash` 可为 `null`，或为 64 位小写 SHA-256。它用于判断来源快照是否变化，不替代项目 Revision。

### 3.4 resolvedPageAssets

每个已解析素材至少包含：

```js
{
  pageAssetId,
  assetId,
  objectRef: {
    sha256,
    sizeBytes,
    mimeType
  },
  metadata: {
    widthPx,
    heightPx
  }
}
```

`pageAssetId` 与 Canonical Page 的 PageAsset 引用必须一致，`assetId` 也必须匹配。缺少 ObjectRef、引用未解析或身份不一致时，整个投影构建失败。

## 4. 前置身份要求

正式接入要求以下稳定身份：

```text
projectId
draftDocumentId
pageId
contentBlockId
listItemId
metricId
tableColumnId
tableRowId
tableCellId
scriptBlockId
pageAssetId
assetId
```

旧版页面对象：

```js
{ heading, body, bullets, script, assets }
```

缺少内容块和嵌套对象身份，必须拒绝，不得按标题、数组位置或文本内容猜测 ID。

## 5. 输出合同

`buildLayoutSourceProjection()` 返回：

```js
{
  schemaVersion,
  projectId,
  pageId,
  draftDocumentId,
  projectRevision,
  sourceStateHash,
  sources: {}
}
```

`sources` 的所有键由 `sourceRefKey()` 生成：

```text
content-block:<contentBlockId>
script-block:<scriptBlockId>
page-asset:<pageAssetId>
content-item:<contentBlockId>:list-item:<listItemId>
content-item:<contentBlockId>:metric:<metricId>
content-item:<contentBlockId>:table-cell:<tableCellId>
```

`createLayoutPage()` 必须使用投影返回的 `projectId` 和 `pageId`，不能由 UI、OpenPencil 或其他调用方另行指定项目身份。

## 6. 支持内容

首批支持：

- `heading` 与 `text`；
- `list` 及每个 `listItemId`；
- `metric_group` 及每个 `metricId`；
- `table` 及每个 `tableCellId`；
- 每个 `scriptBlockId`；
- 每个 `pageAssetId`。

表格行列保留在 Table 投影中，首批可由 LayoutElement 直接引用的最小表格对象是 `tableCellId`。

## 7. 安全投影

来源投影使用字段白名单构建，不复制调用方对象。结果不得包含：

```text
dataUrl
dataBase64
rawBytes
完整附件字节
standardArchive
migration
Workspace View / ui
DSH Session 私有状态
```

素材只暴露 ObjectRef、显示身份、角色、说明和安全元数据。真实文件字节由 Asset Resolver 在授权边界内读取，不进入 LayoutPageDocument 或来源投影。

## 8. 引用完整性

构建来源投影前必须验证：

- Canonical Snapshot 有效；
- pageId 存在于该 Snapshot；
- projectId 只能来自 Snapshot；
- 同类稳定 ID 不重复；
- PageAsset 链接存在对应已解析素材；
- PageAsset 的 `assetId` 与解析结果一致；
- ObjectRef 的 SHA-256、sizeBytes 和 mimeType 合法；
- ScriptBlock 引用的 contentBlockId 存在；
- ScriptBlock 引用的 assetId 在当前页面可用；
- TableCell 引用的 tableColumnId 存在。

任一错误拒绝整个投影，不产生部分结果。

## 9. 稳定错误码

```text
layout_source_snapshot_required
layout_source_invalid_snapshot
layout_source_page_missing
layout_source_project_id_override_forbidden
layout_source_invalid_revision
layout_source_invalid_state_hash
layout_source_invalid_document
layout_source_invalid_identity
layout_source_contract_unavailable
layout_source_duplicate_identity
layout_source_reference_missing
layout_source_reference_mismatch
layout_source_object_ref_required
```

错误对象使用 `LayoutSourceContractError`，携带 `code` 和可选 `details`，不得暴露画布引擎内部异常作为领域合同。

## 10. 与 V0.1.1 合流后的状态

V0.1.1 已满足排版接入前置条件：

- Canonical ContentBlock / ListItem / Metric / TableCell / ScriptBlock / PageAsset 身份稳定；
- 素材使用 ObjectRef，不以 Data URL 作为事实源；
- Standard Adapter 保持身份稳定；
- Canonical Snapshot、Dirty Buffer、no-op Revision 和 CAS 已完成；
- Workspace Live Link 明确保留 `layouts/`；
- Windows/Linux、真实 DSH 与真实 Provider 已通过。

因此本合同可以进入 V0.2.0 正式集成开发，但在以下能力完成前仍不得开放生产 Layout Tab：

1. 真实 OpenPencil Runtime 烟测；
2. LayoutPageDocument 的项目级 Revision/CAS 持久化；
3. `live / detached / orphaned` 同步闭环；
4. 托管编辑器嵌入与真实选择/保存/重开；
5. 联合发布和回滚门禁。

## 11. 明确不包含

当前合同不直接实现：

- Production Layout UI；
- Layout Repository 持久化；
- 排版 Agent Command；
- 分页、模板、母版、动画；
- HTML、PNG、PDF、PPTX 成品导出。
