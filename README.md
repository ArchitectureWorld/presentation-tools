# Presentation Tools — Report Studio v0.1.0

当前版本：**Report Studio v0.1.0**。

## 当前可直接使用

v0.1.0 第一阶段已经实现并可本地部署：

```text
大纲编辑
→ 大纲节点生成草案页
→ 草案标题 / 正文 / 要点 / 讲解稿
→ 本页图片素材
→ 批注自动保存
→ 同一 ReviewRound 多次 ReviewSubmission
→ 可选 DSH Bridge
→ Proposal 确认应用
→ Revision
→ 关闭 / 重启恢复
```

正式排版阶段延期到 **v0.2.0**，当前只保留 UI 入口。

当前通用平台不依赖 `pre-design`。

## 直接启动

要求：Node.js 22+。

```bash
git clone https://github.com/ArchitectureWorld/presentation-tools.git
cd presentation-tools
git checkout integration/report-studio-mvp-v0.1.0
npm start
```

浏览器打开：

```text
http://127.0.0.1:4173
```

**无需 `npm install`。** v0.1.0 正式本地程序运行时零第三方 npm 依赖。

## 验证

```bash
npm test
npm run verify
```

当前离线验证结果：

```text
13 automated tests PASS
Report Studio v0.1.0 verification PASS
```

## 数据

默认保存在：

```text
<repo>/.report-studio-data/state.json
```

可通过 `REPORT_STUDIO_DATA_DIR` 指定其他目录。正式项目数据不以浏览器 `localStorage` 为事实源。

## Agent / DSH

Report Studio 不内置第二套模型 Runtime。通过环境变量连接外部 DSH-compatible Bridge：

```bash
REPORT_STUDIO_AGENT_URL=http://127.0.0.1:5050/report-studio npm start
```

未配置 Bridge 时，大纲、草案、批注、ReviewRound、Revision 和持久化仍可完整人工使用；界面不会伪造 Mock Agent 回复。

Bridge 返回结构化 `commands` 时，系统先生成 Proposal，用户点击 `确认应用` 后才形成正式 Revision。

详细合同与本地部署方法见：

- [`docs/deployment/report-studio-v0.1.0-local-deployment.md`](docs/deployment/report-studio-v0.1.0-local-deployment.md)

## 当前权威文件

1. [`docs/architecture/report-studio-mvp-baseline-v0.1.0.md`](docs/architecture/report-studio-mvp-baseline-v0.1.0.md)
2. [`docs/deployment/report-studio-v0.1.0-local-deployment.md`](docs/deployment/report-studio-v0.1.0-local-deployment.md)
3. [`docs/handoff/2026-09-02-report-studio-mvp-v0.1.0-handoff.md`](docs/handoff/2026-09-02-report-studio-mvp-v0.1.0-handoff.md)
4. [`docs/review/report-studio-ui-architecture-integration-review-v0.1.0.md`](docs/review/report-studio-ui-architecture-integration-review-v0.1.0.md)

历史 UI 原型 `v0.8.1` 位于 `tools/report-studio/`，仅用于视觉/交互回归，不再是正式业务核心。

## 当前正式代码

```text
apps/studio-local/
├─ server.mjs
├─ repository.mjs
├─ agent-bridge.mjs
└─ public/
   ├─ index.html
   ├─ app.js
   └─ styles.css

packages/studio-core/
├─ index.mjs
└─ index.test.mjs

scripts/verify-v0.1.0.mjs
package.json
```
