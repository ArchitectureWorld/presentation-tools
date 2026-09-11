# Report Studio V0.2.0 阶段 1—5设计

**日期：** 2026-09-04  
**目标支线：** `feat/report-studio-v0.2.0-layout`  
**产品版本：** 从 `0.2.0-alpha.3` 连续推进，禁止创建新支线  
**Node.js：** `>=24.11.0`  
**Presentation Standard Project Directory：** `0.1.0`，保持不变

## 1. 范围

本轮完成以下五个阶段：

1. 收敛验收、版本和 Handoff；
2. 真实 OpenPencil Runtime 隔离烟测；
3. LayoutPageDocument 正式持久化；
4. 草案与排版双向同步和 `live / detached / orphaned` 状态；
5. 正式排版 UI。

本轮不实现排版 Agent、HTML/PNG/PDF/PPTX 导出，也不修改 Presentation Contract 0.1.0。

## 2. 身份与共享目录约束

`projectId` 只有一个事实源：

```text
project.json.projectId
  -> DraftPageDocument.projectId
  -> CanonicalSnapshot.project.projectId
  -> Layout Source Projection.projectId
  -> LayoutPageDocument.projectId
```

调用方不得在下游传入另一个 `projectId` 覆盖该值。页面对象不成为项目身份事实源。

共享项目目录所有权：

- pre-design：`project.json`、`rules.json`、`outline.json`、`pages/`、`source-materials/`、`assets/`；
- Presentation：`layouts/`；
- 未知文件：任何一方均不得擅自删除。

Report Studio 的 Workspace Reconcile 必须保留 `layouts/**`；pre-design 侧需要另行实现增量写盘协议，但不要求 Schema 变更。

## 3. Layout 持久化

### 3.1 事实源

`LayoutPageDocument` 是排版事实源；OpenPencil `.op` 文件是可重建派生物；`LayoutEngineBinding` 是运行时映射记录。

每个标准项目页对应：

```text
layouts/<pageId>/layout.json
layouts/<pageId>/binding.json
layouts/<pageId>/document.op
```

`layout.json` 必须使用确定性 JSON、原子替换和项目级 CAS。相同内容保存为 no-op，不增加 revision。

### 3.2 Revision

Layout 使用独立单调 revision，同时记录：

- `baseDraftRevision`
- `lastSyncedDraftRevision`
- `layoutRevision`
- `sourceStateHash`
- `updatedAt`

写入请求携带 `expectedLayoutRevision`；冲突返回 `layout_revision_conflict`，不得静默覆盖。

## 4. 同步语义

### live

只保存 `sourceRef`，渲染时从最新 Layout Source Projection 解析内容。草案内容变化后更新显示，但保持 frame、style、zIndex 和 OpenPencil node binding。

在排版界面编辑 live 文本时，不直接把文本写入 Layout；服务端生成并执行 Draft Command，再 Reconcile Layout。

### detached

保存 `localPayload`，不再读取上游 sourceRef。草案更新不得覆盖 detached 内容。

### orphaned

live 元素的来源消失时保留元素和几何，设置 `elementState=orphaned`，由用户删除、重连或 detach；不得静默删除。

## 5. OpenPencil Runtime

Runtime 通过独立适配器调用，不允许业务层解析 OpenPencil 私有 JSON。Smoke 必须覆盖：

1. 创建真实 `.op`；
2. 创建 frame 和 node；
3. 更新 frame；
4. 选择 node；
5. 保存；
6. 关闭；
7. 重新打开；
8. 验证 binding 和几何稳定。

当固定 OpenPencil Runtime 不可用时，验证器必须明确失败或返回 `skipped` 证据，不能用内存假实现冒充真实 smoke。CI 允许通过显式环境变量控制是否要求真实 Runtime；Release Gate 必须要求真实 Runtime。

## 6. 正式排版 UI

沿用现有工作台，不重做产品壳层。

- 顶部：`大纲 / 草案 / 排版`；
- 左侧：页面列表、图层列表；
- 中间：16:9 排版画布；
- 右侧：属性和页面批注；
- 悬浮：现有同 Session DSH Agent。

首批交互：

- 创建或打开排版页；
- 选择、拖动、缩放、旋转；
- 图层排序；
- frame 和基础 style 编辑；
- live/detached 切换；
- orphaned 提示与重连入口；
- Dirty Buffer；
- CAS 冲突提示；
- 保存和 Reconcile。

UI 不直接写文件，只调用 `/api/layouts/*` 服务。

## 7. 错误处理

统一错误码至少包含：

- `layout_invalid_identity`
- `layout_project_mismatch`
- `layout_page_mismatch`
- `layout_revision_conflict`
- `layout_source_not_found`
- `layout_element_not_found`
- `layout_engine_unavailable`
- `layout_engine_protocol_error`
- `layout_workspace_unsafe_path`

所有失败写入必须保持已有正式文件可解析，且不得破坏 `layouts/` 中其他页面。

## 8. 测试和验收

采用测试驱动开发。每个行为先出现失败测试，再写最小实现。

必须通过：

- Layout Contracts / Core / Adapter / Integration / Engine Binding / OpenPencil 单元测试；
- Layout Repository CAS、no-op、原子写入和重启恢复测试；
- live/detached/orphaned Reconcile 测试；
- live 文本编辑回写 Draft 的集成测试；
- UI Contract 和浏览器级交互测试；
- Workspace 保留 `layouts/**` SHA-256 的测试；
- Linux 与 Windows CI；
- 完整 V0.1.1 回归。

## 9. 版本推进

建议连续版本：

- 阶段 1：`0.2.0-alpha.3`
- 阶段 2：`0.2.0-alpha.4`
- 阶段 3：`0.2.0-alpha.5`
- 阶段 4：`0.2.0-alpha.6`
- 阶段 5：`0.2.0-beta.1`

最终仓库版本为 `0.2.0-beta.1`；继承的 DSH 插件版本仍为 `0.1.1`；Presentation Contract 仍为 `0.1.0`。
