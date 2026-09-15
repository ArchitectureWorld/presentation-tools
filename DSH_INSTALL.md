# Report Studio 0.2.0-alpha.3 — DSH 0.1.5-rc.1 安装、升级与回滚

本文件是 `feat/report-studio-v0.2.0-layout` 的当前部署入口。Report Studio 运行在 DSH Web Profile 内，复用 DSH 的 Session、模型与 Agent 能力；独立 `4173` 仅用于源码调试。当前目标 DSH 固定为 `0.1.5-rc.1`，不能用历史 `0.1.1-rc.2` 验收结果代替本轮兼容验证。

## 固定基线

```text
Repository: ArchitectureWorld/presentation-tools
Branch: feat/report-studio-v0.2.0-layout
Report Studio: 0.2.0-alpha.3
Plugin: @architectureworld/report-studio-dsh@0.1.1
DSH: 0.1.5-rc.1
DSH Session format: V3
Profile: web
Node.js: >=24.11.0
Security mode: local-single-user-only
```

插件包仍保持 `0.1.1` 只是当前开发分支的兼容包版本，不代表重新发布了同版本 npm 包。

## 1. DSH 升级前：必须先做冷备份

**先停止所有 DSH 进程，再备份整个 `DSH_HOME`。** DSH `0.1.5` 使用 Session V3；DSH Session 数据迁移与 Report Studio 自身 A1.1 迁移是两套不同机制。仅备份 `profiles/web` 或 Report Studio 数据不足以覆盖 DSH Session 回滚。

PowerShell 示例：

```powershell
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$dshRoot = if ($env:DSH_HOME) { $env:DSH_HOME } else { "$env:USERPROFILE\.dsh" }
$backupRoot = Join-Path (Split-Path $dshRoot -Parent) "dsh-backup-pre-0.1.5-rc.1-$stamp"

if (Get-Process node -ErrorAction SilentlyContinue) {
  Write-Host '请确认没有正在运行的 DSH/Node 进程写入 DSH_HOME。'
}

Copy-Item -LiteralPath $dshRoot -Destination $backupRoot -Recurse
Get-ChildItem -LiteralPath $backupRoot -Recurse -File | Get-FileHash -Algorithm SHA256 |
  Export-Csv -LiteralPath (Join-Path $backupRoot 'sha256.csv') -NoTypeInformation -Encoding UTF8

$backupRoot
```

同时建议单独再备份：

```text
$DSH_HOME/profiles/web
$DSH_HOME/report-studio-v0.1.0
```

### Session V3 文件系统要求

首次让 `0.1.5-rc.1` 打开旧 Session 前，`DSH_HOME` 应位于本机原生、支持可靠原子写入与硬链接语义的文件系统。不要直接在 exFAT、部分 FUSE 挂载、网络盘/NAS 映射目录上执行首次 Session V3 迁移。需要迁移时，先复制到本机 NTFS/APFS/ext4/btrfs 等原生文件系统，完成验证后再决定后续存储策略。

**降级 DSH 包不等于 Session 回滚。** 若 `0.1.5` 已迁移 Session，而旧版本不能读取 V3，正确回退方式是停止 DSH 后恢复完整的升级前 `DSH_HOME` 冷备份。

## 2. 安装 DSH 0.1.5-rc.1

本分支要求 Node `>=24.11.0`：

```bash
node --version
npm install --global @deepseek-ai/dsh@0.1.5-rc.1
dsh --version
```

`dsh --version` 必须实际输出 `0.1.5-rc.1`。空输出即视为失败，不接受“退出码 0 但没有版本号”。仓库 `smoke:dsh` 也会执行同样的硬校验。

## 3. 获取并验证 Presentation

```bash
git clone https://github.com/ArchitectureWorld/presentation-tools.git
cd presentation-tools
git checkout feat/report-studio-v0.2.0-layout
git pull --ff-only
npm ci
npm ci --prefix contracts/presentation-standard-project --ignore-scripts --no-audit --no-fund
npm run verify:all
```

当前 DSH 兼容 Review：`docs/review/2026-09-15-dsh-0.1.5-rc.1-compatibility-review.md`。

## 4. 0.1.5 Web Client 适配点

当前插件不再声明已退出 0.1.5 组合的 `@deepseek-ai/dsh-client-runtime`。浏览器端依赖图固定为：

```text
@deepseek-ai/dsh-api-remotes
@deepseek-ai/dsh-api-session-controller
@deepseek-ai/dsh-client-ui-conversation
@deepseek-ai/dsh-client-ui-renderer
@deepseek-ai/dsh-client-ui-session
```

Report Studio 继续使用：

```text
ctx.sessions / SessionHeader.cwd
session/event / session/disposed
sessions.binding(sessionId)
session.prompt(..., 'queue')
conversation.view
conversation.session.header.actions
```

它不读取旧的 `session.events` 数组，也不依赖已移除的 `ctx.agent`。Host 工具从 DSH tool execution context 取得 Agent/Session 身份。隔离批注 worker 继续使用 DSH `llm` 与当前兼容的 Host 模型目录接口；真实 `0.1.5-rc.1` smoke 是该兼容性的发布门禁。

## 5. 构建并安装 Report Studio 插件

在仓库根目录执行：

```bash
dsh plugin --profile web remove @architectureworld/report-studio-dsh
npm run sync:vendor
git diff --exit-code -- packages/studio-dsh-plugin/vendor
rm -rf .tmp/report-studio-pack
mkdir -p .tmp/report-studio-pack
npm pack ./packages/studio-dsh-plugin --pack-destination .tmp/report-studio-pack
REPORT_STUDIO_DSH_VERSION=0.1.5-rc.1 \
REPORT_STUDIO_PLUGIN_PACKAGE=.tmp/report-studio-pack/architectureworld-report-studio-dsh-0.1.1.tgz \
npm run smoke:dsh
dsh plugin --profile web add ./.tmp/report-studio-pack/architectureworld-report-studio-dsh-0.1.1.tgz
dsh --profile web --dump-config
dsh --profile web --no-open
```

首次安装时 `remove` 提示插件不存在可以继续。不要在 `packages/studio-dsh-plugin/` 内额外执行 `npm install`。`dump-config` 必须仍包含用户原有插件，同时包含 `@architectureworld/report-studio-dsh`。

正式入口：`http://127.0.0.1:3080/`。

使用顺序：

1. 在 DSH 中选择或创建 Session；
2. 点击当前 Session 的 `Report Studio` 视图；
3. 模型、推理等级与普通对话继续由 DSH 原生界面管理；
4. Studio 负责内容编辑、批注、排版、检查、保存与交付。

`/report-studio/?sessionId=...` 是内部 iframe/备用独立窗口地址，不是正式入口。

## 6. Session 与网络安全边界

当前插件继续采用 `securityMode=local-single-user-only`：

- DSH Web 必须监听 `127.0.0.1`；
- `0.0.0.0` 会被插件拒绝；
- query `sessionId` 只是本机路由键，不是认证令牌；
- 不声明多人或网络共享安全；
- Agent 工具的 Session 身份来自 DSH 执行上下文，而不是浏览器传入值。

DSH 0.1.5 自身某些第三方 `connection.rpc.handle()` 插件存在 rc.1 已知问题，但 Report Studio 的 `/report-studio` 路由直接注册在 Host `webServer`，不走该私有 client-connection RPC 注册路径。若同一 Profile 内其他插件使用该 API，应分别升级/验证，不能把它们的 405 故障归因于 Report Studio。

## 7. Workspace Live Link

Report Studio 只从当前 DSH Session 的 `SessionHeader.cwd` 解析 Workspace。`studio_open_workspace_project` 检查 `project.json` 并执行 Presentation Standard Project Directory `0.1.0` 全量验证。

Live Link 默认 `750 ms` 防抖。连续 change、Windows rename 或目录替换都会完整重扫；无效中间态不会替换当前合法快照。已保存的本地内容偏离上游基线时进入 `local_saved_conflict`，没有用户明确放弃不得覆盖。`layouts/` 归 Presentation 管理。

```bash
npm run verify:workspace
```

通过标志：`PRESENTATION_WORKSPACE_LIVE_LINK_PASS`。

## 8. Report Studio A1.1 数据迁移

兼容数据根继续使用：

```text
$DSH_HOME/report-studio-v0.1.0/
```

这是为了识别旧 Studio `state.json`，与 DSH Session V3 的版本号无关。检测到旧 Studio 数据后，界面保持只读；用户点击“备份并升级”后才执行逐字节备份、稳定 ID 映射、对象校验和 `control.json` 原子切换。

迁移结果：

```text
state.json                         原文件，保留
backups/<timestamp>/state.v0.1.0.json
migration-map.json
control.json
objects/sha256/*.json
```

同一 Studio 数据目录只允许一个 DSH/Node 写进程。

## 9. 当前直接修改与隔离批注 worker

批注默认由插件内 `dsh-local-worker` 执行：只接收冻结 ReviewSubmission 上下文和受控工具，不复制主会话历史。修改通过 CAS/Revision 网关直接应用，不等待 Proposal 二次确认；`proposals` / `proposalId` 仅作为旧兼容记录字段。

如果隔离 worker 缺少 DSH `llm` / 模型解析能力，插件应失败关闭该路由而不是悄悄退回主会话。`/report-studio/api/health` 应暴露 `reviewWorkerConfigured` 与 `reviewWorkerMode`。

补图中断继续使用 `studio_resume_design_visual`，复用原 `runId + pageId + sourceStateHash + requestId`，不得用新 requestId 重复付费生成。

## 10. 验证清单

```bash
npm run verify:all
npm run sync:vendor
git diff --exit-code -- packages/studio-dsh-plugin/vendor
rm -rf .tmp/report-studio-pack
mkdir -p .tmp/report-studio-pack
npm pack ./packages/studio-dsh-plugin --pack-destination .tmp/report-studio-pack
REPORT_STUDIO_DSH_VERSION=0.1.5-rc.1 \
REPORT_STUDIO_PLUGIN_PACKAGE=.tmp/report-studio-pack/architectureworld-report-studio-dsh-0.1.1.tgz \
npm run smoke:dsh
```

真实环境至少验收：

- `dsh --version` = `0.1.5-rc.1`；
- DSH Web 能正常启动，浏览器客户端无模块缺失；
- Session 创建/恢复、`Report Studio` 视图与 header action 正常；
- 当前 Session 的 `SessionHeader.cwd` 能打开 Workspace；
- 普通聊天 `session.prompt(..., 'queue')` 可用；
- 隔离批注 worker 可解析当前模型并完成一次直接修改；
- `session/event` / `session/disposed` 驱动的任务状态恢复正常；
- 大纲、草案、批注、Layout、OpenPencil、导出与重启恢复通过；
- `/report-studio/api/health` 保持 `securityMode=local-single-user-only`、`listenHost=127.0.0.1`；
- Pre-design 与用户原有 DSH 插件仍存在，没有被安装流程覆盖。

## 11. 回滚

### Report Studio 插件回滚

停止 DSH，移除当前插件，恢复插件升级前的 `profiles/web` 与 Report Studio 数据备份，再启动 DSH。不要删除 `$DSH_HOME/report-studio-v0.1.0/`。

### DSH 0.1.5 / Session V3 回滚

如果问题涉及 DSH `0.1.5` 自身或 Session V3：

1. 停止所有 DSH 进程；
2. 保存当前故障现场副本；
3. 恢复**首次启动 0.1.5 前**的完整 `DSH_HOME` 冷备份；
4. 再安装需要回退的 DSH 包版本；
5. 启动并验证 Session/Profile。

不要只执行 `npm install -g` 降级后继续使用已迁移的 V3 Session 目录。

## 12. 卸载

```bash
dsh plugin --profile web remove @architectureworld/report-studio-dsh
```

卸载插件不授权删除任何 DSH Session、Report Studio 数据、Workspace 或交付文件。
