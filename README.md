# Presentation Tools — Report Studio v0.1.0

Report Studio `v0.1.0` 当前正式范围是大纲、草案、批注、DSH 原生 Agent、Proposal/Revision 与持久化。正式排版进入 `v0.2.0`。

## 当前部署基线

```text
Branch: main
DSH plugin: @architectureworld/report-studio-dsh@0.1.0
Tested DSH: 0.1.1-rc.2
Profile: web
```

当前正式部署来源为 `main`。

## DSH 原生安装

```bash
git clone https://github.com/ArchitectureWorld/presentation-tools.git
cd presentation-tools
git checkout main
git pull --ff-only
corepack enable
dsh plugin --profile web add ./packages/studio-dsh-plugin
dsh --profile web --dump-config
dsh --profile web --no-open
```

进入 DSH Session 后，选择 `Report Studio` 会话视图，或点击会话头部的 `Report Studio` 入口。

完整部署说明：[`DSH_INSTALL.md`](DSH_INSTALL.md)。

## 原生 DSH 能力

```text
/report-studio              DSH 同源 UI/API 路由
conversation.view           Report Studio 会话视图
session.header.actions      Report Studio 入口
studio_get_context          受控项目上下文
studio_apply_commands       生成待确认 Proposal
```

项目 Agent 和批注提交通过当前 DSH Session 的 `session.prompt(..., 'queue')` 进入 Harness。正式 DSH 模式不需要 `REPORT_STUDIO_AGENT_URL`。

## 完整验证

```bash
npm run verify:all
npm run smoke:dsh
```

`smoke:dsh` 会用临时 DSH Home 真实安装插件、启动 Web Profile 并检查原生路由。

## 独立调试模式

`npm start` 仍可用于独立调试；正式使用以 DSH 原生插件为准。

<!-- PRESENTATION_STANDARD_PROJECT_V0_1_0_START -->

## Presentation 标准项目格式 0.1.0

标准项目文件 Contract 位于 [`contracts/presentation-standard-project`](contracts/presentation-standard-project)，供 `pre-design` 等上游 DSH 插件以精确版本创建、填写和验证中立项目目录。该 Contract 不承担 Agent、审批、Revision、同步或调用方恢复职责。

```bash
npm ci --prefix contracts/presentation-standard-project --ignore-scripts --no-audit --no-fund
npm run verify --prefix contracts/presentation-standard-project
```

<!-- PRESENTATION_STANDARD_PROJECT_V0_1_0_END -->
