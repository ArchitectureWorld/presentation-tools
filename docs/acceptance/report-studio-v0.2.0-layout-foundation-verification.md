---
document_id: report-studio-v0.2.0-layout-foundation-verification
status: foundation-verified
product_version: 0.2.0-alpha.1
branch: feat/report-studio-v0.2.0-layout
base_branch: feat/report-studio-v0.1.1-hardening
base_commit: 29294803681758e0b65a0bc51f7ed9ab810cde9a
verified_source_commit: 9dfc0bae33e76be377da1d3063f6cf36a5719b1a
workflow_run_id: 33736572988
verified_at: 2026-09-03
---

# Report Studio v0.2.0 排版基础验收记录

## 1. 验收结论

Report Studio `v0.2.0-alpha.1` 的引擎无关排版基础已经形成一条独立、可测试的纵向链路：

```text
稳定草案来源
→ Layout Source Index
→ Canonical LayoutPageDocument
→ Layout Core
→ Engine-neutral Render Plan
→ Replaceable Layout Adapter
→ Independent Browser Spike
```

本次结论仅表示“排版基础可继续开发”，不表示排版阶段已经接入正式产品。

```text
LAYOUT_FOUNDATION=PASS
LAYOUT_SOURCE_CONTRACT=PASS
LAYOUT_ADAPTER_BOUNDARY=PASS
INDEPENDENT_BROWSER_SPIKE=PASS
PRODUCTION_RUNTIME_INTEGRATION=BLOCKED
OPENPENCIL_INTEGRATION=NOT_STARTED
FINAL_EXPORT=NOT_STARTED
```

## 2. 固定坐标

```text
Repository: ArchitectureWorld/presentation-tools
Branch: feat/report-studio-v0.2.0-layout
Base: feat/report-studio-v0.1.1-hardening
Base commit: 29294803681758e0b65a0bc51f7ed9ab810cde9a
Verified source commit: 9dfc0bae33e76be377da1d3063f6cf36a5719b1a
Product version: 0.2.0-alpha.1
Node.js floor: 22+
Workflow: Report Studio v0.2.0 Layout Foundation CI
Workflow run: 33736572988
```

该支线相对固定基线只新增排版专用 Package、独立样机、验证脚本、设计文档和专用 CI；没有修改 `apps/studio-local/public/**`、v0.1.1 Repository、Standard Adapter 或 DSH Runtime。

## 3. 已验收能力

### 3.1 Canonical Layout

- 类型化 UUIDv7：`layoutPageId`、`layoutElementId`；
- 默认画布：`1600 × 900 studio_unit`；
- 元素类型：`text / image / shape / group`；
- 来源类型：`content-block / script-block / content-item / page-asset`；
- 同步策略：`live / detached`；
- 页面同步状态：`synced / stale / orphaned`；
- 元素状态：`normal / orphaned`；
- `live` 元素不复制草案正文；
- `detached` 元素必须使用 `localPayload`，且不能保留可写 `sourceRef`。

### 3.2 Layout Core

已验证公共能力：

```js
createLayoutPage()
addLiveLayoutElement()
addDetachedLayoutElement()
updateLayoutElementFrame()
detachLayoutElement()
markLayoutDraftAdvanced()
reconcileLayoutSources()
createLayoutRenderPlan()
```

所有修改函数返回新对象，不原地修改输入。草案版本前进只改变同步状态；来源核对不会覆盖元素几何、样式或层级。

### 3.3 Adapter Boundary

`assertLayoutAdapter()` 固定了可替换引擎边界：

```text
mount(root, handlers)
render(viewModel)
readViewportState()
destroy()
```

当前未引入 OpenPencil。任何后续画布引擎都必须位于该边界之后，不能成为 Canonical Layout 的事实源。

### 3.4 Layout Source Integration

`buildLayoutSourceIndex(draftPage, resolvedPageAssets)` 已验证：

- 标题和正文 ContentBlock；
- List 与独立 `listItemId`；
- MetricGroup 与独立 `metricId`；
- Table 与独立 `tableCellId`；
- 独立 `scriptBlockId`；
- ObjectRef-backed `pageAssetId`；
- 重复身份拒绝；
- 缺失引用拒绝；
-素材身份不匹配拒绝；
-旧简化页面明确返回 `layout_source_contract_unavailable`；
-来源投影不包含 Data URL、Base64、migration 或 UI 私有状态。

### 3.5 Independent Browser Spike

独立样机使用固定 Fixture，支持：

- 元素选择；
- 拖动位置；
- 右下角控制点缩放；
- Frame-only ChangeSet 预览；
- 重置；
- 页面刷新恢复固定 Fixture；
- 不读取或写入生产 Repository。

## 4. 自动化证据

GitHub Actions Run `33736572988` 在全新 Ubuntu Runner、Node.js 22 环境执行成功。

```text
Tests: 31
Passed: 31
Failed: 0
Skipped: 0
```

验证标记：

```text
REPORT_STUDIO_LAYOUT_V0_2_0_FOUNDATION_PASS
REPORT_STUDIO_LAYOUT_SPIKE_PASS
```

浏览器结果：

```text
1366 × 768: scale 53%, no horizontal overflow
1920 × 1080: scale 84%, no horizontal overflow
drag: PASS
frame-only serialization: PASS
reload reset: PASS
browser runtime errors: 0
```

执行命令：

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

## 5. 测试先行记录

- Canonical Layout/Core：先提交预期失败测试，再加入最小实现；
- Adapter/Spike：Run `33735592217` 在实现缺失时失败；
- Browser Smoke：Run `33735909289` 暴露测试脚本使用未插值字符串查找 ID，修正测试根因后 Run `33736088064` 通过；产品拖拽逻辑未用补丁掩盖；
- Source Integration：Run `33736348639` 在实现缺失时失败，加入最小实现后 Run `33736572988` 通过。

## 6. 未交付能力

本里程碑明确没有交付：

- 正式排版 Tab 和生产 Layout UI；
- LayoutPageDocument 的生产 Repository 持久化；
- OpenPencil 或其他画布引擎绑定；
- `LayoutEngineBinding`；
- 排版 Agent Command；
- 草案与排版的正式双向提交；
- 多页分页、模板、母版、动画和时间线；
- HTML、PNG、PDF、PPTX 成品导出；
- 与 v0.1.1 当前简化页面结构的临时兼容猜测。

## 7. 正式集成门槛

排版基础进入生产 Runtime 前，必须确认：

1. v0.1.1 已稳定 ContentBlock、ListItem、Metric、TableCell、ScriptBlock 和 PageAsset 身份；
2. 素材使用 ObjectRef，不再把 Data URL 作为事实源；
3. Standard Adapter 连续导出保持稳定 ID；
4. Canonical Snapshot、dirty buffer 和 no-op Revision 已完成加固；
5. v0.1.1 GitHub CI 全绿；
6. 后续 Engine Adapter 不把私有 `engineNodeId` 扩散到领域层。

## 8. 最终裁决

```text
FOUNDATION_MILESTONE_COMPLETE=YES
SAFE_TO_CONTINUE_PARALLEL_LAYOUT_WORK=YES
SAFE_TO_MERGE_INTO_V0_1_1_RUNTIME=NO
SAFE_TO_OPEN_LAYOUT_TO_USERS=NO
NEXT_STAGE=ENGINE_ADAPTER_EVALUATION_AFTER_EXPLICIT_DESIGN
```
