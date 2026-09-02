# Report Studio v0.1.0 DSH 原生可运行版 Handoff

```text
Repository: ArchitectureWorld/presentation-tools
Branch: integration/report-studio-mvp-v0.1.0
Version: v0.1.0
Status: dsh-native-runnable-outline-draft-mvp
DSH baseline: 0.1.1-rc.2
DSH profile: web
Layout: deferred-to-v0.2.0
```

已实现响应式原型保真工作台、Outline/Draft/Review/Proposal/Revision、Session 项目隔离持久化、DSH Host/Client 原生插件、`conversation.view`、会话头部入口、`session.prompt(..., 'queue')`、`studio_get_context`、`studio_apply_commands`，以及真实 DSH 安装和启动烟测。

正式安装入口：`DSH_INSTALL.md`。

```bash
corepack enable
dsh plugin --profile web add ./packages/studio-dsh-plugin
dsh --profile web --dump-config
dsh --profile web --no-open
```

正式 DSH 模式不依赖 `REPORT_STUDIO_AGENT_URL` 或独立 4173 服务。

验证：

```bash
npm run verify:all
npm run smoke:dsh
```

`v0.2.0` 再开发正式排版画布，本轮不改变该边界。
