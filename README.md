# Presentation Tools — Report Studio v0.1.0

Report Studio `v0.1.0` 是可直接本地部署使用的 **大纲 + 草案** 第一阶段版本。正式排版画布延期至 `v0.2.0`。

## 当前可用能力

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

当前通用平台不依赖 `pre-design`。

## 视觉与窗口适配

正式本地界面已经回归 `tools/report-studio/prototype/` 的深色、紫色强调和统一工作台结构，包括：

- 项目品牌区与居中的阶段导航；
- 草案阶段的全局页面导航；
- 主工作区与固定右侧批注区；
- 批注筛选、轮次、提交和固定输入区；
- 金色项目 Agent 悬浮入口与大尺寸会话窗口。

界面不是固定的 `1600×900` 画布。它使用弹性网格、`clamp()`、`100dvh` 和响应式断点自动适配窗口；`1600×900` 只是自动回归的一个样本尺寸。

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

**无需 `npm install`。** 正式本地程序运行时零第三方 npm 依赖。

## 完整验证

```bash
npm run verify:all
```

等价于：

```bash
npm test
npm run verify
npm run verify:ui
```

`verify:ui` 使用真实 Chromium/Chrome 验证六个窗口样本：

```text
720×900
820×900
1024×768
1366×768
1600×900
1920×1080
```

覆盖窗口自适应、无水平溢出、大纲/草案切换、页面导航、项目 Agent 打开与关闭、未配置 DSH Bridge 的状态文案及浏览器控制台错误。

## 数据

默认保存于：

```text
<repo>/.report-studio-data/state.json
```

可通过 `REPORT_STUDIO_DATA_DIR` 指定其他目录。浏览器 `localStorage` 不是业务事实源。

## Agent / DSH

Report Studio 不内置第二套模型 Runtime。通过环境变量连接外部 DSH-compatible Bridge：

```bash
REPORT_STUDIO_AGENT_URL=http://127.0.0.1:5050/report-studio npm start
```

未配置 Bridge 时，大纲、草案、批注、ReviewRound、Revision 和持久化仍可完整人工使用；项目 Agent 会明确显示：

```text
DSH Bridge 未配置 · 可正常人工编辑
```

Bridge 返回结构化 `commands` 后，系统先形成 Proposal，用户确认后才创建正式 Revision。

## 权威文件

1. [`docs/architecture/report-studio-mvp-baseline-v0.1.0.md`](docs/architecture/report-studio-mvp-baseline-v0.1.0.md)
2. [`docs/deployment/report-studio-v0.1.0-local-deployment.md`](docs/deployment/report-studio-v0.1.0-local-deployment.md)
3. [`docs/handoff/2026-09-02-report-studio-v0.1.0-runnable-handoff.md`](docs/handoff/2026-09-02-report-studio-v0.1.0-runnable-handoff.md)
4. [`docs/review/report-studio-ui-architecture-integration-review-v0.1.0.md`](docs/review/report-studio-ui-architecture-integration-review-v0.1.0.md)

历史 UI 原型保留在 `tools/report-studio/`，用于视觉与交互回归；正式数据、Revision 和 Agent 接入仍由 `apps/studio-local/` 与 `packages/studio-core/` 承担。
