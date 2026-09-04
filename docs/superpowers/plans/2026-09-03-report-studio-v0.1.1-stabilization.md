# Report Studio v0.1.1 稳定化实施计划

> 严格执行 TDD：每个问题域先提交可复现失败测试，再做最小实现和回归；所有工作保留在 `feat/report-studio-v0.1.1-hardening`。

## 执行批次

### Task 1: 可重复 CI 与包完整性

  - [x] 完成本批次。
  - 根项目固定 `ajv@8.17.1`、`ajv-formats@3.0.1` 并提交 lockfile。
  - 用唯一的 `Report Studio v0.1.1 CI` 替换旧 v0.1.0 workflow，覆盖 PR、支线 push、Windows/Linux 干净安装。
  - `verify:all` 覆盖根测试、领域、Repository/迁移/CAS、Contract、Adapter、E2E、响应式 UI、DSH 集成。
  - vendor sync 后必须零 diff；当前 HEAD 现场 pack，smoke 禁止回退读取 `dist`。

### Task 2: 空 Workspace 标准导入

  - [x] 完成本批次。
  - 先添加非空拒绝、根 Revision、projectId 链隔离和失败不改 Head 测试。
  - 新增 `initializeFromStandardProject()`，导入不再调用普通内容事务。
  - 服务端返回结构化 `standard_import_requires_new_workspace`（409），UI 展示不可覆盖说明。

### Task 3: 二进制 ObjectStore 与 Asset Ingestion

  - [x] 完成本批次。
  - 先添加 20MB、去 Base64、去线性 Snapshot 增长、Blob 复用、字节/哈希往返测试。
  - Repository 增加流式 Blob put/read；新增受控上传和读取 API。
  - Adapter 归档与 PageAsset 全部改为 ObjectRef。

### Task 4: Canonical 身份稳定

  - [x] 完成本批次。
  - 扩展 Canonical Model，创建/导入时持久化全部稳定 ID。
  - 保持多 ScriptBlock、同 Asset 多 PageAsset、稳定 ListItem 和 unsupported block。
  - 连续导出和编辑后导出不得重建正式 ID。

### Task 5: staging 导出

  - [x] 完成本批次。
  - 先添加验证失败、并发唯一目录、既有导出不覆盖测试。
  - staging 写入与 Contract 验证通过后原子发布；失败清理 staging。

### Task 6: Draft Edit Buffer 与 no-op

  - [x] 完成本批次。
  - 添加 dirty 切页/结构操作/Proposal 刷新/stale/已有草案/no-op/View 测试。
  - 页面级 Buffer、自动保存、显式保存、flush gate、离开确认和冲突保留。
  - Repository Candidate 等值时不创建 Revision；View 只走 operational transaction。

### Task 7: ReviewSubmission 与严格 Command

  - [x] 完成本批次。
  - 冻结 Submission scope、allowedCommands、writableIds 和批注快照。
  - 用严格 Command union 替换任意对象 Schema；普通权限移除 `outline.delete`。
  - Proposal 创建前在隔离 Candidate 完整预检并生成结构化 Diff。
  - Proposal UI 增加 Revision、对象、Before/After、风险、删除提示、拒绝和返回 Agent。

### Task 8: ReviewRun 与单调状态机

  - [x] 完成本批次。
  - 集中状态迁移服务；dispatch、重试、DSH 工具和 watcher 共用。
  - pending_dispatch 可恢复，重复 dispatched 幂等，终态不得倒退。

### Task 9: 悬浮 Agent 与 Session Capability

  - [x] 完成本批次。
  - 恢复 iframe 内 FAB/80% 聊天窗，不增加模型或 Provider 控件。
  - 普通聊天与 Submission 进入同一 DSH Session 时间线。
  - 能力令牌绑定、过期和跨 Session 拒绝测试；无法建立强绑定时只允许 localhost 单用户边界。

### Task 10: 全量门禁、文档和真实宿主

  - [x] 完成本批次。
  - 新增 Review Resolution 与最终 Handoff，逐项记录提交、测试和证据。
  - 在 Windows/Linux 无历史 `node_modules` checkout 执行正式四阶段验证。
  - 真实 DSH Shell 验证 iframe、原生控件、悬浮 Agent、同 Session、持久化和控制台。
  - 真实 Provider 已完成 Proposal、人工确认和重启恢复；main required checks、PR 必经与管理员不可绕过已配置；PR 保持 Draft，等待人工验收。

## 提交边界

按以下问题域分别提交，禁止压成单一提交：

1. `fix(ci): make v0.1.1 verification reproducible`
2. `fix(import): isolate standard project initialization`
3. `refactor(storage): move managed bytes out of canonical snapshots`
4. `refactor(canonical): stabilize draft and asset identities`
5. `fix(editor): preserve dirty edits and prevent no-op revisions`
6. `fix(review): enforce scope command and lifecycle rules`
7. `fix(agent): restore session-bound floating agent workflow`
8. `test: add v0.1.1 blocker regression coverage`
9. `docs: align architecture acceptance and handoff`

## 完成判定

附件列出的 25 项完成门槛逐项有当前 HEAD 证据前，不使用“完成”“全部通过”“生产可用”“可以发布”或“可以合并”。外部 Provider 或 GitHub 保护规则如果尚不可验证，必须在最终文档标记为未完成阻断，而不是用本地模拟代替。
