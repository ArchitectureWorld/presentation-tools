# `@architectureworld/report-studio-dsh` v0.1.1

Report Studio 的 DSH 原生自包含发布包。它包含 Studio Runtime、浏览器 UI、Presentation Standard Project Adapter 与 Contract 校验运行文件，并在 DSH Web Profile 中注册：

- `Report Studio` 会话视图，以及明确标注为独立窗口的会话头部备用动作；
- `/report-studio` 同源 UI/API 路由；
- `studio_get_context`；
- `studio_apply_commands`；
- 当前 DSH Session 的 `session.prompt(..., 'queue')` 通路。

## 安装

```bash
dsh plugin --profile web add ./architectureworld-report-studio-dsh-0.1.1.tgz
dsh --profile web --dump-config
dsh --profile web --no-open
```

经过验证的运行基线为 Node.js 22+、DSH `0.1.1-rc.2`、Profile `web`。正式模式不需要 `npm start`、`REPORT_STUDIO_AGENT_URL` 或外部 HTTP Bridge。

正式入口是 `http://127.0.0.1:3080/`。先选择或创建 DSH Session，再点击 `Report Studio` 标签；模型、推理等级与消息输入始终使用 DSH 原生控制栏。`/report-studio/?sessionId=...` 是 iframe/独立工作台内部地址，不得作为安装后的默认入口。

数据目录沿用 `report-studio-v0.1.0` 兼容名称，以发现旧 Session 的 `state.json`；检测到旧数据后必须由用户在 UI 中确认 A1.1 备份迁移。
