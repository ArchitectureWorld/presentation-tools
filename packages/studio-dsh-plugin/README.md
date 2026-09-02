# `@architectureworld/report-studio-dsh` v0.1.0

Report Studio 的 DSH 原生组合包。它在 DSH Web Profile 中注册：

- `Report Studio` 会话视图；
- 会话头部 `Report Studio` 入口；
- `/report-studio` 同源 UI/API 路由；
- `studio_get_context`；
- `studio_apply_commands`；
- 当前 DSH Session 的原生 `session.prompt(..., 'queue')` 通路。

## 安装

在仓库根目录执行：

```bash
dsh plugin --profile web add ./packages/studio-dsh-plugin
dsh --profile web --dump-config
dsh --profile web --no-open
```

经过验证的 DSH 基线：`0.1.1-rc.2`。

正式 DSH 模式不需要 `npm start`、`REPORT_STUDIO_AGENT_URL` 或外部 HTTP Bridge。

完整说明见仓库根目录 [`DSH_INSTALL.md`](../../DSH_INSTALL.md)。
