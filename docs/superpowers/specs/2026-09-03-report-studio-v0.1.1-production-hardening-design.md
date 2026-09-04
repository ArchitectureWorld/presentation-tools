# Report Studio v0.1.1 生产化加固与标准项目适配设计

状态：已批准（用户选择 A → A1 → A1.1，并授权后续采用推荐决策）  
基线：`main@804dbd4dfa7bafc9acd373e9ae51f2d02c9f1257`  
目标版本：Report Studio `0.1.1`  
标准 Contract：Presentation Standard Project Directory `0.1.0`

## 1. 目标与非目标

本轮把现有“大纲＋草案”MVP 收敛成可部署使用的产品，并消除标准 Contract、UI、DSH 和持久化之间的关键断裂。

必须实现：

- 旧 `report-studio.v0.1.0` 数据经用户确认后无损迁移；迁移前备份、迁移后校验、失败不切换。
- 内容写入使用显式 `baseRevision` 和单进程原子 CAS，消除并发覆盖。
- 每个正式 Revision 保存不可变 Canonical Snapshot，可按 Revision 读取。
- ReviewSubmission 固定读取其 `baseRevision`，失败可重投，重复命令幂等。
- 内部 Canonical Model 与 Presentation Standard Project Directory 通过正式 Adapter 往返。
- 原生 DSH 插件、独立本地服务、当前 UI 共用同一领域与存储语义。
- Windows 与 Linux 可重复验证，DSH 隔离安装和真实路由烟测通过。

本轮不实现：

- 排版画布、分页、模板、母版、PPTX/PDF/HTML 成品导出。
- 多进程或网络共享同一项目存储根。
- 第二套 Agent Runtime 或应用直连模型。
- 将运行时 Revision、Proposal、Session、CAS 写进中立标准项目目录。

上述能力进入 `0.2.0`，不在 `0.1.1` 中以占位 UI 假装完成。

## 2. 权威与版本

- `docs/architecture/report-studio-architecture.md` 继续定义长期产品架构。
- 本文定义 `0.1.1` 的可交付切片；与长期架构冲突时，长期架构保持目标态，本文只能缩小本轮范围，不能改变数据安全原则。
- `contracts/presentation-standard-project/` 是外部标准格式唯一机器权威，版本保持 `0.1.0`。
- `packages/studio-contracts/` 定义 Studio 内部运行时 Envelope、错误码和 Schema 版本；不得复制外部 Contract Schema。
- `apps/studio-local/` 是唯一权威 UI。`tools/report-studio/` 标记为历史交互原型，只做回归参考，不再作为可部署产品。
- Report Studio 产品版本升级为 `0.1.1`；DSH 插件版本同步为 `0.1.1`。

## 3. Canonical、Operational 与 View 分层

### 3.1 Canonical Snapshot

进入正式 Revision 的内容只有：

- Project：稳定 `projectId`、标题、创建时间；
- Outline：嵌套节点、稳定 `outlineId`、标题和顺序；
- Pages：稳定 `pageId`、所属 `outlineId`、标题、正文、要点、讲解稿和素材引用；
- Assets：本轮保留现有内嵌图片能力，但 Adapter 导出时生成正式 Asset 文件和 Manifest。

Canonical Snapshot 不包含 UI 当前页、批注、Submission、Proposal、DSH Session 或投递状态。

### 3.2 Operational Records

以下记录独立持久化，不改变内容 Revision：

- Annotation、ReviewRound、ReviewSubmission；
- Proposal 与投递状态；
- 幂等键和迁移审计；
- `legacyIdMap` 与旧 Revision 元数据。

### 3.3 Workspace View

`stage`、`activePageId` 等仅属于本地视图状态。视图写入不增加内容 Revision，也不进入标准项目导出。

## 4. ID 规则

所有新建第一方对象使用标准要求的 `type_lowercase-uuidv7` 形式，例如：

```text
project_0199...
outline_0199...
page_0199...
asset_0199...
revision_0199...
review_submission_0199...
proposal_0199...
```

迁移旧截短 UUIDv4 时：

1. 为每个旧 ID 只生成一次新 ID；
2. 在一次迁移内重写全部引用；
3. 将映射写入 `migration-map.json`；
4. 保留旧值用于审计，不再作为运行时主键；
5. 重跑迁移使用同一映射，结果必须确定且幂等。

## 5. 存储协议

每个本地项目或 DSH Session 使用独立目录：

```text
<data-dir>/
├─ control.json
├─ objects/
│  └─ sha256/<hash>.json
├─ backups/
│  └─ <timestamp>/state.v0.1.0.json
├─ migration-map.json
├─ exports/
└─ state.json                  # 仅旧格式；迁移成功后保留为备份来源，不再写入
```

`control.json` 保存：

- `schemaVersion: report-studio.control.v0.1.1`；
- `projectHead.currentRevision`；
- `projectHead.currentRevisionRef`；
- Operational Records；
- Workspace View；
- 迁移状态和最近错误。

`objects/sha256/` 保存不可变 Snapshot 与 RevisionRecord。对象文件名由规范化 JSON 的 SHA-256 决定；同一内容重复写入复用对象。

正式内容提交顺序：

1. 在进程内串行化同一 Repository 的写事务；
2. 从磁盘重读 `control.json`；
3. 验证 `projectHead.currentRevision === baseRevision`；
4. 从 base Revision Snapshot 构建候选状态并执行命令；
5. 校验 ID、引用和领域不变量；
6. 原子写 Snapshot 对象；
7. 原子写 RevisionRecord 对象；
8. 最后原子替换 `control.json`，再次执行 Revision CAS；
9. CAS 失败时新对象保持不可达，正式状态不变。

本版本明确只保证单个 Node.js 进程内的项目级串行化；检测到锁目录被另一进程持有时拒绝启动写模式，不声称支持共享写入。

## 6. A1.1 受控迁移

当仅发现旧 `state.json` 时，Repository 进入 `migration_required`：

- 健康检查仍可访问；
- 内容读取以只读预览方式返回；
- 所有修改、Submission 和 Proposal 接受接口返回 `migration_required`；
- UI 显示迁移说明、备份位置和“备份并升级”按钮。

用户确认后：

1. 原样复制旧文件到带时间戳的备份目录；
2. 校验旧 JSON 基本结构；
3. 生成并持久化稳定 ID 映射；
4. 转换 Canonical、Operational 和 View 数据；
5. 以旧 `currentRevision` 作为迁移根 Revision 号码，`parentRevisionRef = null`，并记录 `migratedFromSchemaVersion`；
6. 写入对象和候选 `control.json`；
7. 从磁盘重新加载并运行完整不变量校验；
8. 最后原子发布 `control.json`，迁移完成。

任何一步失败都不删除、不覆盖旧 `state.json`，也不发布候选控制记录。UI 提供可操作错误；修复后可再次确认迁移。

新目录直接创建 Revision 0，不显示迁移页面。

## 7. ReviewSubmission 与 DSH

ReviewSubmission 状态机：

```text
pending_dispatch → dispatched → proposal_created
                 ↘ dispatch_failed → pending_dispatch（重投）
proposal_created → accepted | stale | rejected
```

规则：

- Submission 创建时冻结批注快照、`baseRevision`、scope 和幂等键。
- `studio_get_context` 改为必须接收 `submissionId`，只读取该 Submission 的 base Revision Snapshot。
- 如果当前 Head 已前进，返回结构化 `stale_review_submission`，不混入当前状态。
- `studio_apply_commands` 只接受该 Submission 允许的命令；相同 `submissionId + idempotencyKey` 重复调用返回已有 Proposal。
- 一个 Submission 最多有一个有效 Proposal；失败投递允许重用原 Submission 和相同幂等键。
- Bridge 或 DSH prompt 投递失败必须持久化为 `dispatch_failed` 并向 UI 报错，不能显示“已提给 Agent”。
- Proposal 接受携带 `baseRevision`，通过 Repository CAS 成为新 Revision；冲突返回 `stale_revision`。

原生 DSH 模式仍由当前 Session 调用 `studio_get_context` / `studio_apply_commands`；独立 HTTP Bridge 只是兼容路径，不成为第二套权威运行时。

## 8. 标准项目 Adapter

新增 `packages/studio-standard-adapter/`，职责仅为：

- Standard Project Directory → Canonical Snapshot；
- Canonical Snapshot → Standard Project Directory；
- 调用现有 Contract 验证器验证导入和导出；
- 返回结构化兼容性报告。

映射原则：

- 项目、Outline 和 Page 的标准 ID 原样保留；
- Draft 标题、正文、列表和讲解稿映射到 Studio 草案字段；
- 标准 Contract 支持而 Studio `0.1.1` 尚不能编辑的字段放入 `extensionPayload` 原样保留，导出时回写；
- 未排版项目合法；不生成伪 Layout；
- Source Materials 与正式 Assets 保持分离；
- 导入后未编辑的项目再次导出，必须通过 Contract 且兼容字段无损；
- Studio 内部 Revision、批注、Proposal、Session 和视图状态绝不导出。

提供产品内接口：

- `GET /api/standard/status`：显示 Contract 版本与当前项目兼容性；
- `POST /api/standard/import`：从本机目录导入，经验证后创建新的迁移式根 Revision；
- `POST /api/standard/export`：导出当前冻结 Revision 到数据目录下 `exports/`；
- UI 提供导入路径、导出按钮、结果路径和验证结果。

接口只接受显式绝对路径；导入只读源目录，导出只写 `data-dir/exports/`，避免任意路径覆盖。

## 9. UI 变更

- 首屏增加迁移 Gate；未完成迁移时编辑区不可写。
- 顶栏显示产品版本、当前 Revision 和保存/冲突状态。
- 所有内容写请求携带渲染时的 `baseRevision`；收到冲突后刷新并提示用户重新应用。
- Submission 卡片显示中文状态、失败原因和“重新投递”。
- Proposal 卡片显示其 base Revision；过期 Proposal 禁止确认。
- 删除父 Outline 节点时明确提示将删除整个子树及所有关联页面，并由领域层完整级联。
- 增加“标准项目”面板，展示 Contract `0.1.0`、导入、导出与校验结果。
- 排版 Tab 在 `0.1.1` 中明确标记“0.2.0 提供”，不可进入空白假功能。

## 10. 错误契约

API 错误统一返回：

```json
{
  "error": {
    "code": "stale_revision",
    "message": "项目已更新，请刷新后重试。",
    "details": {
      "expectedRevision": 3,
      "currentRevision": 4
    }
  }
}
```

稳定错误码至少包括：

- `migration_required`、`migration_failed`；
- `stale_revision`、`stale_review_submission`；
- `invalid_command`、`invalid_reference`；
- `dispatch_failed`、`proposal_already_exists`；
- `standard_contract_invalid`、`standard_import_unsupported`；
- `repository_locked`、`repository_integrity_error`。

HTTP 状态：输入错误 400、冲突 409、迁移 Gate 428、锁冲突 423、服务不可用 503、未知内部错误 500。

## 11. 测试与验收

### 11.1 自动化

- UUIDv7 格式、稳定映射、级联删除、领域引用不变量；
- 两个写请求基于同一 Revision 时只有一个成功；
- 崩溃点故障注入：对象写入后、Revision 写入后、Head 发布前；
- 旧数据迁移成功、失败回滚、重复迁移、迁移后重启；
- Submission 固定上下文、Head 前进后的 stale、失败重投和幂等 Proposal；
- 标准 Fixture 导入、未编辑往返、编辑后导出和 Contract 全量验证；
- UI 迁移 Gate、冲突、重投、标准项目面板；
- Windows CRLF 下 Hash/size 验证稳定，Python 启动命令跨平台；
- 历史原型测试只作为隔离回归，不作为产品发布 Gate。

### 11.2 产品验收链

```text
旧数据启动
→ 用户确认迁移
→ 自动备份与校验
→ 标准项目导入
→ UI 编辑大纲和草案
→ 创建 ReviewSubmission
→ 当前 DSH Session 读取固定上下文
→ 创建并接受 Proposal
→ Revision CAS 成功
→ 重启恢复
→ 标准目录导出
→ Contract 全量复验
```

### 11.3 部署验收

- `npm test`；
- `npm run verify`；
- `npm run verify:ui`；
- `npm run verify:dsh`；
- `npm run verify:contracts`；
- `npm run verify:e2e`；
- 隔离 `DSH_HOME` 安装本地插件、启动 DSH、访问健康路由、完成一条原生 Session 工具闭环；
- Windows Chrome 六个响应式视口无阻断问题。

只有上述链路通过，才能声明“可部署使用”。真实模型生成质量另列为宿主验收，不以 Mock 结果代替。

## 12. 发布与回滚

- 发布版本为 `0.1.1`，提供明确的本地部署文档和升级说明。
- 安装升级不修改用户的旧 `state.json`；首次打开由 A1.1 Gate 执行迁移。
- 回滚应用版本时，旧应用继续读取原 `state.json`；新版本产生的数据不向旧格式回写。
- 标准导出目录始终可作为跨版本可移植备份。
- GitHub `main` 合并和远端发布不属于本地实现的自动副作用；完成验证后单独形成可审查提交。

