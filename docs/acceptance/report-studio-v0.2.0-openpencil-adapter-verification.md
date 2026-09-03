---
document_id: report-studio-v0.2.0-openpencil-adapter-verification
status: adapter-evaluation-verified
product_version: 0.2.0-alpha.2
branch: feat/report-studio-v0.2.0-layout
phase_base_commit: 69859cdd65abebeadba196ad3e8e0f3f1fce5675
verified_source_commit: 4ff3a5040547a27539eea0ffda4bb003bc3679d6
workflow_run_id: 33739622248
openpencil_commit: e6c9bcef45c5b48b38f42824d56b5513178e1a0b
dsh_openpencil_commit: 99e05cdbae5e26c920cc20e0793c66446685b0cd
verified_at: 2026-09-03
---

# Report Studio v0.2.0 OpenPencil Adapter 验收记录

## 1. 验收结论

Report Studio `v0.2.0-alpha.2` 已完成 OpenPencil Adapter 的隔离式能力验证：引擎无关 Render Plan 可以被确定性编译为 OpenPencil `batch_design` 创建事务；OpenPencil 返回的节点结果可以被严格转换为一对一 `LayoutEngineBinding`；布局几何变更可以被编译为仅包含 Frame 的 `U(nodeId, patch)` 事务；引擎选择可以反向映射为 `layoutElementId`。

本次结论只覆盖 Adapter、Binding 和事务协议，不表示真实 OpenPencil Runtime、`.op` 文件或托管编辑器已经接入 Report Studio。

```text
OPENPENCIL_TRANSACTION_COMPILER=PASS
LAYOUT_ENGINE_BINDING=PASS
FRAME_PATCH_COMPILER=PASS
SELECTION_REVERSE_MAPPING=PASS
EXTERNAL_COMPATIBILITY_BASELINE=PINNED
REAL_OPENPENCIL_RUNTIME_EXECUTION=NOT_TESTED
PRODUCTION_REPOSITORY_INTEGRATION=BLOCKED
PRODUCTION_LAYOUT_UI=BLOCKED
```

## 2. 固定坐标

```text
Repository: ArchitectureWorld/presentation-tools
Branch: feat/report-studio-v0.2.0-layout
Phase base commit: 69859cdd65abebeadba196ad3e8e0f3f1fce5675
Verified source commit: 4ff3a5040547a27539eea0ffda4bb003bc3679d6
Product version: 0.2.0-alpha.2
Workflow: Report Studio v0.2.0 Layout CI
Workflow run: 33739622248
```

外部编译目标：

```text
OpenPencil repository: ZSeven-W/openpencil
OpenPencil commit: e6c9bcef45c5b48b38f42824d56b5513178e1a0b
DSH plugin repository: ZSeven-W/dsh-openpencil
DSH plugin commit: 99e05cdbae5e26c920cc20e0793c66446685b0cd
DSH plugin package: @zseven-w/dsh-openpencil@0.1.0-rc.9
DSH plugin Node floor: >=24.11.0
```

## 3. 已验收能力

### 3.1 LayoutEngineBinding

新增运行态派生模型：

```text
LayoutEngineBinding
├─ layoutEngineBindingId
├─ layoutPageId
├─ engine=openpencil
├─ engineAdapterVersion
├─ engineDocumentRef
├─ rootEngineNodeId
├─ generatedFromRevision
├─ sourceStateHash
└─ nodeMap[]
   ├─ layoutElementId
   ├─ engineNodeId
   └─ bindingKey
```

验证规则：

- `layoutEngineBindingId` 使用类型化 UUIDv7；
- `layoutElementId`、`engineNodeId`、`bindingKey` 分别唯一；
- 根节点不能同时代表 LayoutElement；
- `sourceStateHash` 和可选文档哈希必须是 SHA-256 引用；
- Binding 属于可重建运行记录，不进入 Canonical Layout；
- 支持 Layout → Engine、Engine → Layout 双向查询；
- 未映射引擎节点不会被相似匹配或自动猜测。

### 3.2 OpenPencil 创建事务

`compileOpenPencilCreateTransaction()` 已验证：

- 生成一个 OpenPencil 根 `frame`；
- 将 `text / image / shape / group` 映射为明确 OpenPencil 节点类型；
- 所有节点使用 `I(parentId,nodeJson)`；
- 事务内 Binding Key 由 `layoutElementId` 的 SHA-256 稳定派生；
- 元素按 `zIndex + layoutElementId` 确定性排序；
- 相同 Render Plan 两次编译得到字节一致的 operations；
- 不修改输入 Render Plan；
- 样式只通过白名单字段；
- 图片必须通过外部 Resolver 获得 HTTP(S) Capability URL；
- Data URL、Blob URL、file URL、绝对路径和反斜杠路径被拒绝；
- 不支持的元素类型和 shapeKind 明确失败，不静默降级。

### 3.3 执行结果校验

`createOpenPencilEngineBinding()` 已验证拒绝：

- 缺少根 Binding；
- 缺少任意元素 Binding；
- 未知 Binding；
- 重复结果 Binding；
- 重复 engineNodeId；
- 空 nodeId；
- 无效布局元数据。

只有结果与预期一一对应时，才创建正式 `LayoutEngineBinding`。

### 3.4 增量几何事务

`compileOpenPencilFramePatchTransaction()` 只接受：

```js
{
  layoutElementId,
  frame: { x, y, width, height, rotation }
}
```

输出只包含：

```text
U("engineNodeId", {x,y,width,height,rotation})
```

不会同时修改内容、样式、来源或层级。空变更、重复变更和未映射元素均被拒绝。

### 3.5 选择反向映射

`mapOpenPencilSelection()` 返回：

```js
{
  layoutElementIds: [],
  unmappedEngineNodeIds: []
}
```

根节点和 OpenPencil 内部节点可以作为未映射对象保留，不会污染 Report Studio 的稳定身份体系。

## 4. GitHub Actions 证据

Run `33739622248` 在全新 Ubuntu Runner、Node.js 22 环境全部通过。

```text
Tests: 53
Passed: 53
Failed: 0
Skipped: 0
```

验证标记：

```text
REPORT_STUDIO_LAYOUT_V0_2_0_FOUNDATION_PASS
REPORT_STUDIO_OPENPENCIL_ADAPTER_V0_2_0_PASS
REPORT_STUDIO_LAYOUT_SPIKE_PASS
```

OpenPencil 验证输出：

```text
bindings=4
patches=1
openpencil=e6c9bcef45c5b48b38f42824d56b5513178e1a0b
dsh-openpencil=99e05cdbae5e26c920cc20e0793c66446685b0cd
```

浏览器样机结果：

```text
1366×768: no horizontal overflow
1920×1080: no horizontal overflow
drag: PASS
frame-only serialization: PASS
reload reset: PASS
```

## 5. 测试先行与故障修复记录

1. Run `33739127501`：新增测试已进入 CI，新实现文件尚不存在；31 项原有测试通过，两个新测试模块以 `ERR_MODULE_NOT_FOUND` 失败，确认 RED。
2. Run `33739462528`：53/53 单元测试通过，OpenPencil Adapter 验证通过；既有浏览器烟测在成功输出后因 Chromium Profile 目录清理竞态返回 `ENOTEMPTY`。
3. 根因修复：等待浏览器进程退出；强制退出后继续等待；对 `ENOTEMPTY / EBUSY / EPERM` 使用有界重试。没有削弱浏览器断言，也没有跳过烟测。
4. Run `33739622248`：单元测试、Layout Foundation、OpenPencil Adapter 和浏览器烟测全部通过。

## 6. 本阶段未修改

相对阶段基线，本轮未修改：

- `apps/studio-local/public/**`；
- v0.1.1 Repository；
- v0.1.1 Canonical Snapshot；
- Presentation Standard Adapter；
- Report Studio DSH Runtime；
- 生产插件包；
- 当前正式排版入口。

## 7. 未交付能力

- 真实安装 `@zseven-w/dsh-openpencil`；
- 在真实 DSH Profile 中调用 `batch_design`；
- 真实创建、读取和保存 `.op` 文档；
- OpenPencil 托管编辑器嵌入 Report Studio；
- `LayoutEngineBinding` 生产持久化；
- OpenPencil 编辑变更回写 Canonical Layout；
- OpenPencil Undo/Redo、选择事件和文档生命周期接入；
- 正式排版 Agent Command；
- HTML、PNG、PDF、PPTX 成品导出。

## 8. 下一阶段门槛

下一阶段只能进行“隔离 DSH Profile 的真实 Runtime 兼容性烟测”，仍不得直接接入生产项目。至少验证：

1. Node.js `>=24.11.0` 环境可安装固定插件版本；
2. DSH 能注册 `batch_design` 及托管编辑器能力；
3. 本 Adapter 生成的创建事务可以被真实插件接受；
4. 真实结果确实返回 `results[{binding,nodeId}]`；
5. 创建后的节点数、类型和几何与 Render Plan 一致；
6. Frame Patch 可以被真实文档接受；
7. 真实文档可以重新打开；
8. OpenPencil 私有 ID 仍只进入 `LayoutEngineBinding`；
9. 所有测试使用临时 DSH Home 和临时 `.op` 文档，不触碰生产项目。

## 9. 最终裁决

```text
OPENPENCIL_ADAPTER_EVALUATION_COMPLETE=YES
SAFE_TO_CONTINUE_WITH_ISOLATED_RUNTIME_SMOKE=YES
SAFE_TO_INSTALL_IN_PRODUCTION_PROFILE=NO
SAFE_TO_PERSIST_BINDING_IN_V0_1_1=NO
SAFE_TO_OPEN_LAYOUT_TAB=NO
```
