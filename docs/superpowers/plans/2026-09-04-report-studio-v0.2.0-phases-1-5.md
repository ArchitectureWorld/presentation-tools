# Report Studio V0.2.0 阶段 1—5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在既有 `feat/report-studio-v0.2.0-layout` 支线上完成真实 OpenPencil smoke、Layout 持久化、草案同步和正式排版 UI。

**Architecture:** 保持 Canonical Draft 为内容事实源、LayoutPageDocument 为排版事实源、OpenPencil `.op` 为派生物。服务端通过独立 Layout Repository、Layout Service 和 OpenPencil Runtime Adapter 对外提供 API，前端只消费 API，不直接写 Workspace 文件。

**Tech Stack:** Node.js 24.11、ES Modules、node:test、原生 HTTP、原生浏览器 JavaScript、OpenPencil CLI/DSH Runtime Adapter。

**Spec:** `docs/superpowers/specs/2026-09-04-report-studio-v0.2.0-phases-1-5-design.md`

## Global Constraints

- 只修改现有 `feat/report-studio-v0.2.0-layout`，禁止创建新支线。
- 根 Node.js 下限固定为 `>=24.11.0`。
- 最终产品版本为 `0.2.0-beta.1`。
- DSH 插件版本保持 `0.1.1`。
- Presentation Standard Project Directory 保持 `0.1.0`。
- `project.json.projectId` 是唯一项目身份事实源。
- `layouts/**` 归 Presentation 管理，Workspace Reconcile 不得删除或覆盖未知文件。
- 每个生产行为必须先有失败测试。

---

### Task 1: 阶段 1收敛文档与验证基线

**Files:**
- Create: `docs/superpowers/specs/2026-09-04-report-studio-v0.2.0-phases-1-5-design.md`
- Create: `docs/superpowers/plans/2026-09-04-report-studio-v0.2.0-phases-1-5.md`
- Create: `docs/handoffs/2026-09-04-report-studio-v0.2.0-beta.1-handoff.md`
- Modify: `README.md`
- Modify: `package.json`
- Modify: `.github/workflows/report-studio-v0.2.0-layout-ci.yml`

**Interfaces:**
- Consumes: 当前 `0.2.0-alpha.3` 收敛基线。
- Produces: 统一阶段门禁、版本矩阵和 Handoff。

- [ ] **Step 1: 写版本一致性失败测试**

在现有验证脚本测试中增加断言：根产品版本、Layout package 版本、CI Node 版本和 Handoff 声明必须一致。

- [ ] **Step 2: 运行测试并确认因 beta.1 元数据缺失而失败**

Run: `node --test scripts/*.test.mjs`

- [ ] **Step 3: 更新版本、CI 和文档**

将根产品推进到 `0.2.0-beta.1`，保留 DSH `0.1.1` 和 Contract `0.1.0`。

- [ ] **Step 4: 运行版本与全量基线验证**

Run: `npm run verify:all`

- [ ] **Step 5: 提交阶段 1**

Commit: `docs(v0.2): lock phases 1-5 implementation baseline`

### Task 2: 阶段 2真实 OpenPencil Runtime Smoke

**Files:**
- Create: `packages/studio-layout-openpencil/runtime.mjs`
- Create: `packages/studio-layout-openpencil/runtime.test.mjs`
- Create: `scripts/verify-layout-openpencil-runtime-v0.2.0.mjs`
- Create: `scripts/verify-layout-openpencil-runtime-v0.2.0.test.mjs`
- Modify: `packages/studio-layout-openpencil/index.mjs`
- Modify: `packages/studio-layout-openpencil/README.md`
- Modify: `package.json`
- Modify: `.github/workflows/report-studio-v0.2.0-layout-ci.yml`

**Interfaces:**
- Consumes: `OpenPencilToolClient` 与 `LayoutEngineBinding`。
- Produces: `runOpenPencilRuntimeSmoke(options)` 和机器可读 smoke evidence。

- [ ] **Step 1: 写失败测试**

覆盖可执行文件缺失、协议错误、创建/更新/选择/保存/重开完整调用序列和 evidence 字段。

- [ ] **Step 2: 运行并确认失败原因是 Runtime API 尚不存在**

Run: `node --test packages/studio-layout-openpencil/runtime.test.mjs`

- [ ] **Step 3: 实现最小 Runtime Adapter**

使用依赖注入的 process runner；业务层只发送公开命令，不读取 `.op` 私有 JSON。

- [ ] **Step 4: 运行单测与显式 smoke gate**

Run: `node --test packages/studio-layout-openpencil/*.test.mjs scripts/verify-layout-openpencil-runtime-v0.2.0.test.mjs`

- [ ] **Step 5: 提交阶段 2**

Commit: `feat(layout): add real OpenPencil runtime smoke gate`

### Task 3: 阶段 3 LayoutPageDocument 持久化

**Files:**
- Create: `apps/studio-local/layout-repository.mjs`
- Create: `apps/studio-local/layout-repository.test.mjs`
- Create: `apps/studio-local/layout-service.mjs`
- Create: `apps/studio-local/layout-service.test.mjs`
- Modify: `apps/studio-local/server.mjs`
- Modify: `apps/studio-local/server.test.mjs`
- Modify: `packages/studio-layout-contracts/index.mjs`
- Modify: `packages/studio-layout-contracts/index.test.mjs`

**Interfaces:**
- Consumes: `LayoutPageDocument`, Canonical Snapshot、标准项目 Workspace 根路径。
- Produces: `LayoutRepository`、`LayoutService`、`GET/PUT /api/layouts/:pageId`。

- [ ] **Step 1: 写 Repository 失败测试**

覆盖项目/页面身份校验、CAS 冲突、no-op、不完整临时文件恢复、重启恢复、路径越界和确定性 JSON。

- [ ] **Step 2: 运行并确认失败**

Run: `node --test apps/studio-local/layout-repository.test.mjs`

- [ ] **Step 3: 实现 Repository**

每页保存 `layout.json`、`binding.json` 和可选 `document.op`；使用临时文件 + rename；不触碰其他页面和未知文件。

- [ ] **Step 4: 写并实现 API 失败测试**

验证 GET、首次创建、更新、no-op、409 CAS、404 页面和 projectId 不一致。

- [ ] **Step 5: 运行阶段 3测试**

Run: `node --test apps/studio-local/layout-repository.test.mjs apps/studio-local/layout-service.test.mjs apps/studio-local/server.test.mjs`

- [ ] **Step 6: 提交阶段 3**

Commit: `feat(layout): persist canonical layout pages with CAS`

### Task 4: 阶段 4 草案与排版同步

**Files:**
- Modify: `packages/studio-layout-core/index.mjs`
- Modify: `packages/studio-layout-core/index.test.mjs`
- Modify: `apps/studio-local/layout-service.mjs`
- Modify: `apps/studio-local/layout-service.test.mjs`
- Modify: `apps/studio-local/workspace-live-link.mjs`
- Modify: `apps/studio-local/workspace-live-link.test.mjs`
- Modify: `apps/studio-local/server.mjs`

**Interfaces:**
- Consumes: Layout Source Projection、Draft command/repository、Layout Repository。
- Produces: `reconcileLayoutPage`、`editLiveLayoutContent`、detach/relink/reorder/style/frame operations。

- [ ] **Step 1: 写同步失败测试**

覆盖 live 内容更新不改变几何、detached 不被覆盖、删除来源进入 orphaned、重连恢复、live 文本编辑产生 Draft revision、Layout no-op 不增 revision。

- [ ] **Step 2: 运行并确认失败**

Run: `node --test packages/studio-layout-core/index.test.mjs apps/studio-local/layout-service.test.mjs`

- [ ] **Step 3: 实现 Core 操作和 Service 编排**

添加 style、z-order、detach、relink、local payload 更新和 Draft 回写，不复制 live payload 到 Layout。

- [ ] **Step 4: 增加 Workspace 保留测试**

模拟 `layouts/**` 已存在，再执行上游 Reconcile，比较文件 SHA-256 不变化。

- [ ] **Step 5: 运行阶段 4测试**

Run: `node --test packages/studio-layout-core/*.test.mjs apps/studio-local/layout-service.test.mjs apps/studio-local/workspace-live-link.test.mjs`

- [ ] **Step 6: 提交阶段 4**

Commit: `feat(layout): reconcile live detached and orphaned elements`

### Task 5: 阶段 5正式排版 UI

**Files:**
- Modify: `apps/studio-local/public/index.html`
- Modify: `apps/studio-local/public/app.js`
- Modify: `apps/studio-local/public/styles.css`
- Create: `apps/studio-local/layout-ui.test.mjs`
- Create: `apps/studio-local/layout-ui-interaction.test.mjs`
- Modify: `apps/studio-local/ui.contract.test.mjs`
- Modify: `scripts/verify-responsive-ui.mjs`

**Interfaces:**
- Consumes: `/api/layouts/*`、现有页面选择、同 Session DSH Agent。
- Produces: `大纲 / 草案 / 排版` 三态工作台和可编辑 16:9 画布。

- [ ] **Step 1: 写 UI Contract 失败测试**

断言排版 Tab、图层面板、画布、属性面板、保存、Reconcile、live/detached/orphaned 状态、Dirty Buffer 和冲突提示均存在。

- [ ] **Step 2: 运行并确认失败**

Run: `node --test apps/studio-local/layout-ui.test.mjs`

- [ ] **Step 3: 实现结构和数据加载**

进入排版 Tab 时加载当前页面 Layout；无 Layout 时创建默认页；不自动弹出详情栏。

- [ ] **Step 4: 写交互失败测试并实现**

覆盖选择、拖动、缩放、旋转、图层排序、属性编辑、detach/relink、保存、CAS 冲突和 Reconcile。

- [ ] **Step 5: 运行 UI 与响应式验证**

Run: `node --test apps/studio-local/*ui*.test.mjs && npm run verify:ui`

- [ ] **Step 6: 提交阶段 5**

Commit: `feat(layout): deliver beta layout workspace UI`

### Task 6: 最终全量验证与 Handoff

**Files:**
- Modify: `docs/handoffs/2026-09-04-report-studio-v0.2.0-beta.1-handoff.md`
- Modify: `README.md`
- Remove: `.github/workflows/report-studio-source-snapshot.yml`

**Interfaces:**
- Consumes: 阶段 1—5全部交付。
- Produces: 可审查的最终 HEAD、CI 证据和后续阶段边界。

- [ ] **Step 1: 运行完整门禁**

Run: `npm run verify:all`

- [ ] **Step 2: 运行真实 OpenPencil Release Smoke**

Run: `REQUIRE_REAL_OPENPENCIL=1 npm run verify:layout:runtime`

- [ ] **Step 3: 检查版本、Contract 和工作区所有权**

确认产品 `0.2.0-beta.1`、DSH `0.1.1`、Contract `0.1.0`，且 `layouts/**` 不受 pre-design Reconcile 管理。

- [ ] **Step 4: 更新 Handoff 与最终提交**

Commit: `docs(v0.2): finalize beta.1 handoff and evidence`

- [ ] **Step 5: 读取最终 CI 的 Linux/Windows Job、日志和 artifact evidence**

只有全部门禁通过后才可声明阶段 1—5完成。
