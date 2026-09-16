# Report Studio 0.2.0-alpha.3 — DSH 0.1.5-rc.1 安装、升级与回滚

本文件是 `feat/report-studio-v0.2.0-layout` 的当前部署入口。Report Studio 运行在 DSH Web Profile 内，复用 DSH 的 Session、模型与 Agent；独立 `4173` 仅用于源码调试。

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

插件包版本 `0.1.1` 与产品版本 `0.2.0-alpha.3` 是不同版本对象，不要为了表面统一改动插件兼容版本、Contract `0.1.0` 或兼容数据目录。

## 1. 升级前必须冷备份

先停止所有 DSH 进程，再备份整个 `DSH_HOME`。DSH `0.1.5` 使用 Session V3；DSH Session 数据迁移与 Report Studio A1.1 数据迁移是两套不同机制。

PowerShell 示例：

```powershell
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$dshRoot = if ($env:DSH_HOME) { $env:DSH_HOME } else { "$env:USERPROFILE\.dsh" }
$backupRoot = Join-Path (Split-Path $dshRoot -Parent) "dsh-backup-pre-0.1.5-rc.1-$stamp"
Copy-Item -LiteralPath $dshRoot -Destination $backupRoot -Recurse
Get-ChildItem -LiteralPath $backupRoot -Recurse -File | Get-FileHash -Algorithm SHA256 |
  Export-Csv -LiteralPath (Join-Path $backupRoot 'sha256.csv') -NoTypeInformation -Encoding UTF8
$backupRoot
```

建议再单独备份：

```text
$DSH_HOME/profiles/web
$DSH_HOME/report-studio-v0.1.0
```

### Session V3 文件系统要求

首次用 `0.1.5-rc.1` 打开旧 Session 时，`DSH_HOME` 应放在本机原生文件系统。不要直接在 exFAT、部分 FUSE、网络盘或 NAS 映射目录上执行首次 V3 迁移。需要迁移时，先复制到本机 NTFS/APFS/ext4/btrfs 等原生文件系统完成验证。

**仅降级 npm 包不等于 Session 回滚。** 如果 `0.1.5` 已经迁移了 Session，正确回退方式是停止 DSH 后恢复升级前的完整 `DSH_HOME` 冷备份。

## 2. 安装 DSH 0.1.5-rc.1

```bash
node --version
npm install --global @deepseek-ai/dsh@0.1.5-rc.1
dsh --version
```

`node --version` 必须满足 `>=24.11.0`。`dsh --version` 必须实际输出 `0.1.5-rc.1`；空输出也按失败处理。

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

当前兼容 Review：

```text
docs/review/2026-09-15-dsh-0.1.5-rc.1-compatibility-review.md
```

## 4. DSH 0.1.5 适配基线

### Web Client

当前插件不再声明旧的 `@deepseek-ai/dsh-client-runtime`。浏览器依赖图为：

```text
@deepseek-ai/dsh-api-remotes
@deepseek-ai/dsh-api-session-controller
@deepseek-ai/dsh-client-ui-conversation
@deepseek-ai/dsh-client-ui-renderer
@deepseek-ai/dsh-client-ui-session
```

### Host

当前 Host 服务为：

```text
tools
webServer
systemPrompt
sessions
llm
sessionController
sessionProjections
agentDefaultModel
```

`apiProxy` 已从 DSH 0.1.5 的 Host 组合中移除，Report Studio 不再声明或调用它。隔离批注 worker 的模型选择来自当前 Session 的 `modelSelection` projection；无显式选择时回退到 `agentDefaultModel`，模型执行仍由 DSH `llm` 完成。

Report Studio 继续使用：

```text
ctx.sessions / SessionHeader.cwd
session/event / session/disposed
session.seq / session.snapshotEvents()
sessions.binding(sessionId)
session.prompt(..., 'queue')
conversation.view
conversation.session.header.actions
```

它不读取旧 `session.events`，也不依赖已移除的 `ctx.agent`。

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

首次安装时 `remove` 提示插件不存在可以继续。不要在 `packages/studio-dsh-plugin/` 内额外执行 `npm install`。`--dump-config` 必须同时保留用户原有插件与 `@architectureworld/report-studio-dsh`。

## 6. DSH 0.1.5 浏览器认证：首次打开必须使用启动 URL

DSH `0.1.5` 启动后会输出类似：

```text
http://127.0.0.1:3080/?token=<一次性启动令牌>
```

这个 `?token=...` 不是 API Token。它只用于**首次根页面换取 DSH 的 HttpOnly 浏览器会话 Cookie**，随后浏览器会跳转到干净的：

```text
http://127.0.0.1:3080/
```

因此：

1. 新浏览器/新 Profile 首次访问时，使用 DSH 控制台实际打印的 `?token=...` 启动 URL；
2. 不要把这个 token 放进 `/api/...` URL；
3. 不要把它写成 Authorization Header；
4. 不要把启动 URL、Cookie 或 `$DSH_HOME/.credentials.yaml` 发到日志、Issue 或截图；
5. 浏览器 Cookie 建立后，日常正式入口才是 `http://127.0.0.1:3080/`。

仓库 `smoke:dsh` 会按同样流程完成 token → Cookie 交换，并在 CI 输出中遮蔽启动 token。

## 7. 正式使用顺序

1. `dsh --profile web --no-open`；
2. 第一次在当前浏览器建立会话时，打开 DSH 打印的 tokenized startup URL；
3. 在 DSH 中选择或创建 Session；
4. 点击当前 Session 的 `Report Studio` 视图；
5. 模型、推理等级和普通对话继续由 DSH 原生界面管理；
6. Studio 负责内容编辑、批注、排版、检查、保存与交付。

`/report-studio/?sessionId=...` 是内部 iframe / 备用独立窗口地址，不是用户正式入口。

## 8. Session 与网络安全边界

当前插件继续采用 `securityMode=local-single-user-only`：

- DSH Web 必须监听 `127.0.0.1`；
- `0.0.0.0` 会被插件拒绝；
- query `sessionId` 只是本机路由键，不是认证令牌；
- DSH 浏览器会话 Cookie 是 Host API 认证的一部分；
- Agent 工具 Session 身份来自 DSH 执行上下文，不来自浏览器传入值；
- 不声明多人或网络共享安全。

## 9. Workspace Live Link

Report Studio 只从当前 DSH Session 的 `SessionHeader.cwd` 解析 Workspace。`studio_open_workspace_project` 检查 `project.json` 并执行 Presentation Standard Project Directory `0.1.0` 全量验证。

需要主动重扫时使用 `studio_reload_upstream`。Live Link 默认 `750 ms` 防抖；连续 change、Windows rename 或目录替换都会完整重扫。无效中间态不会替换当前合法快照。已保存本地内容与上游基线冲突时进入 `local_saved_conflict`，没有用户明确放弃不得覆盖。`layouts/` 归 Presentation 管理。

```bash
npm run verify:workspace
```

通过标志：

```text
PRESENTATION_WORKSPACE_LIVE_LINK_PASS
```

## 10. Report Studio A1.1 数据迁移

兼容数据根继续使用：

```text
$DSH_HOME/report-studio-v0.1.0/
```

这是为了识别旧 Studio `state.json`，与 DSH Session V3 版本号无关。检测到旧数据时，界面保持只读；用户明确执行“备份并升级”后才进行逐字节备份、稳定 ID 映射、对象校验和 `control.json` 原子切换。

```text
state.json
backups/<timestamp>/state.v0.1.0.json
migration-map.json
control.json
objects/sha256/*.json
```

同一 Studio 数据目录只允许一个 DSH/Node 写进程。

## 11. 隔离批注 worker

批注默认由插件内 `dsh-local-worker` 执行：只接收冻结的 ReviewSubmission 上下文和受控工具，不复制主会话历史。

模型继承顺序：

```text
当前 Session
→ sessionProjections.modelSelection.next
→ agentDefaultModel.currentSelection()
→ DSH llm
```

修改经过 CAS/Revision 网关直接应用，不等待 Proposal 二次确认。`proposals` / `proposalId` 仅作为兼容记录字段。

如果 DSH `llm` 或当前 Session 模型解析能力缺失，隔离 worker 必须失败关闭，而不是偷偷把批注退回父 Session Agent。

## 12. 部署前验证清单

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

最终至少应满足：

- `dsh --version = 0.1.5-rc.1`；
- `verify:all` 全绿；
- Linux 与 Windows Runtime CI 全绿；
- DSH Web 正常启动，无 `waiting for service: apiProxy`；
- token → browser-session Cookie 交换成功；
- DSH Web Client 能加载 Report Studio client bundle；
- Session 创建/恢复正常；
- `Report Studio` view/header action 正常；
- 当前 Session 的 `SessionHeader.cwd` 能打开 Workspace；
- `studio_reload_upstream` 正常；
- 普通聊天 `session.prompt(..., 'queue')` 正常；
- 隔离批注 worker 能继承当前模型并完成一次直接修改；
- 大纲、草案、批注、Layout、OpenPencil、导出与重启恢复通过；
- `/report-studio/api/health` 保持 `securityMode=local-single-user-only` 与 `listenHost=127.0.0.1`；
- Pre-design 与用户原有 DSH 插件仍存在。

## 13. 回滚

### 仅回滚 Report Studio

停止 DSH，移除当前插件，恢复插件升级前的 `profiles/web` 与 Report Studio 数据备份，再启动 DSH。不要删除 `$DSH_HOME/report-studio-v0.1.0/`。

### 回滚 DSH 0.1.5 / Session V3

1. 停止所有 DSH 进程；
2. 保存当前故障现场副本；
3. 恢复**首次启动 0.1.5 前**的完整 `DSH_HOME` 冷备份；
4. 再安装需要回退的 DSH 包版本；
5. 启动并验证 Session/Profile。

不要只执行 npm 降级后继续使用已经迁移的 V3 Session 目录。

## 14. 卸载

```bash
dsh plugin --profile web remove @architectureworld/report-studio-dsh
```

卸载插件不授权删除任何 DSH Session、Report Studio 数据、Workspace 或交付文件。
