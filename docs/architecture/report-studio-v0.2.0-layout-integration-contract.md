---
document_id: report-studio-v0.2.0-layout-integration-contract
status: implemented-foundation-contract
product_version: 0.2.0-alpha.1
branch: feat/report-studio-v0.2.0-layout
base_branch: feat/report-studio-v0.1.1-hardening
base_commit: 29294803681758e0b65a0bc51f7ed9ab810cde9a
updated_at: 2026-09-03
---

# Report Studio v0.2.0 排版接入合同

## 1. 目的

本合同固定“草案语义内容如何成为排版来源”的唯一边界。排版领域不读取 DOM、旧版简化页面、编辑器私有 JSON、Data URL 或附件字节；它只消费稳定身份明确的 DraftPageDocument 与 ObjectRef-backed PageAsset 投影。

当前实现位于：

```text
packages/studio-layout-integration/
```

公共入口：

```js
buildLayoutSourceIndex(draftPage, resolvedPageAssets)
```

该函数是纯函数，不读写 Repository，不修改输入，不调用 DSH，也不依赖画布引擎。

## 2. 前置身份要求

正式接入至少要求以下稳定身份：

```text
draftDocumentId
projectId
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

缺少内容块和嵌套对象身份，必须返回 `layout_source_contract_unavailable`，不得按标题、数组位置或文本内容猜测 ID。

## 3. 输入合同

### 3.1 draftPage

`draftPage` 必须提供：

```js
{
  draftDocumentId,
  projectId,
  pageId,
  contentBlocks: [],
  scriptBlocks: [],
  pageAssets: []
}
```

首批支持的内容来源：

- `heading` 与 `text`；
- `list` 及每个 `listItemId`；
- `metric_group` 及每个 `metricId`；
- `table` 及每个 `tableCellId`；
- 每个 `scriptBlockId`；
- 每个 `pageAssetId`。

表格行列保留在 Table 投影中，首批可被 LayoutElement 直接引用的最小表格对象是 `tableCellId`。

### 3.2 resolvedPageAssets

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

`pageAssetId` 与 DraftPage 的 PageAsset 引用必须一致，`assetId` 也必须匹配。缺少 ObjectRef、引用未解析或身份不一致时，来源索引构建失败。

## 4. 输出合同

输出是普通对象，所有顶层键都由 `sourceRefKey()` 生成：

```text
content-block:<contentBlockId>
script-block:<scriptBlockId>
page-asset:<pageAssetId>
content-item:<contentBlockId>:list-item:<listItemId>
content-item:<contentBlockId>:metric:<metricId>
content-item:<contentBlockId>:table-cell:<tableCellId>
```

没有额外的顶层 metadata、ui 或 migration 键。`createLayoutRenderPlan()` 可以直接根据 LayoutElement.sourceRef 查找对应 payload。

## 5. 安全投影

来源索引使用字段白名单构建，不复制调用方对象。结果不得包含：

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

素材只暴露 ObjectRef、显示身份、角色、说明和安全元数据。真实文件字节由未来 Asset Resolver 在授权边界内读取，不进入 LayoutPageDocument 或来源索引。

## 6. 引用完整性

构建来源索引前必须验证：

- 同类稳定 ID 不重复；
- PageAsset 链接存在对应已解析素材；
- PageAsset 的 `assetId` 与解析结果一致；
- ObjectRef 的 SHA-256、sizeBytes 和 mimeType 合法；
- ScriptBlock 引用的 contentBlockId 存在；
- ScriptBlock 引用的 assetId 在当前页面可用；
- TableCell 引用的 tableColumnId 存在。

任一错误都会拒绝整个索引，不产生部分结果。

## 7. 稳定错误码

```text
layout_source_invalid_document
layout_source_invalid_identity
layout_source_contract_unavailable
layout_source_duplicate_identity
layout_source_reference_missing
layout_source_reference_mismatch
layout_source_object_ref_required
```

错误对象使用 `LayoutSourceContractError`，携带 `code` 和可选 `details`，不得暴露画布引擎内部异常作为领域合同。

## 8. 与 v0.1.1 的集成门槛

本合同已经实现并可独立验证，但在以下条件满足前不得接入生产 Runtime：

1. v0.1.1 将 DraftPage 正式统一为稳定 ContentBlock、ListItem、Metric、TableCell、ScriptBlock 和 PageAsset 身份；
2. 素材使用 ObjectRef，不再以 Data URL 作为事实源；
3. Standard Adapter 连续导出保持上述身份稳定；
4. Canonical Snapshot、dirty buffer 与 no-op Revision 加固完成；
5. v0.1.1 GitHub CI 全绿；
6. 接入层只传递来源索引，不让引擎私有 nodeId 进入领域层。

在门槛前，本包只由独立测试、Fixture 和排版样机使用。

## 9. 明确不包含

当前合同不实现：

- Production Layout UI；
- Repository 持久化；
- OpenPencil Adapter；
- 排版 Agent Command；
- 草案与排版正式双向提交；
- 分页、模板、母版、动画；
- HTML、PNG、PDF、PPTX 成品导出。
