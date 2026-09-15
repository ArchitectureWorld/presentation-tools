# `@architectureworld/report-studio-dsh` v0.1.1

Report Studio `0.2.0-alpha.3` 当前开发分支使用的 DSH 原生自包含插件包。包版本仍保持 `0.1.1` 仅用于现有开发线兼容，不代表重新发布了同版本 npm 包。

插件在 DSH Web Profile 中提供：

- `Report Studio` 的 `conversation.view`；
- `conversation.session.header.actions` 中明确标注的独立窗口备用入口；
- `/report-studio` 同源 UI/API 路由；
- `studio_open_workspace_project` / `studio_reload_upstream`；
- `studio_get_context` / `studio_apply_commands`；
- 排版、预览、视觉生成、批量设计和交付工具族；
- 普通项目聊天的 `session.prompt(..., 'queue')` 通路；批注默认由隔离 `dsh-local-worker` 执行。

## DSH 0.1.5-rc.1 基线

```text
DSH: 0.1.5-rc.1
Profile: web
Session format: V3
Node.js: >=24.11.0
Security: local-single-user-only
```

0.1.5 Web Client 已不再以旧 `@deepseek-ai/dsh-client-runtime` 作为组合依赖。本插件的客户端依赖图固定为：

```text
@deepseek-ai/dsh-api-remotes
@deepseek-ai/dsh-api-session-controller
@deepseek-ai/dsh-client-ui-conversation
@deepseek-ai/dsh-client-ui-renderer
@deepseek-ai/dsh-client-ui-session
```

浏览器侧继续使用 `sessions.binding(sessionId)`、`session.prompt(..., 'queue')` 和当前两个 Conversation slots。Host 侧继续使用 `ctx.sessions` / `SessionHeader.cwd`、`session/event` / `session/disposed`、`ctx.llm` 与当前兼容的模型目录接口。

插件不读取已移除的 `session.events` 数组，也不依赖已移除的 `ctx.agent`。Session V3 日志格式由 DSH 自身管理，Report Studio Repository 不解析 DSH 持久化日志。

## 安装

```bash
node --version
dsh --version
# 以上应分别满足 >=24.11.0 与 0.1.5-rc.1

dsh plugin --profile web add ./architectureworld-report-studio-dsh-0.1.1.tgz
dsh --profile web --dump-config
dsh --profile web --no-open
```

正式入口是 `http://127.0.0.1:3080/`。先选择或创建 DSH Session，再进入 `Report Studio` 视图；模型、推理等级与普通消息输入仍由 DSH 原生界面管理。`/report-studio/?sessionId=...` 是 iframe/备用独立窗口的内部地址。

首次从旧 DSH 升级到 `0.1.5-rc.1` 前，应停止 DSH 并冷备份整个 `DSH_HOME`。完整升级/Session V3/回滚说明见仓库根目录 `DSH_INSTALL.md`。

## 独立批注任务

默认使用插件内 `dsh-local-worker`，通过 DSH `llm.stream` 复用当前 Session 的模型与宿主凭据管理，不复制主会话历史。每次提交、失败重试和退回调整创建独立 task 与 ReviewRun。模型只看到冻结的批注上下文和受控工具。

批注通过 CAS/Revision 网关直接应用经过严格校验的修改，不等待 Proposal 二次确认。历史 `proposals` / `proposalId` 仅作为兼容记录。失败和超时保留审计与重试入口；默认执行超时 120 秒，可通过 `reviewTimeoutMs` 或 `REPORT_STUDIO_AGENT_TIMEOUT_MS` 调整。

这是进程内上下文/工具能力隔离，不是 OS 沙箱或 DSH child-session。若所需 DSH `llm` 或模型目录能力不可用，插件不应静默退回主会话。健康检查通过 `reviewWorkerConfigured` 与 `reviewWorkerMode` 暴露实际执行器。

## 安全模式

插件要求 `ctx.webServer.host === '127.0.0.1'`，否则拒绝启动。query `sessionId` 只作为本机单用户路由键，不是认证凭据；不支持多人或网络共享安全。Agent 工具 Session 身份只来自 DSH tool execution context。

Report Studio 使用 Host `webServer` 注册 `/report-studio`，不依赖 DSH `0.1.5-rc.1` 中存在已知问题的第三方 `connection.rpc.handle()` 私有通道注册路径。

## 自动设计工具增量

页面/元素锁定由人工设置，自动内容与布局操作不能绕过；锁定状态会在应用时再次检查。

`studio_begin_design_batch` / `studio_next_design_batch` 负责持久批量任务；失败页通过 `studio_report_design_exception` 隔离；重启复用原候选和有效预览，最多 3 次候选/页，不新增逐页审批。

`studio_export_delivery` 导出同一批通过检查的图像式 HTML/PDF/PPTX，并附 Studio 源 JSON。PPTX 当前不是对象可编辑版本，PDF 当前不是可搜索原生文本。
