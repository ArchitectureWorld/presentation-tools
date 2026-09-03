# Presentation Tools — Report Studio v0.1.1

Report Studio `v0.1.1` 是可部署的“大纲 + 草案”工作台：支持 A1.1 旧数据无损升级、Revision CAS、批注评审、DSH 原生 Proposal 流程，以及 Presentation Standard Project Directory `0.1.0` 的导入/导出。正式排版、分页和 PPTX/PDF/HTML 成品导出属于 `v0.2.0`，当前界面会明确显示为未开放能力。

## 产品边界

```text
标准项目目录 0.1.0  ←→  Studio Adapter  ←→  Canonical Revision
                                              ├─ 大纲 / 草案 / 素材
                                              └─ DSH Submission / Proposal（运行态）
```

标准目录只承载可交换的项目内容；批注、Submission、Proposal、DSH Session、Head/CAS 和界面状态不会写入标准目录。这样既保持结构文件中立，也让当前 UI、产品架构和底层存储使用同一条受控数据链。

## 部署基线

```text
Branch: main
Report Studio: 0.1.1
DSH plugin: @architectureworld/report-studio-dsh@0.1.1
Tested DSH: 0.1.1-rc.2
Profile: web
Node.js: 22+
```

## 安装

```bash
git clone https://github.com/ArchitectureWorld/presentation-tools.git
cd presentation-tools
git checkout main
git pull --ff-only
npm ci --prefix contracts/presentation-standard-project --ignore-scripts --no-audit --no-fund
npm run verify:all
dsh plugin --profile web add ./packages/studio-dsh-plugin
dsh --profile web --dump-config
dsh --profile web --no-open
```

进入 DSH Session 后，从会话视图或会话头部打开 `Report Studio`。完整备份、升级和回滚说明见 [DSH_INSTALL.md](DSH_INSTALL.md)。

## A1.1 旧数据升级

检测到旧 `state.json` 时，工作台保持只读并显示“备份并升级”。只有用户确认后才会：

1. 逐字节备份旧文件；
2. 生成并持久化稳定 ID 映射；
3. 校验候选对象和引用；
4. 原子发布新 `control.json`。

旧 `state.json` 不会被覆盖或删除；失败时不会切换 Head，可使用同一映射重试。

## DSH 原生能力

```text
/report-studio              DSH 同源 UI/API 路由
conversation.view           Report Studio 会话视图
session.header.actions      Report Studio 入口
studio_get_context          按 Submission 冻结 Revision 读取上下文
studio_apply_commands       幂等生成待确认 Proposal
```

正式模式不需要 `REPORT_STUDIO_AGENT_URL`，也不会启动第二套 Agent Runtime。

## 验证

```bash
npm run verify:all
npm run smoke:dsh
```

`verify:all` 覆盖单元/集成测试、Contract、迁移、并发 CAS、E2E、6 个浏览器视口和 DSH 静态集成；`smoke:dsh` 使用隔离的 DSH Home 安装插件、启动 Web Profile 并检查正式路由。真实模型生成质量仍需在实际 DSH 账号/模型环境中验收。

## 独立调试

```bash
npm start
```

独立服务默认监听 `127.0.0.1:4173`，正式使用仍以 DSH 原生插件为准。同一数据目录只允许一个 Node.js 进程写入。

<!-- PRESENTATION_STANDARD_PROJECT_V0_1_0_START -->

## Presentation 标准项目格式 0.1.0

中立 Contract 位于 [`contracts/presentation-standard-project`](contracts/presentation-standard-project)。它定义版本、稳定 ID、引用、目录和文件校验，不承担 Agent、审批、Revision、同步或调用方恢复职责。

```bash
npm ci --prefix contracts/presentation-standard-project --ignore-scripts --no-audit --no-fund
npm run verify:contracts
```

<!-- PRESENTATION_STANDARD_PROJECT_V0_1_0_END -->
