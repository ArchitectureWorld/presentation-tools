---
document_id: report-studio-v0.2.0-openpencil-adapter-design
status: approved-for-implementation
product_version: 0.2.0-alpha.2
branch: feat/report-studio-v0.2.0-layout
base_commit: 69859cdd65abebeadba196ad3e8e0f3f1fce5675
openpencil_repository: ZSeven-W/openpencil
openpencil_commit: e6c9bcef45c5b48b38f42824d56b5513178e1a0b
dsh_openpencil_repository: ZSeven-W/dsh-openpencil
dsh_openpencil_commit: 99e05cdbae5e26c920cc20e0793c66446685b0cd
dsh_openpencil_package: "@zseven-w/dsh-openpencil@0.1.0-rc.9"
updated_at: 2026-09-03
---

# Report Studio v0.2.0 OpenPencil Adapter 设计

## 1. 目标

在不接入 v0.1.1 生产 Repository、正式 UI 或 DSH Agent 写入链的前提下，验证 Report Studio 的引擎无关 `LayoutPageDocument` 能否稳定转换为 OpenPencil 事务，并在 OpenPencil 返回真实节点 ID 后建立可重建、可双向查询的 `LayoutEngineBinding`。

本阶段选择 `ZSeven-W/openpencil` 及其 DSH 插件 `ZSeven-W/dsh-openpencil` 作为首选引擎路线。原因是该路线同时提供真实 `.op` 文档、事务式 `batch_design`、托管编辑器和 DSH 工具面；Report Studio 不复制其 Agent Runtime，也不依赖 OpenPencil 私有文档成为项目事实源。

## 2. 固定边界

### 2.1 本阶段包含

- `LayoutEngineBinding` 独立运行记录；
- `layoutEngineBindingId` 类型化 UUIDv7；
- `layoutElementId ↔ engineNodeId` 一对一节点映射；
- OpenPencil `batch_design` 创建事务编译；
- OpenPencil `U(nodeId, patch)` 几何更新事务编译；
- OpenPencil 执行结果到 Binding 的严格校验；
- OpenPencil selection 到 Layout 身份的反向映射；
- OpenPencil 兼容性基线清单；
- 纯 Node.js 单元测试、确定性验证脚本和独立 CI。

### 2.2 本阶段不包含

- 安装或启动真实 OpenPencil 二进制；
- 直接写入 `.op` 文件；
- 依赖 OpenPencil 内部 Rust/TypeScript私有模块；
- 修改 `apps/studio-local/public/**`；
- 修改 v0.1.1 Repository、Canonical Snapshot、Standard Adapter 或 DSH Runtime；
- 将 LayoutEngineBinding 写入生产控制存储；
- 正式保存、撤销、重做或协同；
- 排版 Agent Command；
- OpenPencil 托管编辑器嵌入 Report Studio；
- HTML、PNG、PDF、PPTX 成品导出。

## 3. 架构

```text
Engine-neutral Render Plan
          │
          │ compileOpenPencilCreateTransaction()
          ▼
OpenPencil batch_design operations
          │
          │ external executor: dsh-openpencil / OpenPencil MCP
          ▼
{ results: [{ binding, nodeId }] }
          │
          │ createOpenPencilEngineBinding()
          ▼
LayoutEngineBinding
          │
          ├─ engineNodeIdForLayoutElement()
          ├─ layoutElementIdForEngineNode()
          ├─ mapOpenPencilSelection()
          └─ compileOpenPencilFramePatchTransaction()
```

`LayoutPageDocument` 仍是排版视觉事实源。OpenPencil 文档和节点 ID 属于可重建的引擎派生物。引擎文件丢失后，应能从 Render Plan 再次创建文档并生成新 Binding；不得把旧 engineNodeId 写回 Canonical Layout。

## 4. LayoutEngineBinding

```js
{
  schemaVersion: 'report-studio.layout-engine-binding.v0.2.0-alpha.2',
  layoutEngineBindingId,
  layoutPageId,
  engine: 'openpencil',
  engineAdapterVersion: '0.2.0-alpha.2',
  engineDocumentRef: {
    provider: 'openpencil',
    documentId,
    contentHash: null | 'sha256:...'
  },
  rootEngineNodeId,
  generatedFromRevision,
  sourceStateHash,
  nodeMap: [
    { layoutElementId, engineNodeId, bindingKey }
  ]
}
```

规则：

- `layoutElementId`、`engineNodeId`、`bindingKey` 均不得重复；
- `rootEngineNodeId` 不属于任何 LayoutElement；
- Binding 不进入 Canonical Layout；
- Binding 不保存宿主机绝对路径；
- Binding 可被新的执行结果整体替换，不允许局部猜测修复；
- `sourceStateHash` 由调用方提供，用于判断 Binding 是否对应当前 Render Plan。

## 5. OpenPencil 创建事务

`compileOpenPencilCreateTransaction(renderPlan, options)` 生成：

```js
{
  adapterVersion: '0.2.0-alpha.2',
  engine: 'openpencil',
  rootBinding: 'rs_page',
  operations: 'rs_page=I(null,{...})\nrs_el_ab12...=I(rs_page,{...})',
  expectedBindings: [
    { bindingKey, layoutElementId }
  ]
}
```

### 5.1 Binding Key

- 根节点固定为 `rs_page`；
- 元素绑定键为 `rs_el_` 加 `layoutElementId` 的 SHA-256 前 16 个十六进制字符；
- Binding Key 只是一次事务内的稳定变量名，不是领域 ID；
- 事务中不得直接把 `layoutElementId` 当作 OpenPencil `id`。

### 5.2 根节点

根节点使用 OpenPencil `frame`：

```js
{
  type: 'frame',
  name: 'Report Studio Page',
  x: 0,
  y: 0,
  width: canvas.width,
  height: canvas.height
}
```

### 5.3 元素映射

- `text` → OpenPencil `text`；
- `image` → OpenPencil `image`，必须由 `assetUrlResolver` 返回可访问的 HTTP(S) URL；禁止 Data URL 和文件系统路径；
- `shape` → `rectangle / ellipse / line`，由 `payload.shapeKind` 决定，缺省为 `rectangle`；
- `group` → OpenPencil `frame`；
- 所有元素保留 `x/y/width/height/rotation`；
- 仅映射白名单样式，不透传任意对象；
- 不支持的元素或样式必须明确报错，不得静默猜测。

### 5.4 白名单样式

文本：`fontFamily / fontSize / fontWeight / textAlign / textColor / opacity`。

图形：`fill / stroke / strokeWidth / cornerRadius / opacity`。

图片：`cornerRadius / opacity / fit`。

组：`fill / opacity / cornerRadius`。

## 6. 执行结果与映射

OpenPencil `batch_design` 返回的 `results` 必须包含根 Binding 和每一个预期元素 Binding。

`createOpenPencilEngineBinding(transaction, result, metadata)` 必须拒绝：

- 缺失根节点；
- 缺失任意元素；
- 重复 Binding；
- 重复 engineNodeId；
- 未知 Binding；
- 空 nodeId；
- 结果与事务 engine 不匹配。

## 7. 增量几何事务

`compileOpenPencilFramePatchTransaction(binding, changes)`：

- 只接受 `{ layoutElementId, frame }`；
- 根据 Binding 查找 engineNodeId；
- 生成 `U("engine-node-id", {x,y,width,height,rotation})`；
- 不修改内容、样式、层级或来源；
- 未映射元素必须失败；
- 空变更返回显式 `openpencil_empty_patch` 错误。

## 8. 反向选择映射

`mapOpenPencilSelection(binding, selectedEngineNodeIds)` 返回：

```js
{
  layoutElementIds: [],
  unmappedEngineNodeIds: []
}
```

OpenPencil 可能包含根节点或引擎内部节点，因此未知节点不自动绑定到相似元素，而是进入 `unmappedEngineNodeIds`。

## 9. 外部兼容性基线

固定核对：

```text
OpenPencil repository: ZSeven-W/openpencil
OpenPencil commit: e6c9bcef45c5b48b38f42824d56b5513178e1a0b
DSH plugin repository: ZSeven-W/dsh-openpencil
DSH plugin commit: 99e05cdbae5e26c920cc20e0793c66446685b0cd
DSH plugin package: @zseven-w/dsh-openpencil@0.1.0-rc.9
Required operation surface: I / U and transactional batch_design
Required result surface: results[{binding,nodeId}]
```

该基线只说明 Adapter 编译目标。正式接入前必须在真实 DSH Profile 中重新验证当前安装版本；不得因为上游版本号相同就跳过能力探测。

## 10. 错误码

- `layout_engine_binding_invalid`
- `layout_engine_binding_duplicate_layout_element`
- `layout_engine_binding_duplicate_engine_node`
- `layout_engine_binding_duplicate_binding_key`
- `openpencil_invalid_render_plan`
- `openpencil_unsupported_element_type`
- `openpencil_unsupported_shape_kind`
- `openpencil_asset_url_unavailable`
- `openpencil_asset_url_forbidden`
- `openpencil_invalid_execution_result`
- `openpencil_missing_binding`
- `openpencil_unknown_binding`
- `openpencil_duplicate_result_binding`
- `openpencil_duplicate_engine_node`
- `openpencil_unmapped_layout_element`
- `openpencil_empty_patch`

## 11. 验收门槛

- 创建事务顺序确定；
- 相同 Render Plan 生成完全相同 operations；
- Canonical Layout 与 Render Plan 均不被修改；
- engineNodeId 不进入 Canonical Layout；
- Binding 一对一校验完整；
- 选择可反向映射；
- 几何补丁只包含 Frame；
- 图片不允许 Base64、Data URL 或绝对文件路径；
- CI 在 Node.js 22 的干净环境通过；
- 生产 UI、Repository 和 DSH Runtime 无修改。
