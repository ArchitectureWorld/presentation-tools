# Report Studio v0.1.1 发布验收记录

验收日期：2026-09-03（Asia/Shanghai）

仓库：`ArchitectureWorld/presentation-tools`

起始基线：`main@804dbd4dfa7bafc9acd373e9ae51f2d02c9f1257`

入口修复基线：`feat/report-studio-v0.1.1-hardening@77dd34023c88c591c4d0b8d57c511bc6706d116f`

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

结果：PASS。

- Root 单元/集成测试：51/51；
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
npm run smoke:dsh
```

结果：PASS。烟测从 `dist` tarball 安装到临时 DSH Home，解析并安装显式依赖，组合 Web Profile，启动真实 DSH Web，然后验证：

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
- iframe 加载当前 Session，Studio 内部重复 Agent FAB/弹窗不再作为入口，顶部引导使用 DSH 原生对话框；
- Studio 自有模型选择器数量为 0；
- 当前待确认 Proposal 显示在对应“第 1 次提交”容器底部；“待确认 1”可将“确认应用”按钮定位到批注滚动区可视范围；
- 直接访问独立页时显示“当前为 Report Studio 独立工作台……”以及“返回 DSH 主界面”；
- 浏览器控制台新增错误为 0；
- 批注生成的不可变 ReviewSubmission 已进入当前 DSH Session，Studio 显示“已投递”，Revision 保持 9，没有绕过 Proposal 直接写入；
- DSH 重启后重新读取：Revision 9、1 个草案页、4 条批注、2 个 ReviewRound、3 个 ReviewSubmission、1 个待确认 Proposal；
- 健康检查返回 `version=v0.1.1`、`agentMode=dsh-native`、`agentConfigured=true`、`migrationStatus=ready`。

宿主截图：

- `docs/acceptance/evidence/report-studio-v0.1.1-dsh-shell.png`
- `docs/acceptance/evidence/report-studio-v0.1.1-standalone-notice.png`
- `docs/acceptance/evidence/report-studio-v0.1.1-review-history-grouped.png`

真实 Agent 闭环存在一个宿主环境边界：当前 Session 的 DSH 模型请求连续重试 5 次后返回 `TRANSPORT / fetch failed`。因此本次真实宿主已证明 Prompt bridge 投递和“不直接改 Revision”，但没有由真实模型生成 Proposal。Proposal 创建、人工确认后才产生新 Revision、刷新与重启持久化的产品逻辑由自动化 E2E 覆盖并通过；真实模型端闭环需在 DSH Provider 传输恢复后复验，不把该外部传输失败误报为 Report Studio 通过。

## 发布物

```text
dist/architectureworld-report-studio-dsh-0.1.1.tgz
sizeBytes: 61618
sha256: 87D0571C3FC55787BD8C97A2C19E7B21E5656AEFFFFC31170BC117BE100A3338
files: 36
```

包内包含 DSH host/client、Studio Repository/Core/Contracts、标准 Adapter、Contract Schema 和生产 UI；AJV 依赖以精确版本声明。`prepack` 会从权威源码重新同步 vendor，避免手工复制漂移。

## A1.1 数据安全证据

- 发现旧 `state.json` 后写操作返回迁移 Gate，界面保持只读；
- 只有用户点击“备份并升级”才执行迁移；
- 旧文件逐字节备份且原文件不覆盖、不删除；
- `migration-map.json` 在重试时复用；
- 候选对象与引用校验完成后才原子发布 `control.json`；
- Head 发布前故障不会污染正式状态；
- 同一数据目录只允许一个写进程。

## 验收边界

已验证的是代码、数据迁移、浏览器 UI、标准目录、发布包、真实 DSH Host 路由和 Session prompt 投递。真实模型返回受当前 DSH Provider 的 `TRANSPORT / fetch failed` 阻断；目标账号、模型路由和真实项目内容质量仍属于部署环境验收。正式排版、分页以及 PPTX/PDF/HTML 成品导出不属于 v0.1.1。

## 部署与回滚

部署命令、Profile 备份、A1.1 操作和回滚边界见仓库根目录 `DSH_INSTALL.md`。发布前不得删除旧 `state.json` 或 `backups/`，不得让两个 DSH/Node 进程同时写同一 Session 数据目录。
