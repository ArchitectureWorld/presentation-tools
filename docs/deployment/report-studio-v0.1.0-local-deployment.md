# Report Studio v0.1.0 安装与部署说明

当前正式部署方式是 `@architectureworld/report-studio-dsh@0.1.0` DSH 原生插件。测试基线：DSH `0.1.1-rc.2`，Profile `web`。

## 获取代码

```bash
git clone https://github.com/ArchitectureWorld/presentation-tools.git
cd presentation-tools
git fetch --all --prune
git checkout integration/report-studio-mvp-v0.1.0
git pull --ff-only
test -f packages/studio-dsh-plugin/package.json
```

如果只看到 `packages/studio-core`，说明仍在旧提交或错误分支。

## 安装

```bash
node --version
dsh --version
corepack enable
dsh plugin --profile web add ./packages/studio-dsh-plugin
dsh --profile web --dump-config
dsh --profile web --no-open
```

进入 DSH Session 后，会话视图和会话头部均出现 `Report Studio` 入口。

## Agent 工作流

```text
ReviewSubmission
→ 当前 DSH Session session.prompt
→ studio_get_context
→ studio_apply_commands
→ Proposal
→ 用户确认
→ Revision
```

正式模式不需要 `REPORT_STUDIO_AGENT_URL`，也不启动第二套 Agent Runtime。

## 数据

```text
$DSH_HOME/report-studio-v0.1.0/sessions/<session-id-sha256>/state.json
```

## 验证

```bash
npm run verify:all
npm run smoke:dsh
```

`smoke:dsh` 使用临时 DSH Home 真实验证本地插件安装、Profile 组合、DSH Web 启动、原生健康检查和正式 UI 资源。

更完整的逐步说明见仓库根目录 `DSH_INSTALL.md`。
