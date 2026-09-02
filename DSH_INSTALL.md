# Report Studio v0.1.0 — DSH 原生安装与更新

本文件是本地部署 Agent 的首要入口。目标是把 Report Studio 安装到 DSH Web Profile，并绑定当前 DSH Session；正式模式不再依赖独立的 `4173` 服务或外部 HTTP Bridge。

## 固定基线

```text
Repository: ArchitectureWorld/presentation-tools
Pull Request: #3
Release branch: integration/report-studio-mvp-v0.1.0
Report Studio: v0.1.0
Tested DSH: 0.1.1-rc.2
Profile: web
Plugin: @architectureworld/report-studio-dsh
```

PR #3 合并前从上述支线部署；合并后优先从 `main` 部署，但仍须确认 `packages/studio-dsh-plugin/` 存在且版本为 `0.1.0`。

## 1. 环境与代码核对

要求 Node.js 22+、DSH `0.1.1-rc.2`：

```bash
node --version
dsh --version
```

缺少 DSH 时：

```bash
npm install --global @deepseek-ai/dsh@0.1.1-rc.2
```

PR #3 合并前获取支线：

```bash
git fetch --all --prune
git checkout integration/report-studio-mvp-v0.1.0
git pull --ff-only
git branch --show-current
git log -1 --oneline
node -p "require('./package.json').version"
```

插件已经自包含运行代码。不要在 `packages/studio-dsh-plugin/` 内额外执行 `npm install`，也不要把本地 `node_modules` 或 `state.json` 提交进仓库。

## 2. 更新前备份

保留现有业务数据，并备份 DSH Web Profile 的关键配置。Windows PowerShell 示例：

```powershell
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$profile = "$env:USERPROFILE\.dsh\profiles\web"
$backup = "$env:USERPROFILE\.dsh\backups\report-studio-pre-$stamp"
New-Item -ItemType Directory -Path $backup -Force

@('package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'cordis.yml', 'cordis.patch.yml') |
  ForEach-Object {
    $source = Join-Path $profile $_
    if (Test-Path -LiteralPath $source) {
      Copy-Item -LiteralPath $source -Destination (Join-Path $backup $_)
    }
  }
```

如果旧版独立服务使用了单独的 `state.json`，先对原文件和备份执行 `Get-FileHash -Algorithm SHA256`，确认哈希一致后再继续。

## 3. 安装到 DSH Web Profile

先停止正在运行的 DSH Web，避免旧进程继续缓存安装前的插件代码。然后在仓库根目录执行：

```bash
dsh plugin --profile web remove @architectureworld/report-studio-dsh
dsh plugin --profile web add ./packages/studio-dsh-plugin
dsh --profile web --dump-config
dsh --profile web --no-open
```

首次安装时，如果 `remove` 提示插件不存在，可以直接继续 `add`。`dump-config` 必须同时保留已有插件，并包含：

```text
@architectureworld/report-studio-dsh
```

本机若同时安装了前期策划插件，还必须继续看到：

```text
@architectureworld/dsh-preplanning-agent
```

DSH Web 默认地址为 `http://127.0.0.1:3080/`。进入任一 DSH Session 后，应在会话头部和会话标签中看到 `Report Studio` 入口。

## 4. 旧版数据迁移到当前 Session

DSH 原生模式按 Session 隔离数据：

```text
$DSH_HOME/report-studio-v0.1.0/sessions/<session-id-sha256>/state.json
```

未设置 `DSH_HOME` 时使用 `~/.dsh/report-studio-v0.1.0/`。旧独立服务的数据不会自动进入 DSH Session，需要一次性迁移：

1. 在 DSH 中打开目标 Session 的 Report Studio。
2. 从内嵌页地址取得 `sessionId`。
3. 停止 DSH Web。
4. 备份该 Session 自动生成的空 `state.json`。
5. 把旧版 `state.json` 复制到该 Session 目录，并核对 SHA-256。
6. 重启 DSH，确认 Revision、草案页、批注和评审提交均恢复。

Windows PowerShell 可用以下方式计算目录名：

```powershell
$sessionId = '替换为实际 sessionId'
$bytes = [System.Text.Encoding]::UTF8.GetBytes($sessionId)
$hash = [System.Security.Cryptography.SHA256]::HashData($bytes)
$directoryName = [System.Convert]::ToHexString($hash).ToLowerInvariant().Substring(0, 32)
$dshRoot = if ($env:DSH_HOME) { $env:DSH_HOME } else { "$env:USERPROFILE\.dsh" }
$sessionState = Join-Path $dshRoot "report-studio-v0.1.0\sessions\$directoryName\state.json"
$sessionState
```

不要删除旧数据；迁移前后的源文件、目标文件和备份都要保留到验收完成。

## 5. 验证

Windows PowerShell：

```powershell
$env:CHROMIUM_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
npm run verify:all
npm run smoke:dsh
```

Linux/macOS：

```bash
npm run verify:all
npm run smoke:dsh
```

`smoke:dsh` 使用临时 DSH_HOME，真实完成插件安装、Web Profile 组合、DSH 启动以及 `/report-studio` 页面和健康接口检查。

最终验收至少包括：

- `npm run verify:all` 和 `npm run smoke:dsh` 均通过；
- 正式 DSH Profile 能加载 Report Studio，原有插件没有消失；
- `/report-studio/api/health` 返回 `agentMode=dsh-native`、`agentConfigured=true`；
- 当前 Session 能打开工作台，重启 DSH 后数据仍可恢复；
- `studio_get_context`、`studio_apply_commands` 已注册；
- 正式运行时没有独立 `4173` 服务，也没有 `REPORT_STUDIO_AGENT_URL`。

## 6. 原生链路

```text
Report Studio UI
→ 同源 /report-studio API
→ 当前 DSH Session
→ session.prompt(..., 'queue')
→ DSH Agent
→ studio_get_context
→ studio_apply_commands
→ Proposal
→ 用户确认
→ Revision
```

## 7. 卸载

```bash
dsh plugin --profile web remove @architectureworld/report-studio-dsh
```

卸载插件不会授权删除 `$DSH_HOME/report-studio-v0.1.0/` 下的数据；如需清理数据，必须另行确认。
