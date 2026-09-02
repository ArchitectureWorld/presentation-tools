# Report Studio v0.1.0 — DSH 原生安装

本文件是交给本地部署 Agent 的首要入口。目标是把 Report Studio 安装到 DSH Web Profile，而不是启动独立网页后再配置外部 HTTP Bridge。

## 固定基线

```text
Repository: ArchitectureWorld/presentation-tools
Branch: integration/report-studio-mvp-v0.1.0
Report Studio: v0.1.0
Tested DSH: 0.1.1-rc.2
Profile: web
Plugin: @architectureworld/report-studio-dsh
```

不得从 `main` 部署当前版本；`main` 仍可能落后于本支线。

## 获取并核对代码

```bash
git clone https://github.com/ArchitectureWorld/presentation-tools.git
cd presentation-tools
git fetch --all --prune
git checkout integration/report-studio-mvp-v0.1.0
git pull --ff-only
git branch --show-current
git log -1 --oneline
node -p "require('./package.json').version"
```

必须存在 `packages/studio-dsh-plugin/`。如果目录不存在，说明使用了旧提交或错误分支。

## 环境

```bash
node --version
dsh --version
```

要求 Node.js 22+；当前真实验收 DSH 基线为 `0.1.1-rc.2`。缺少 DSH 时：

```bash
npm install --global @deepseek-ai/dsh@0.1.1-rc.2
```

## 安装和启动

```bash
corepack enable
dsh plugin --profile web add ./packages/studio-dsh-plugin
dsh --profile web --dump-config
dsh --profile web --no-open
```

dump-config 输出必须包含 `@architectureworld/report-studio-dsh`。进入 DSH Session 后，可从 `Report Studio` 会话视图或会话头部入口打开工作台。

## 原生链路

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

正式 DSH 模式不使用 `REPORT_STUDIO_AGENT_URL`、独立 4173 服务、第二套模型 Runtime 或 Mock Agent。

## 数据

```text
$DSH_HOME/report-studio-v0.1.0/sessions/<session-id-sha256>/state.json
```

未设置 `DSH_HOME` 时使用 `~/.dsh/report-studio-v0.1.0/`。

## 验证

```bash
npm run verify:all
npm run smoke:dsh
```

`smoke:dsh` 使用临时 DSH_HOME，真实完成插件安装、Web Profile 组合、DSH 启动和 `/report-studio` 健康检查。

## 更新

```bash
git checkout integration/report-studio-mvp-v0.1.0
git pull --ff-only
dsh plugin --profile web remove @architectureworld/report-studio-dsh
dsh plugin --profile web add ./packages/studio-dsh-plugin
dsh --profile web --dump-config
dsh --profile web --no-open
```

## 卸载

```bash
dsh plugin --profile web remove @architectureworld/report-studio-dsh
```
