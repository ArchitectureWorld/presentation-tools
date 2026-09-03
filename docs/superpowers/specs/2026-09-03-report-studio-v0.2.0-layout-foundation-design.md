---
document_id: report-studio-v0.2.0-layout-foundation-design
status: approved-for-parallel-development
product_version: 0.2.0-alpha.1
branch: feat/report-studio-v0.2.0-layout
base_branch: feat/report-studio-v0.1.1-hardening
base_commit: 29294803681758e0b65a0bc51f7ed9ab810cde9a
updated_at: 2026-09-03
---

# Report Studio v0.2.0 排版基础设计

## 1. 目标

本支线并行建设排版阶段的引擎无关基础，先稳定 `LayoutPageDocument`、草案来源绑定、几何编辑、同步状态和渲染投影，再接入 OpenPencil 或其他画布引擎。

当前目标不是把排版阶段提前并入 `v0.1.1`，也不是开放正式排版 UI。`v0.1.1` 继续负责大纲、草案、素材、持久化与 DSH 闭环加固；本支线只通过明确接口等待未来集成。

## 2. 固定边界

### 2.1 本阶段包含

- 引擎无关的 `LayoutPageDocument`；
- `layoutPageId`、`layoutElementId` 类型化 UUIDv7；
- 16:9 默认画布 `1600 × 900 studio_unit`；
- `text / image / shape / group` 四类基础排版元素；
- `content-block / script-block / content-item / page-asset` 四类来源引用；
- `live / detached` 同步策略；
- `normal / orphaned` 元素状态；
- 草案版本前进后的 `stale` 标记；
- 来源重建和引擎无关 Render Plan；
- 独立测试和独立 CI。

### 2.2 本阶段不包含

- 修改 `apps/studio-local/public/**` 正式 UI；
- 修改 `v0.1.1` Repository、Canonical Snapshot 或 Agent Command；
- OpenPencil 私有文档作为事实源；
- 正式分页、模板、母版、动画和时间线；
- HTML、PNG、PDF、PPTX 成品导出；
- 排版 Agent Command；
- 草案与排版的正式双向提交；
- 将排版入口开放给用户。

## 3. 架构

```text
Draft Semantic Source Index
            │
            │ sourceRef
            ▼
LayoutPageDocument               Canonical visual fact
            │
            │ createLayoutRenderPlan()
            ▼
Engine-neutral Render Plan
            │
            ├─ OpenPencil Adapter       later
            ├─ HTML/SVG Adapter         later
            └─ PPTX/PDF Export Adapter  later
```

排版文档只保存几何、样式、层级、同步策略和来源身份。`live` 元素不复制草案正文或素材内容；渲染时从来源索引解析。画布引擎生成的节点 ID、文件结构和缓存只能存在于后续 `LayoutEngineBinding`，不能进入排版事实源。

## 4. Canonical Layout

### 4.1 LayoutPageDocument

```js
{
  schemaVersion: 'report-studio.layout.v0.2.0-alpha.1',
  layoutPageId,
  projectId,
  pageId,
  canvas: { width, height, unit: 'studio_unit' },
  baseDraftRevision,
  lastSyncedDraftRevision,
  syncState: 'synced' | 'stale' | 'orphaned',
  elements: LayoutElement[]
}
```

- `baseDraftRevision` 是创建排版页时的项目内容 Revision；
- `lastSyncedDraftRevision` 是最近一次完成来源核对的项目内容 Revision；
- 不建立第二套草案 Revision 或排版 Revision 计数器；
- 同一项目的正式 Revision 由未来集成层统一管理。

### 4.2 LayoutElement

```js
{
  layoutElementId,
  type: 'text' | 'image' | 'shape' | 'group',
  frame: { x, y, width, height, rotation },
  style: {},
  zIndex,
  syncPolicy: 'live' | 'detached',
  lastSyncedSourceRevision,
  elementState: 'normal' | 'orphaned'
}
```

画布使用逻辑 `studio_unit`。`x` 和 `y` 可为负数以支持出血和局部越界；`width`、`height` 必须为正数；所有几何值必须有限。浏览器屏幕像素和 DOM 位置不得进入 Canonical Layout。

### 4.3 live 元素

```js
{
  syncPolicy: 'live',
  sourceRef: SourceRef,
  lastSyncedSourceRevision: 18
}
```

规则：

- 内容只来自 `sourceRef`；
- 禁止同时保存 `localPayload`；
- 草案内容更新不会覆盖 `frame / style / zIndex`；
- 来源消失时元素变为 `orphaned`，几何和样式继续保留；
- 来源恢复后可以重新变为 `normal`。

### 4.4 detached 元素

```js
{
  syncPolicy: 'detached',
  localPayload: {},
  lastSyncedSourceRevision: null
}
```

规则：

- 必须保存排版本地 `localPayload`；
- 不保留可写的 `sourceRef`；
- 不参与自动草案同步；
- 适用于装饰图形、独立文字或用户明确解除绑定后的内容。

## 5. SourceRef

首批来源引用：

```js
{ kind: 'content-block', contentBlockId }
{ kind: 'script-block', scriptBlockId }
{ kind: 'page-asset', pageAssetId }
{
  kind: 'content-item',
  contentBlockId,
  itemKind: 'list-item' | 'metric' | 'table-cell',
  itemId
}
```

`sourceRefKey()` 产生确定性索引键，但索引键不是新的领域身份。稳定身份仍由被引用对象 ID 决定。

## 6. 同步模型

### 6.1 草案前进

`markLayoutDraftAdvanced(layout, draftRevision)` 只把排版页标记为 `stale`，不得移动元素、修改样式或复制草案内容。

### 6.2 来源核对

`reconcileLayoutSources(layout, sources, draftRevision)`：

- 检查每个 `live` sourceRef 是否存在；
- 来源存在：元素为 `normal`，更新 `lastSyncedSourceRevision`；
- 来源缺失：元素为 `orphaned`，保留原同步 Revision；
- 任一来源缺失时页面 `syncState=orphaned`；
- 所有来源有效时页面 `syncState=synced`；
- 几何、样式和层级完全不变。

### 6.3 渲染投影

`createLayoutRenderPlan(layout, sources)` 返回画布引擎可消费的只读投影：

- `live` 元素从来源索引取得 payload；
- `detached` 元素读取 localPayload；
- 缺失的 `live` 来源返回 `payload=null` 且投影状态为 `orphaned`；
- 函数不得修改 Canonical Layout。

## 7. 首批公共 API

```js
createLayoutPage(input)
addLiveLayoutElement(layout, input)
addDetachedLayoutElement(layout, input)
updateLayoutElementFrame(layout, layoutElementId, patch)
detachLayoutElement(layout, layoutElementId, localPayload)
markLayoutDraftAdvanced(layout, draftRevision)
reconcileLayoutSources(layout, sources, draftRevision)
createLayoutRenderPlan(layout, sources)
assertLayoutPageDocument(layout)
createLayoutId(kind, options)
sourceRefKey(sourceRef)
```

全部修改函数返回新的对象，不原地修改输入。第一阶段不加入存储、网络和 UI 副作用。

## 8. 错误规则

排版 Contract 使用稳定错误码，包括：

- `layout_invalid_document`
- `layout_unsupported_schema`
- `layout_invalid_identity`
- `layout_invalid_canvas`
- `layout_invalid_frame`
- `layout_invalid_source_ref`
- `layout_live_payload_forbidden`
- `layout_detached_payload_required`
- `layout_detached_source_forbidden`
- `layout_duplicate_element_id`
- `layout_element_not_found`

错误必须包含可操作信息，不得依赖某个画布引擎异常文本作为领域错误。

## 9. 测试与独立门禁

首批测试必须证明：

- 类型化 UUIDv7；
- `live` 不复制来源内容；
- `detached` 不保留可写 sourceRef；
- 重复元素 ID 被拒绝；
- frame 更新不改变来源、样式和同步元数据；
- draft 前进只标记 stale；
- orphaned 检测不改变几何；
- 来源恢复可重新同步；
- Render Plan 不修改 Canonical Layout。

本支线配置独立 CI，只运行排版基础测试和验证脚本。它不以 `v0.1.1` 当前红色门禁作为排版基础是否正确的判断依据，也不掩盖 `v0.1.1` 的既有问题。

## 10. 正式集成门槛

下列条件未满足前，排版基础不得并入生产 Runtime：

1. `v0.1.1` ContentBlock、ListItem、ScriptBlock、PageAsset ID 稳定；
2. 素材使用 ObjectRef，不再以 Data URL 作为事实源；
3. Canonical Snapshot 与 Standard Adapter 稳定；
4. 草案 dirty buffer 和 no-op Revision 已修复；
5. `v0.1.1` GitHub CI 全绿；
6. 排版 Adapter 不把引擎私有 ID 扩散到领域层。

满足后再建立正式 `LayoutPageDocument` 存储、OpenPencil Adapter、排版 UI 和草案双向同步。
