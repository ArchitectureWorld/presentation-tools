---
document_id: report-studio-v0.2.0-layout-foundation-handoff
status: ready-for-next-layout-stage
product_version: 0.2.0-alpha.1
branch: feat/report-studio-v0.2.0-layout
base_commit: 29294803681758e0b65a0bc51f7ed9ab810cde9a
verified_source_commit: 9dfc0bae33e76be377da1d3063f6cf36a5719b1a
workflow_run_id: 33736572988
updated_at: 2026-09-03
---

# Report Studio v0.2.0 排版基础 Handoff

## 1. 接手结论

排版基础第一里程碑已经完成。下一开发者不需要重新讨论 Canonical Layout、`live / detached`、`sourceRef` 或 Adapter 是否应成为事实源；这些边界已经实现并由独立 CI 验证。

当前支线只允许继续排版方向开发：

```text
Repository: ArchitectureWorld/presentation-tools
Branch: feat/report-studio-v0.2.0-layout
Verified source commit: 9dfc0bae33e76be377da1d3063f6cf36a5719b1a
```

不要把本支线合并进仍在加固的 v0.1.1 Runtime，也不要修改 Presentation Standard Project Directory `0.1.0`。

## 2. 架构骨架

```text
DraftPageDocument + ObjectRef PageAssets
                    │
                    ▼
buildLayoutSourceIndex()
                    │
                    ▼
Source Index keyed by sourceRefKey()
                    │
                    ▼
LayoutPageDocument
                    │
                    ▼
createLayoutRenderPlan()
                    │
                    ▼
Layout Adapter Interface
                    │
          ┌─────────┴─────────┐
          ▼                   ▼
Independent DOM Spike    Future OpenPencil Adapter
```

事实源边界：

- DraftPageDocument 是页面语义内容事实源；
- LayoutPageDocument 是几何、样式、层级和同步策略事实源；
- Render Plan 是只读组合投影；
- Engine document、DOM 和 `engineNodeId` 都不是事实源。

## 3. 目录与职责

```text
packages/studio-layout-contracts/
  Canonical Layout 校验、错误码、UUIDv7、sourceRefKey

packages/studio-layout-core/
  纯函数领域操作、同步状态、来源核对、Render Plan

packages/studio-layout-adapter/
  可替换画布引擎生命周期接口

packages/studio-layout-integration/
  稳定 DraftPage/ObjectRef → Layout Source Index

tools/layout-spike/
  固定 Fixture 的独立浏览器样机；不写生产数据

scripts/verify-layout-v0.2.0.mjs
  确定性领域验证

scripts/verify-layout-spike.mjs
  Headless Chrome 真实拖拽、视口和刷新复位烟测

.github/workflows/report-studio-v0.2.0-layout-ci.yml
  独立排版门禁
```

## 4. 公共接口

### 4.1 Contracts

```js
LAYOUT_SCHEMA_VERSION
DEFAULT_LAYOUT_CANVAS
LayoutContractError
createLayoutId(kind, options)
sourceRefKey(sourceRef)
assertLayoutPageDocument(layout)
```

### 4.2 Core

```js
createLayoutPage(input)
addLiveLayoutElement(layout, input)
addDetachedLayoutElement(layout, input)
updateLayoutElementFrame(layout, layoutElementId, patch)
detachLayoutElement(layout, layoutElementId, localPayload)
markLayoutDraftAdvanced(layout, draftRevision)
reconcileLayoutSources(layout, sources, draftRevision)
createLayoutRenderPlan(layout, sources)
```

所有修改函数都是 immutable operation。

### 4.3 Adapter

```js
assertLayoutAdapter(adapter)
```

Adapter 必须实现：

```text
mount(root, handlers)
render(viewModel)
readViewportState()
destroy()
```

### 4.4 Integration

```js
buildLayoutSourceIndex(draftPage, resolvedPageAssets)
LayoutSourceContractError
```

输出对象的顶层键只能来自：

```js
sourceRefKey(sourceRef)
```

## 5. Canonical Layout 规则

### live

```text
有 sourceRef
无 localPayload
内容在 Render Plan 阶段从 Source Index 解析
几何、样式、zIndex 独立保存
```

### detached

```text
无可写 sourceRef
必须有 localPayload
不参与草案自动同步
```

### stale / orphaned

- 草案 Revision 前进：页面标记 `stale`；
-来源缺失：对应 live 元素标记 `orphaned`；
-来源恢复：重新核对后回到 `normal / synced`；
-所有同步变化都不能修改 frame、style 或 zIndex。

## 6. Source Integration 规则

当前接受：

- `heading / text` ContentBlock；
- `list` 和 `listItemId`；
- `metric_group` 和 `metricId`；
- `table` 和 `tableCellId`；
- `scriptBlockId`；
- ObjectRef-backed `pageAssetId`。

当前明确拒绝：

```js
{ heading, body, bullets, script, assets }
```

错误码：

```text
layout_source_contract_unavailable
```

不要增加“按数组位置临时生成 ID”或“按文本猜测 sourceRef”的兼容补丁。

来源投影禁止携带：

```text
dataUrl
dataBase64
rawBytes
standardArchive
migration
ui
DSH Session 私有状态
```

## 7. 独立样机

启动仓库根静态服务后访问：

```text
/tools/layout-spike/
```

例如：

```bash
python -m http.server 8080
```

样机支持选择、拖动、缩放、重置和复制 Frame ChangeSet。它只使用固定内存 Fixture，刷新页面会复位，不得把这套临时状态当作生产持久化实现。

## 8. 验证证据

```text
Workflow: Report Studio v0.2.0 Layout Foundation CI
Run: 33736572988
Tests: 31/31
Foundation marker: REPORT_STUDIO_LAYOUT_V0_2_0_FOUNDATION_PASS
Browser marker: REPORT_STUDIO_LAYOUT_SPIKE_PASS
Viewports: 1366×768, 1920×1080
Browser runtime errors: 0
```

复验命令：

```bash
node --test \
  packages/studio-layout-contracts/*.test.mjs \
  packages/studio-layout-core/*.test.mjs \
  packages/studio-layout-adapter/*.test.mjs \
  packages/studio-layout-integration/*.test.mjs \
  tools/layout-spike/*.test.mjs

node scripts/verify-layout-v0.2.0.mjs
CHROMIUM_PATH=google-chrome node scripts/verify-layout-spike.mjs
```

## 9. 提交链

```text
9d7db0cc320b4d61c7a4dd6d6dfe80193d78e7a6  docs(layout): define v0.2.0 parallel foundation
c543f68dd2d2b0d2300f42c76642efdc034d1bec  test(layout): define v0.2.0 foundation behavior
993bcfce21d005bd02cb7bc3913b33f6f23dafd8  feat(layout): implement v0.2.0 engine-neutral foundation
7022308f9ca75c254ccdd9ce99a3c4c95aa9bb10  test(layout): define adapter and isolated spike behavior
30b811847c63629a6d799e7ffd087d437d750ccf  feat(layout): add adapter boundary and isolated canvas spike
1ffac98f1989d87a020e7602f6d7d9e145550859  test(layout): expose browser drag identity diagnostics
a50c5f890102fdcea3160716a2f6eb373fee3fd9  test(layout): define stabilized draft source contract
9dfc0bae33e76be377da1d3063f6cf36a5719b1a  feat(layout): add stabilized draft source integration contract
```

## 10. 暂缓和禁止事项

在 v0.1.1 集成门槛满足前，不得：

- 修改 `apps/studio-local/public/**` 开放 Layout Tab；
-把 LayoutPageDocument 写入当前 v0.1.1 Repository；
-依赖旧简化页面模型；
-把 Data URL 或附件字节写入 Layout；
-让 OpenPencil 文件成为事实源；
-增加排版 Agent 写入命令；
-实现正式分页或成品导出；
-反向把本支线合并进 hardening 支线以“提前展示”。

## 11. 下一阶段建议

下一阶段应单独完成“画布引擎 Adapter 评估与实现设计”，推荐顺序：

1. 读取 OpenPencil 当前公开接口和文件格式；
2. 用现有固定 Render Plan 做一次可丢弃的能力探针；
3. 比较 DOM/SVG Adapter、OpenPencil Adapter 的能力和锁定风险；
4. 固定 `LayoutEngineBinding` 与 nodeMap 的最小结构；
5. 经设计批准后再实施真实 Engine Adapter；
6. 仍然不接生产 Repository，直到 v0.1.1 集成门槛全部通过。

如果选择 OpenPencil，必须保证从 Canonical Layout 可以完整重建引擎文档；引擎文档丢失不得导致正式排版事实丢失。

## 12. 正式集成门槛

只有同时满足以下条件，才能开始 Production Integration：

```text
V0_1_1_STABLE_CONTENT_IDS=YES
V0_1_1_OBJECT_REF_ASSETS=YES
V0_1_1_STANDARD_ADAPTER_STABLE=YES
V0_1_1_DIRTY_BUFFER_FIXED=YES
V0_1_1_NO_OP_REVISION_FIXED=YES
V0_1_1_CI=PASS
ENGINE_PRIVATE_IDS_ISOLATED=YES
```

## 13. 接手指令

```text
继续在 feat/report-studio-v0.2.0-layout 工作。
先完整阅读：
1. docs/superpowers/specs/2026-09-03-report-studio-v0.2.0-layout-foundation-design.md
2. docs/architecture/report-studio-v0.2.0-layout-integration-contract.md
3. docs/acceptance/report-studio-v0.2.0-layout-foundation-verification.md
4. 本 Handoff

不要重新设计已稳定的 Canonical Layout 和 SourceRef。
下一步先做 Engine Adapter 的独立技术评估与设计，不接生产 UI、Repository 或 DSH Command。
所有新实现继续测试先行，并保留独立排版 CI。
```
