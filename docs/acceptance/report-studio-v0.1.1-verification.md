# Report Studio v0.1.1 稳定化验收记录

> 当前记录对应最终代码 `2ebe7e43bad1bb1d0de1e5fc037aa15184c05585`。技术验证通过不等于自动批准合并或发布；PR #6 仍保持 Draft，等待人工验收。

验收日期：2026-09-04（Asia/Shanghai）

仓库：`ArchitectureWorld/presentation-tools`

起始基线：`main@804dbd4dfa7bafc9acd373e9ae51f2d02c9f1257`

稳定化代码：`feat/report-studio-v0.1.1-hardening@2ebe7e43bad1bb1d0de1e5fc037aa15184c05585`

产品版本：`Report Studio 0.1.1`

标准版本：`Presentation Standard Project Directory 0.1.0`

## 结论

Report Studio v0.1.1 已形成可安装、可启动、可迁移、可编辑、可评审、可恢复、可导入/导出标准项目的“大纲 + 草案”产品闭环。发布 tarball 已在隔离 DSH Home 中真实安装并启动，不依赖仓库外部相对路径。

正式产品入口统一为 `http://127.0.0.1:3080/`。正常使用时先在 DSH 中选择或创建会话，再点击会话顶部的 `Report Studio` 标签；模型、推理等级和消息输入继续由 DSH 原生控制栏管理。`/report-studio/?sessionId=...` 只是同源 iframe 内容或带明确提示的独立工作台，不再作为安装、启动或验收默认入口。

“标准化结构性文件”与当前交付范围完全适配，但不是与未来全部能力完全等同：

| 关系 | 验收结论 |
|---|---|
| 标准 Project/Rules/Outline/Page/Draft → Studio | 经唯一 Adapter 导入，标准 ID 保持不变 |
| Studio 编辑 → 标准目录 | 从冻结 Revision 导出并通过 Contract 0.1.0 |
| 标准暂不支持的 UI 内容块 | 指标组等以 opaque extension 无损保留 |
| 素材 | 原文件字节保留；Studio 新增 data-URL 素材会落盘并进入 Asset Manifest |
| 删除页面 | 不导出历史残留 Draft，避免 `FILE_UNDECLARED` |
| 运行治理 | Annotation、Submission、Proposal、Session、Head/CAS 不污染中立标准目录 |
| 排版与成品导出 | Contract 已保留 `layouts/` 边界；UI、分页、PPTX/PDF/HTML 成品能力明确延期到 0.2.0 |

因此，v0.1.1 不存在“标准文件一套、UI 一套、底层又一套”的并行事实源；当前正式内容统一经过 Canonical Snapshot、Repository 事务和 Revision CAS。

## 验证环境

```text
Windows
Node.js v25.4.0（产品最低要求 22+）
Python 3.14.2
Google Chrome 152.0.7977.66
DSH 0.1.1-rc.2
DSH Profile web
```

## 自动化验证

### 完整门禁

命令：

```bash
npm run verify:all
```

结果：176/176，失败 0。

- Root 单元/集成测试：176/176；
- 标准 Contract Node 测试：8/8；
- Schema Set SHA-256：`5bd329fcc8503ff7a48b3430e41b38dd264ae486cee7372a39cbbcccc2de2ebc`；
- 最小 Fixture、完整示例、npm pack 和独立 consumer：PASS；
- 本地持久化、并发 CAS、迁移失败回滚、DSH 冻结上下文、重投与幂等 Proposal：PASS；
- E2E：迁移 → 编辑 → Submission → Proposal → 接受 → 重启 → 标准导出 → Contract 校验，PASS；
- 浏览器：720×900、820×900、1024×768、1366×768、1600×900、1920×1080，PASS；
- 浏览器控制台错误与水平溢出：0。
- DSH 入口回归：`conversation.view` 绑定当前 Session，正常标签路径不调用 `window.open()`；HeaderAction 明确标注“独立打开”并在打开前提示边界；独立页显示返回 DSH 主界面的非遮挡提示；Studio 未定义模型或推理等级选择器。
- 批注历史回归：Proposal 按 `submissionId` 归入对应“第 N 次提交”底部；待确认 Proposal 在“未完成”筛选中保持可见；长批注列表可由“待确认 N”入口重新定位到确认按钮。

### 发布包隔离安装与启动

命令：

```bash
rm -rf .tmp/report-studio-pack
mkdir -p .tmp/report-studio-pack
npm pack ./packages/studio-dsh-plugin --pack-destination .tmp/report-studio-pack
REPORT_STUDIO_PLUGIN_PACKAGE=.tmp/report-studio-pack/architectureworld-report-studio-dsh-0.1.1.tgz npm run smoke:dsh
```

结果：PASS。烟测只从 `REPORT_STUDIO_PLUGIN_PACKAGE` 指定的当前 checkout 新打 tarball 安装到临时 DSH Home，解析并安装显式依赖，组合 Web Profile，启动真实 DSH Web，然后验证：

- `/report-studio/api/health?sessionId=smoke-session`；
- `version=v0.1.1`；
- `agentMode=dsh-native`；
- `agentConfigured=true`；
- `migrationStatus=ready`；
- DSH 根页面、正式 UI 与 `dsh-native-runtime.js` 可访问；独立页包含返回 DSH 的提示。

## 真实 DSH Web Profile 验收

新 tgz 已安装到真实 `web` Profile，并在 `http://127.0.0.1:3080/` 验收：

- DSH 会话侧栏、原生消息输入、模型选择器和推理等级可见且可用；
- `Report Studio` 标签注册成功；从“对话”切换到该标签后浏览器地址仍为 `/`，没有跳转到独立页；
- iframe 加载当前 Session；项目级悬浮 Agent FAB/约 80% 聊天窗保留并绑定同一 Session，不包含模型或 Provider 控件，也不建立第二套 Runtime；
- Studio 自有模型选择器数量为 0；
- 当前待确认 Proposal 显示在对应“第 1 次提交”容器底部；“待确认 1”可将“确认应用”按钮定位到批注滚动区可视范围；
- 直接访问独立页时显示“当前为 Report Studio 独立工作台……”以及“返回 DSH 主界面”；
- 浏览器控制台新增错误为 0；
- 既有迁移项目在部署与重启后保持 Revision 9、1 个草案页、4 条批注、2 个 ReviewRound、3 个 ReviewSubmission、1 个 ReviewRun、1 个 Proposal；
- 独立真实 Provider 验收 Session 中，批注生成的不可变 ReviewSubmission 进入当前 DSH Session，Agent 依次使用 `studio_get_context` 与 `studio_apply_commands` 生成待确认 Proposal，没有直接写入 Revision；
- 人工点击确认后 Revision `3 → 4`，标题更新为“验收页面：Agent Proposal 已生成”；DSH 重启后 Proposal 和 ReviewRun 均恢复为 `accepted`；
- 健康检查返回 `version=v0.1.1`、`agentMode=dsh-native`、`agentConfigured=true`、`migrationStatus=ready`。

历史入口与分组截图：

- `docs/acceptance/evidence/report-studio-v0.1.1-dsh-shell.png`
- `docs/acceptance/evidence/report-studio-v0.1.1-standalone-notice.png`
- `docs/acceptance/evidence/report-studio-v0.1.1-review-history-grouped.png`

当前真实 Provider 截图：

- `docs/acceptance/evidence/report-studio-v0.1.1-provider-proposal-accepted-2ebe7e4.png`（SHA-256 `25FBEFB4E575BF45E50D9DE17A342885C7A089580463353C285D3E0D3D33BA3E`）
- `docs/acceptance/evidence/report-studio-v0.1.1-provider-restart-persisted-2ebe7e4.png`（SHA-256 `68560586B5873BEFF64B5C208D42E3847D962F3C212FAB4C85B4A81BEE9C0C80`）

真实 Provider 验收 Session：`session-d8666c4f-f5e3-4028-89ae-d592e53bf06d`。此前 `TRANSPORT / fetch failed` 属于 2026-09-03 的历史环境故障，不再是当前阻断。

## 发布物

```text
C:\pt-rvw-804dbd4\.tmp\report-studio-pack-2ebe7e4\architectureworld-report-studio-dsh-0.1.1.tgz
sourceCommit: 2ebe7e43bad1bb1d0de1e5fc037aa15184c05585
sizeBytes: 89201
sha256: 322A13CCC0E0F7D76216EBB1DA67F60AF5C0F167425265256CB0EAEC9B2B8271
files: 39
```

包内包含 DSH host/client、Studio Repository/Core/Contracts、标准 Adapter、Contract Schema 和生产 UI；AJV 依赖以精确版本声明。`prepack` 会从权威源码重新同步 vendor，避免手工复制漂移。

同一代码 SHA 的 Linux CI artifact 为 88,175 bytes、39 files、SHA-256 `A8782935C9C08BD70A4CC8269A8181E6C035A8B38933E5694FEAF2D561A58D7A`。平台包分别通过内容清单、release-integrity 和 DSH smoke。

## A1.1 数据安全证据

- 发现旧 `state.json` 后写操作返回迁移 Gate，界面保持只读；
- 只有用户点击“备份并升级”才执行迁移；
- 旧文件逐字节备份且原文件不覆盖、不删除；
- `migration-map.json` 在重试时复用；
- 候选对象与引用校验完成后才原子发布 `control.json`；
- Head 发布前故障不会污染正式状态；
- 同一数据目录只允许一个写进程。

## 验收边界

已验证的是代码、数据迁移、浏览器 UI、标准目录、发布包、真实 DSH Host 路由、Session prompt 投递、真实模型 Proposal、人工确认和重启恢复。具体项目内容质量仍属于业务验收。正式排版、分页以及 PPTX/PDF/HTML 成品导出不属于 v0.1.1。

GitHub 证据：push run `33858374268`、PR run `33858377994` 的 Linux/Windows 均 success，Standard Project run `33858377996` success。main 已配置 `strict=true`、`linux-verification` / `windows-verification` required checks、PR 必经和 `enforce_admins=true`，并禁止 force push 与删除。PR #6 未合并。

## 部署与回滚

部署命令、Profile 备份、A1.1 操作和回滚边界见仓库根目录 `DSH_INSTALL.md`。发布前不得删除旧 `state.json` 或 `backups/`，不得让两个 DSH/Node 进程同时写同一 Session 数据目录。
