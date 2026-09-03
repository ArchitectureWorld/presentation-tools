# Report Studio v0.1.1 — DSH 原生安装、升级与回滚

本文件是部署入口。正式产品运行在 DSH Web Profile 内，绑定当前 DSH Session；不需要独立 `4173` 服务，也不依赖 `REPORT_STUDIO_AGENT_URL`。

## 固定基线

```text
Repository: ArchitectureWorld/presentation-tools
Branch: main
Report Studio: 0.1.1
Plugin: @architectureworld/report-studio-dsh@0.1.1
Tested DSH: 0.1.1-rc.2
Profile: web
Node.js: 22+
```

## 1. 获取并验证发布代码

```bash
git clone https://github.com/ArchitectureWorld/presentation-tools.git
cd presentation-tools
git checkout main
git pull --ff-only
node --version
dsh --version
npm ci --prefix contracts/presentation-standard-project --ignore-scripts --no-audit --no-fund
npm run verify:all
```

缺少 DSH 时：

```bash
npm install --global @deepseek-ai/dsh@0.1.1-rc.2
```

## 2. 更新前备份

停止正在运行的 DSH Web。备份 Web Profile 配置和 Report Studio 数据根；不要删除旧数据。

```powershell
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$dshRoot = if ($env:DSH_HOME) { $env:DSH_HOME } else { "$env:USERPROFILE\.dsh" }
$profile = Join-Path $dshRoot 'profiles\web'
$dataRoot = Join-Path $dshRoot 'report-studio-v0.1.0'
$backup = Join-Path $dshRoot "backups\report-studio-v0.1.1-pre-$stamp"
New-Item -ItemType Directory -Path $backup -Force | Out-Null

if (Test-Path -LiteralPath $profile) {
  Copy-Item -LiteralPath $profile -Destination (Join-Path $backup 'web-profile') -Recurse
}
if (Test-Path -LiteralPath $dataRoot) {
  Copy-Item -LiteralPath $dataRoot -Destination (Join-Path $backup 'report-studio-data') -Recurse
}
Get-ChildItem -LiteralPath $backup -Recurse -File | Get-FileHash -Algorithm SHA256 |
  Export-Csv -LiteralPath (Join-Path $backup 'sha256.csv') -NoTypeInformation -Encoding UTF8
```

`report-studio-v0.1.0` 是为无损识别旧 Session 数据而保留的兼容数据根名称；插件和数据结构版本已经是 `0.1.1`。

## 3. 安装或更新插件

在仓库根目录执行：

```bash
dsh plugin --profile web remove @architectureworld/report-studio-dsh
dsh plugin --profile web add ./packages/studio-dsh-plugin
dsh --profile web --dump-config
dsh --profile web --no-open
```

首次安装时，`remove` 提示插件不存在可以继续。`dump-config` 必须包含 `@architectureworld/report-studio-dsh`，并继续保留用户原有插件。不要在 `packages/studio-dsh-plugin/` 内额外执行 `npm install`。

DSH Web 默认地址为 `http://127.0.0.1:3080/`。进入任一 Session 后，应在会话标签和会话头部看到 `Report Studio`。

## 4. A1.1 旧数据无损升级

每个 Session 的兼容数据目录是：

```text
$DSH_HOME/report-studio-v0.1.0/sessions/<session-id-sha256>/
```

如果旧数据来自独立服务，先停止 DSH，把原始 `state.json` 复制到目标 Session 目录；不要覆盖已有业务文件，复制前后核对 SHA-256。目录名计算方式：

```powershell
$sessionId = '替换为实际 sessionId'
$bytes = [System.Text.Encoding]::UTF8.GetBytes($sessionId)
$hash = [System.Security.Cryptography.SHA256]::HashData($bytes)
$directoryName = [System.Convert]::ToHexString($hash).ToLowerInvariant().Substring(0, 32)
$dshRoot = if ($env:DSH_HOME) { $env:DSH_HOME } else { "$env:USERPROFILE\.dsh" }
$sessionDir = Join-Path $dshRoot "report-studio-v0.1.0\sessions\$directoryName"
New-Item -ItemType Directory -Path $sessionDir -Force | Out-Null
$sessionDir
```

再次启动 DSH 并打开 Report Studio。检测到旧 `state.json` 后，界面保持只读。点击“备份并升级”才会执行：逐字节备份、稳定 ID 映射、对象校验和 `control.json` 原子切换。完成后应看到 Revision 和编辑功能恢复。

升级生成：

```text
state.json                         原文件，保持不变
backups/<timestamp>/state.v0.1.0.json
migration-map.json
control.json
objects/sha256/*.json
```

同一 Session 数据目录只允许一个 Node.js/DSH 进程写入；第二个写入进程会被拒绝。

## 5. 验证

```bash
npm run verify:all
npm run smoke:dsh
```

正式环境至少验收：

- `/report-studio/api/health` 返回 `version=v0.1.1`、`agentMode=dsh-native`、`agentConfigured=true`；
- 迁移前旧 `state.json` 与备份 SHA-256 一致；
- 大纲、草案、批注、Submission、Proposal 接受和重启恢复可用；
- 标准项目导出通过 Contract `0.1.0`；
- `studio_get_context` 和 `studio_apply_commands` 已注册；
- 原有 DSH 插件仍在，且没有独立 `4173` 服务。

自动化验证不等同于真实模型质量验收；模型是否能按业务意图生成满意建议，需要在目标账号、目标模型和真实项目资料中另行确认。

## 6. 回滚

如果插件启动失败：停止 DSH，移除 `0.1.1` 插件，恢复第 2 步备份的 Web Profile，再启动 DSH。不要删除数据目录。

如果已完成 A1.1 数据升级但需要回退：停止 DSH，把 `control.json`、`objects/` 和 `migration-map.json` 移入带时间戳的隔离目录，保留原 `state.json` 和 `backups/`，再恢复旧插件。不要在 DSH 运行时移动这些文件。

## 7. 卸载

```bash
dsh plugin --profile web remove @architectureworld/report-studio-dsh
```

卸载插件不授权删除 `$DSH_HOME/report-studio-v0.1.0/` 下的数据。
