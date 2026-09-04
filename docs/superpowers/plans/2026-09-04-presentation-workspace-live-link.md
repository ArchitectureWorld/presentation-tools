# Presentation Workspace Live Link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Report Studio v0.1.1 自动打开、验证和监听当前 DSH Session Workspace 中的标准项目，并在 dirty 状态下阻止静默覆盖。

**Architecture:** DSH host 从 `SessionHeader.cwd` 解析可信 Workspace，Runtime 按真实 Workspace 路径共享 Repository。Workspace Live Link 只读取 Contract 托管文件，750ms 防抖后全量验证并暂存合法候选；浏览器依据 Draft Buffer dirty 状态决定自动应用或显示冲突。

**Tech Stack:** Node.js 22+、原生 `fs.watch`/`fs/promises`、AJV Contract 0.1.0、DSH 0.1.1-rc.2、原生浏览器 JavaScript/CSS。

**Spec:** `docs/superpowers/specs/2026-09-04-presentation-workspace-live-link-design.md`

## Global Constraints

- 只使用 `feat/report-studio-v0.1.1-hardening`，不新增支线。
- 不修改 Contract 0.1.0 Schema、Factory、Stable ID、sourceRefs 语义或 Schema Set Hash。
- 不修改 pre-design；不把同步/DSH/Revision 私有字段写进标准目录。
- 产品版本保持 Report Studio `0.1.1`。
- 所有生产代码必须先有能正确失败的测试。

---

### Task 1: Workspace 解析、全量读取与稳定指纹

**Files:**
- Create: `apps/studio-local/workspace-live-link.mjs`
- Create: `apps/studio-local/workspace-live-link.test.mjs`
- Modify: `packages/studio-standard-adapter/index.mjs`
- Modify: `packages/studio-standard-adapter/index.test.mjs`

**Interfaces:**
- Produces: `resolveWorkspaceRoot(value)`, `readWorkspaceSnapshot(workspaceRoot, options)`, `createWorkspaceWatcher(options)`。
- `readWorkspaceSnapshot()` 返回 `{status, workspaceRoot, projectId, standardVersion, fingerprint, sourceRevision, sourceRevisions, readAt, validation, snapshot}`。

- [x] **Step 1: 写 Workspace 解析、合法/缺失/无效项目、managed-only 读取和来源 Revision 的失败测试。**
- [x] **Step 2: 运行 `node --test apps/studio-local/workspace-live-link.test.mjs packages/studio-standard-adapter/index.test.mjs`，确认因接口不存在而失败。**
- [x] **Step 3: 实现绝对路径/realpath/符号链接边界、Contract 全量验证、managed-only archive、稳定指纹和 sourceRefs 汇总。**
- [x] **Step 4: 重跑测试，确认通过且 Contract 目录无内容变化。**
- [x] **Step 5: 提交 `feat(workspace): read current standard project safely`。**

### Task 2: Watcher、防抖与错误恢复

**Files:**
- Modify: `apps/studio-local/workspace-live-link.mjs`
- Modify: `apps/studio-local/workspace-live-link.test.mjs`

**Interfaces:**
- `createWorkspaceWatcher({workspaceRoot, debounceMs=750, onCandidate, onStatus, ...injections})` 返回 `{start(), rescan(), status(), close()}`。

- [x] **Step 1: 写连续事件单次刷新、Windows rename/目录替换、draft 增删改、asset manifest、无效中间态、恢复和 close 的失败测试。**
- [x] **Step 2: 运行目标测试并确认正确失败。**
- [x] **Step 3: 实现多目录 watcher、750ms 项目级防抖、完整重扫、最后合法快照保留、重建 watcher和幂等释放。**
- [x] **Step 4: 使用真实临时目录跑测试并确认全部通过。**
- [x] **Step 5: 提交 `feat(workspace): watch stable upstream snapshots`。**

### Task 3: Repository 上游发布与 DSH Workspace 绑定

**Files:**
- Modify: `apps/studio-local/repository.mjs`
- Modify: `apps/studio-local/repository.test.mjs`
- Modify: `packages/studio-dsh-plugin/lib/runtime.js`
- Modify: `packages/studio-dsh-plugin/runtime.test.mjs`
- Modify: `packages/studio-dsh-plugin/lib/index.js`
- Modify: `packages/studio-dsh-plugin/host.test.mjs`
- Modify: `packages/studio-contracts/index.mjs`

**Interfaces:**
- Repository 新增 `publishUpstreamSnapshot({snapshot, fingerprint, workspaceRoot, sourceRevision, sourceRevisions})`。
- Runtime 新增 `openWorkspace(sessionId)`, `workspaceStatus(sessionId)`, `reloadWorkspace(sessionId, input)`, `applyWorkspaceCandidate(sessionId, input)`, `close()`。
- DSH tools 新增 `studio_open_workspace_project`、`studio_reload_upstream`。

- [ ] **Step 1: 写首次 Revision 0、后续 Revision、activePage 保持/回退、Operational 保留、同 Workspace 多 Session 共享、Session 切 Workspace 和工具绑定的失败测试。**
- [ ] **Step 2: 运行 Repository/Runtime/Host 目标测试并确认正确失败。**
- [ ] **Step 3: 实现 Workspace keyed Repository、候选状态机、上游安全发布和 host `sessions` 注入。**
- [ ] **Step 4: 重跑目标测试，确认不同 Workspace 隔离、同 Workspace 不重复建项目，关闭时释放 watcher/repository。**
- [ ] **Step 5: 提交 `feat(dsh): bind studio projects to session workspaces`。**

### Task 4: 同步状态和 dirty 冲突 UI

**Files:**
- Modify: `apps/studio-local/public/index.html`
- Modify: `apps/studio-local/public/app.js`
- Modify: `apps/studio-local/public/styles.css`
- Create: `apps/studio-local/workspace-live-link-ui.test.mjs`
- Modify: `apps/studio-local/responsive-ui.test.mjs`

**Interfaces:**
- UI 周期读取 `/api/workspace/status`；按钮调用 `/api/workspace/reload` 和 `/api/workspace/apply`。

- [ ] **Step 1: 写状态字段、自动刷新、dirty 固定提示、四个冲突动作、activePage/滚动恢复和结构化错误的失败测试。**
- [ ] **Step 2: 运行 UI 目标测试并确认正确失败。**
- [ ] **Step 3: 实现顶部状态按钮、详情面板、更新摘要、自动/显式应用和可访问交互。**
- [ ] **Step 4: 跑 UI 单测及 6 视口验证，确认未增加第二套模型或 Agent Runtime。**
- [ ] **Step 5: 提交 `feat(ui): surface workspace live sync conflicts`。**

### Task 5: 门禁、文档、打包和真实宿主

**Files:**
- Create: `scripts/verify-workspace-live-link.mjs`
- Create: `scripts/verify-workspace-live-link.test.mjs`
- Modify: `package.json`
- Modify: `scripts/dsh-plugin-vendor-manifest.mjs`
- Modify: `scripts/verify-dsh-plugin.mjs`
- Modify: `README.md`
- Modify: `DSH_INSTALL.md`
- Create: `docs/handoff/PRESENTATION_WORKSPACE_LIVE_LINK_IMPLEMENTATION.md`

**Interfaces:**
- `npm run verify:workspace` 成功输出 `PRESENTATION_WORKSPACE_LIVE_LINK_PASS`。

- [ ] **Step 1: 写 verifier 的失败测试，锁定 22 项最低覆盖、Contract 坐标、vendor 和文档要求。**
- [ ] **Step 2: 运行 verifier 测试并确认正确失败。**
- [ ] **Step 3: 实现 verifier、README、安装说明与完整 Handoff；执行 `npm run sync:vendor`。**
- [ ] **Step 4: 运行 `npm run verify:workspace`、`npm run verify:all`、vendor 零漂移、当前 HEAD tarball integrity 和 DSH smoke。**
- [ ] **Step 5: 在 Windows 真实 DSH Web Profile 备份后安装当前 tgz，验证 Workspace 自动打开、更新、dirty 冲突、恢复、layouts/和其他文件不变以及控制台零新增错误。**
- [ ] **Step 6: 提交并推送现有支线，等待 GitHub Windows/Linux CI 全绿；PR 保持 Draft，不合并 main。**
