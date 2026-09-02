# Report Studio v0.1.0 可运行版 Handoff

## 当前状态

```text
Repository: ArchitectureWorld/presentation-tools
Branch: integration/report-studio-mvp-v0.1.0
Version: v0.1.0
Status: runnable-outline-draft-mvp
UI: responsive-prototype-parity
Layout: deferred-to-v0.2.0
```

## 直接启动

Node.js 22+，仓库根目录：

```bash
npm start
```

访问：`http://127.0.0.1:4173`。无需 `npm install`。

## 当前实施结论

- 正式前端必须以 `tools/report-studio/prototype/` 为视觉和交互基线；
- 不再使用此前重新设计的白色管理后台风格；
- `1600×900` 只是回归尺寸之一，生产界面自动适配窗口；
- 后端、Repository、Revision、ReviewRound、ReviewSubmission、Proposal 和 DSH Bridge 语义保持不变；
- `v0.1.0` 优先完成可直接使用的大纲与草案，排版仍属于 `v0.2.0`。

## 已实现

- 深色、紫色强调的原型同源工作台；
- 响应式项目顶栏、居中阶段导航和全局页面导航；
- 自适应主工作区和固定批注面板；
- 批注全部/未完成/已完成筛选；
- 固定批注输入区、ReviewRound、ReviewSubmission 和 Proposal 展示；
- 金色项目 Agent 悬浮入口、上下文和大尺寸会话窗口；
- 大纲新增一级/子级、改名、同层排序和删除；
- 稳定 Outline ID 及大纲节点生成草案页；
- 草案标题、正文、要点、讲解稿和本页图片素材；
- 批注自动保存，生命周期与完成状态分离；
- 同一 ReviewRound 多个不可变 ReviewSubmission；
- 内容 Revision、stale revision 保护；
- 服务器端 JSON 持久化与重启恢复；
- 可选外部 DSH-compatible Bridge；
- Agent commands 先形成 Proposal，用户确认后才进入正式 Revision。

## 响应式验收

完整命令：

```bash
npm run verify:all
```

其中 `npm run verify:ui` 使用真实 Chromium/Chrome 检查：

```text
720×900
820×900
1024×768
1366×768
1600×900
1920×1080
```

必须满足：无水平溢出、大纲/草案可切换、页面条正常、项目 Agent 可打开/关闭、状态文案正确、控制台无错误。所有尺寸只是样本，不是固定画布定义。

## Agent / DSH

配置：

```text
REPORT_STUDIO_AGENT_URL
REPORT_STUDIO_AGENT_TIMEOUT_MS
```

未配置 Bridge 时人工工作流仍完整可用，不产生 Mock Agent 假回复，并显示：

```text
DSH Bridge 未配置 · 可正常人工编辑
```

## 正式数据

默认：

```text
.report-studio-data/state.json
```

可通过 `REPORT_STUDIO_DATA_DIR` 覆盖。浏览器 `localStorage` 不是事实源。

## 不得回退的要求

- 不得重新把正式 UI 改成与原型无关的后台管理界面；
- 不得恢复固定 `min-width:1080px` 或固定 1600×900 画布；
- 不得用整体截图缩放替代真实响应式布局；
- 不得为调整前端而修改既有业务语义；
- 不得让 Agent 结果绕过 Proposal 直接覆盖正式内容。

## 下一阶段

`v0.2.0` 开发 LayoutPageDocument、排版引擎、稳定 sourceRef、视觉几何编辑和草案↔排版同步。
