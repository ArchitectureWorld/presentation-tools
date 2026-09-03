---
document_id: report-studio-v0.2.0-openpencil-adapter-handoff
status: ready-for-isolated-runtime-smoke
product_version: 0.2.0-alpha.2
branch: feat/report-studio-v0.2.0-layout
phase_base_commit: 69859cdd65abebeadba196ad3e8e0f3f1fce5675
verified_source_commit: 4ff3a5040547a27539eea0ffda4bb003bc3679d6
workflow_run_id: 33739622248
updated_at: 2026-09-03
---

# Report Studio v0.2.0 OpenPencil Adapter Handoff

## 1. 当前状态

```text
Repository: ArchitectureWorld/presentation-tools
Working branch: feat/report-studio-v0.2.0-layout
Phase base: 69859cdd65abebeadba196ad3e8e0f3f1fce5675
Verified source: 4ff3a5040547a27539eea0ffda4bb003bc3679d6
Product version: 0.2.0-alpha.2
GitHub Actions: 33739622248 / success
Tests: 53 passed / 0 failed
```

该阶段已经完成“从 Report Studio 引擎无关排版数据，到 OpenPencil 事务与双向节点映射”的隔离实现。它不是生产集成，也没有修改 v0.1.1 Runtime。

## 2. 外部兼容性坐标

```text
OpenPencil:
  repository: ZSeven-W/openpencil
  commit: e6c9bcef45c5b48b38f42824d56b5513178e1a0b

DSH OpenPencil:
  repository: ZSeven-W/dsh-openpencil
  commit: 99e05cdbae5e26c920cc20e0793c66446685b0cd
  package: @zseven-w/dsh-openpencil@0.1.0-rc.9
  Node.js: >=24.11.0
```

本阶段依赖的最小外部协议：

```text
batch_design
I(parentId,nodeJson)
U(nodeId,patchJson)
results[{binding,nodeId}]
managed editor capability
```

正式 Runtime 烟测必须重新进行能力探测，不能只根据版本号假定协议仍然存在。

## 3. 新增文件

```text
packages/studio-layout-engine-binding/
├─ index.mjs
├─ index.test.mjs
├─ package.json
└─ README.md

packages/studio-layout-openpencil/
├─ index.mjs
├─ index.test.mjs
├─ package.json
├─ README.md
└─ compatibility/openpencil-baseline.json

scripts/
└─ verify-layout-openpencil-v0.2.0.mjs

docs/superpowers/specs/
└─ 2026-09-03-report-studio-v0.2.0-openpencil-adapter-design.md

docs/superpowers/plans/
└─ 2026-09-03-report-studio-v0.2.0-openpencil-adapter.md
```

同时更新：

```text
.github/workflows/report-studio-v0.2.0-layout-ci.yml
scripts/verify-layout-spike.mjs
```

浏览器烟测脚本的修改仅修复 Chromium 退出后的临时目录清理竞态，不改变排版样机行为或断言。

## 4. 公共接口

### 4.1 Engine Binding

```js
import {
  ENGINE_BINDING_SCHEMA_VERSION,
  LayoutEngineBindingError,
  createLayoutEngineBindingId,
  assertLayoutEngineBinding,
  engineNodeIdForLayoutElement,
  layoutElementIdForEngineNode,
  mapEngineSelection,
} from './packages/studio-layout-engine-binding/index.mjs'
```

职责：

- 保存可重建的引擎节点映射；
- 验证一对一身份关系；
- 提供正向、反向和选择映射；
- 保证 engineNodeId 不进入 Canonical Layout。

### 4.2 OpenPencil Adapter

```js
import {
  OPENPENCIL_ADAPTER_VERSION,
  OpenPencilAdapterError,
  compileOpenPencilCreateTransaction,
  createOpenPencilEngineBinding,
  compileOpenPencilFramePatchTransaction,
  mapOpenPencilSelection,
} from './packages/studio-layout-openpencil/index.mjs'
```

职责：

- 编译确定性 `batch_design` 创建事务；
- 将外部执行结果转换为 `LayoutEngineBinding`；
- 编译只修改 Frame 的更新事务；
- 将 OpenPencil selection 映射回 LayoutElement。

## 5. 基础调用顺序

```js
const transaction = compileOpenPencilCreateTransaction(renderPlan, {
  assetUrlResolver(assetPayload) {
    return issueShortLivedAssetCapability(assetPayload.objectRef)
  },
})

// 下一阶段由隔离 Runtime Executor 调用真实 dsh-openpencil batch_design。
const externalResult = await executor.batchDesign({
  operations: transaction.operations,
})

const binding = createOpenPencilEngineBinding(transaction, externalResult, {
  layoutPageId: renderPlan.layoutPageId,
  layoutEngineBindingId: createLayoutEngineBindingId(),
  engineDocumentRef: {
    provider: 'openpencil',
    documentId: externalDocumentId,
    contentHash: null,
  },
  generatedFromRevision: sourceRevision,
  sourceStateHash,
})
```

上例中的 `executor.batchDesign()` 和 `issueShortLivedAssetCapability()` 是下一阶段应实现的 Adapter 边界，不是当前仓库中已经存在的 API。

几何变更：

```js
const patchTransaction = compileOpenPencilFramePatchTransaction(binding, [
  {
    layoutElementId,
    frame: { x, y, width, height, rotation },
  },
])

await executor.batchDesign({
  operations: patchTransaction.operations,
})
```

## 6. 关键不变量

1. `LayoutPageDocument` 是视觉排版事实源。
2. OpenPencil `.op` 文档是可重建的引擎派生物。
3. `engineNodeId` 只能进入 `LayoutEngineBinding`。
4. `live` 内容在 Render Plan 阶段解析，不能复制进 Canonical Layout。
5. 图片只能使用短期 HTTP(S) Capability URL，不能使用 Data URL 或本机路径。
6. 同一 Render Plan 必须生成确定性 operations。
7. OpenPencil 返回缺失、未知或重复绑定时，整次 Binding 创建失败。
8. 增量 Frame Patch 不得夹带内容、样式或来源变更。
9. 未映射 OpenPencil 节点不得自动绑定到相似 LayoutElement。
10. 当前阶段不得写生产 Repository。

## 7. 错误码

Engine Binding：

```text
layout_engine_binding_invalid
layout_engine_binding_invalid_id_time
layout_engine_binding_invalid_random_source
layout_engine_binding_duplicate_layout_element
layout_engine_binding_duplicate_engine_node
layout_engine_binding_duplicate_binding_key
```

OpenPencil Adapter：

```text
openpencil_invalid_render_plan
openpencil_unsupported_element_type
openpencil_unsupported_shape_kind
openpencil_asset_url_unavailable
openpencil_asset_url_forbidden
openpencil_invalid_execution_result
openpencil_missing_binding
openpencil_unknown_binding
openpencil_duplicate_result_binding
openpencil_duplicate_engine_node
openpencil_unmapped_layout_element
openpencil_empty_patch
```

## 8. 验证命令

```bash
node --test \
  packages/studio-layout-contracts/*.test.mjs \
  packages/studio-layout-core/*.test.mjs \
  packages/studio-layout-adapter/*.test.mjs \
  packages/studio-layout-integration/*.test.mjs \
  packages/studio-layout-engine-binding/*.test.mjs \
  packages/studio-layout-openpencil/*.test.mjs \
  tools/layout-spike/*.test.mjs

node scripts/verify-layout-v0.2.0.mjs
node scripts/verify-layout-openpencil-v0.2.0.mjs
CHROMIUM_PATH=google-chrome node scripts/verify-layout-spike.mjs
```

预期：

```text
53 tests / 53 passed / 0 failed
REPORT_STUDIO_LAYOUT_V0_2_0_FOUNDATION_PASS
REPORT_STUDIO_OPENPENCIL_ADAPTER_V0_2_0_PASS
REPORT_STUDIO_LAYOUT_SPIKE_PASS
```

## 9. 已知边界

- Adapter 目前只覆盖 `text / image / shape / group`；
- 树形分组当前被扁平编译到页面根 frame；
- 未实现 z-order 增量更新；
- 未实现内容和样式增量更新；
- 未实现 OpenPencil 删除、移动、复制和替换事务；
- 未验证真实 OpenPencil 节点字段是否全部被当前固定版本接受；
- 未验证真实结果在所有平台都返回相同 `results` 结构；
- 未实现真实 `.op` 文档生命周期；
- 未实现 OpenPencil 编辑器事件回写；
- 未实现 Binding 持久化与失效重建；
- dsh-openpencil 的 Node.js 下限高于当前纯 Adapter CI 的 Node.js 22，下阶段需独立 Node.js 24.11+ 环境。

## 10. 下一阶段执行入口

继续在同一支线：

```text
feat/report-studio-v0.2.0-layout
```

下一阶段只能新增隔离式 Runtime Compatibility Harness，建议目录：

```text
tools/openpencil-runtime-smoke/
packages/studio-layout-openpencil-runtime/
scripts/verify-openpencil-runtime.mjs
docs/acceptance/report-studio-v0.2.0-openpencil-runtime-smoke.md
```

执行顺序：

```text
创建临时 DSH Home
→ 使用 Node.js >=24.11.0
→ 安装固定 dsh-openpencil 包与平台包
→ 启动隔离 DSH Web Profile
→ 探测 batch_design 和 managed editor
→ 创建临时 .op 文档
→ 发送当前 Adapter 的创建事务
→ 校验真实 results/binding/node geometry
→ 发送 Frame Patch
→ 重新打开文档校验
→ 清理临时 Home 与文档
```

禁止事项：

- 不使用用户真实 DSH Home；
- 不安装到生产 Profile；
- 不读取或修改真实 Report Studio 项目；
- 不把 OpenPencil 私有 JSON 写进 Canonical Layout；
- 不因为真实上游字段不同就绕过 Adapter 校验；
- 不修改 v0.1.1 Runtime 来配合烟测。

## 11. 下一阶段完成门槛

```text
REAL_PACKAGE_INSTALL=PASS
BATCH_DESIGN_CAPABILITY_PROBED=PASS
CREATE_TRANSACTION_ACCEPTED=PASS
REAL_RESULT_BINDINGS_VALID=PASS
FRAME_PATCH_ACCEPTED=PASS
DOCUMENT_REOPEN=PASS
TEMPORARY_ENVIRONMENT_CLEANED=PASS
PRODUCTION_DATA_TOUCHED=NO
```

满足上述门槛后，才讨论 OpenPencil 托管编辑器嵌入和 `LayoutEngineBinding` 的正式持久化。
