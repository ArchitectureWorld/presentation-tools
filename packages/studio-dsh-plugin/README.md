# `@architectureworld/report-studio-dsh` v0.1.1

Report Studio 的 DSH 原生自包含发布包。它包含 Studio Runtime、浏览器 UI、Presentation Standard Project Adapter 与 Contract 校验运行文件，并在 DSH Web Profile 中注册：

- `Report Studio` 会话视图，以及明确标注为独立窗口的会话头部备用动作；
- `/report-studio` 同源 UI/API 路由；
- `studio_get_context`；
- `studio_apply_commands`；
- 普通项目聊天的 `session.prompt(..., 'queue')` 通路；批注不进入主会话。

## 安装

```bash
dsh plugin --profile web add ./architectureworld-report-studio-dsh-0.1.1.tgz
dsh --profile web --dump-config
dsh --profile web --no-open
```

当前排版开发分支要求 Node.js >=24.11.0；原生集成参考基线为 DSH `0.1.1-rc.2`、Profile `web`。本轮开发包尚未完成真实 DSH 双插件/模型验收，不是新发布版本。正式模式不需要 `npm start`、`REPORT_STUDIO_AGENT_URL` 或外部 HTTP Bridge。

正式入口是 `http://127.0.0.1:3080/`。先选择或创建 DSH Session，再点击 `Report Studio` 标签；模型、推理等级与消息输入始终使用 DSH 原生控制栏。`/report-studio/?sessionId=...` 是 iframe/独立工作台内部地址，不得作为安装后的默认入口。

数据目录沿用 `report-studio-v0.1.0` 兼容名称，以发现旧 Session 的 `state.json`；检测到旧数据后必须由用户在 UI 中确认 A1.1 备份迁移。

## 独立批注任务

默认使用插件内 `dsh-local-worker`，通过 DSH `llm.stream` 复用当前 Session 选择的模型及宿主凭据管理，不复制主会话历史。每次提交、失败重试和退回调整均创建新的 task 与 ReviewRun。模型只能读取当前冻结批注上下文，并将结构化 commands 交给现有 Proposal/CAS 网关，不能直接提交 Revision。

批注提交后，所有经过严格校验的修改都会通过现有 CAS 网关自动应用并结束任务；不按可逆性区分，不创建 Proposal，也不等待确认。失败和超时会取消执行并保留审计与重试入口。默认执行超时 120 秒，可通过 `reviewTimeoutMs` 或 `REPORT_STUDIO_AGENT_TIMEOUT_MS` 调整。

这是进程内的上下文和工具能力隔离，不是操作系统沙箱或 DSH 原生 child-session。完整 transcript 仅存在于处理中的局部内存；返回后保留冻结任务上下文，宿主退出时释放。ReviewRun/Proposal 审计持久保存，但宿主重启不会恢复原 worker 内存。普通聊天仍使用主会话；配置 `REPORT_STUDIO_AGENT_URL` 时保留外部 HTTP worker adapter。

健康检查的 `reviewWorkerConfigured` 和 `reviewWorkerMode` 用于确认实际执行器。`scripts/smoke-review-worker.mjs` 需要显式提供 DSH 入口、插件包、设置文件和凭据文件路径；它创建独立 DSH_HOME、Workspace、数据目录和端口，使用样例批注验证真实模型链路，且校验正式设置和凭据未变化。

## 安全模式

DSH `0.1.1-rc.2` 的 host SDK 没有为插件 HTTP 路由提供可信 Session 身份或 iframe capability hook。本插件明确采用 `securityMode=local-single-user-only`，要求 `ctx.webServer.host === '127.0.0.1'`，否则拒绝启动。健康检查同时返回 `listenHost=127.0.0.1` 与 `networkSharedSecurity=false`。query `sessionId` 不是认证，不支持多人或网络共享部署；Agent 工具 Session 仅来自 DSH exec context。

## 自动设计工具增量（2026-09-11 开发态）

页面/元素锁定由人工设置，自动内容与布局操作不能绕过；锁定在预览之后变化也会在应用时重新检查。
通过 `studio_begin_design_batch` / `studio_next_design_batch` 读取持久批量任务，DSH 执行 Pre-design 的设计和看图评审。
失败页通过 `studio_report_design_exception` 隔离；重启复用原候选和有效预览，最多3次候选/页，不新增逐页审批。
`studio_export_delivery` 导出同一批通过检查的图像式 HTML/PDF/PPTX，另附 Studio 源 JSON；PPTX不是对象可编辑版本，PDF不是可搜索原生文本。

保持当前包版本 `0.1.1` 只为兼容既有分支，不允许把本次开发包覆盖发布到同版本的公共注册表。
