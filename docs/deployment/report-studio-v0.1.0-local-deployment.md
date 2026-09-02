# Report Studio v0.1.0 本地安装与部署说明

## 1. 当前可部署范围

`v0.1.0` 提供可直接运行的本地程序：

```text
大纲
草案
本页素材（基础图片）
批注自动保存
ReviewRound / 多次 ReviewSubmission
Proposal 确认应用
Revision
本地持久化与重启恢复
可选外部 DSH Bridge
```

正式排版画布属于 `v0.2.0`，当前只保留禁用入口。当前通用平台不依赖 `pre-design`。

## 2. 环境要求

```text
Git      >= 2.40
Node.js  >= 22
浏览器   Chrome / Edge / Safari 现代版本
UI 验收  Chromium 或 Chrome
```

检查：

```bash
git --version
node --version
npm --version
```

程序运行时零第三方 npm 依赖，**不需要执行 `npm install`**。

## 3. 获取代码

```bash
git clone https://github.com/ArchitectureWorld/presentation-tools.git
cd presentation-tools
git checkout integration/report-studio-mvp-v0.1.0
```

确认：

```bash
git branch --show-current
git log -1 --oneline
node -p "require('./package.json').version"
```

预期产品版本：

```text
0.1.0
```

## 4. 启动

```bash
npm start
```

默认地址：

```text
http://127.0.0.1:4173
```

开发模式：

```bash
npm run dev
```

自定义监听地址和端口：

### macOS / Linux

```bash
HOST=0.0.0.0 PORT=4180 npm start
```

### Windows PowerShell

```powershell
$env:HOST="0.0.0.0"
$env:PORT="4180"
npm start
```

仅在可信局域网内监听 `0.0.0.0`。

## 5. 数据目录与备份

默认正式数据：

```text
<仓库根目录>/.report-studio-data/state.json
```

指定独立目录：

### macOS / Linux

```bash
REPORT_STUDIO_DATA_DIR=/absolute/path/report-studio-data npm start
```

### Windows PowerShell

```powershell
$env:REPORT_STUDIO_DATA_DIR="D:\report-studio-data"
npm start
```

所有大纲、草案、批注、ReviewRound、ReviewSubmission、Proposal 和 Revision 均写入服务器端 JSON；浏览器 `localStorage` 不是事实源。

备份时停止服务并复制整个数据目录：

```bash
cp -R .report-studio-data .report-studio-data.backup
```

## 6. 响应式界面基线

正式界面以 `tools/report-studio/prototype/` 的视觉与交互为基线：

- 深色工作台与紫色强调；
- 项目品牌、阶段导航、全局页面导航；
- 主工作区和固定批注面板；
- 批注筛选、批次历史、固定输入区；
- 金色项目 Agent 悬浮按钮和大尺寸会话窗口。

生产界面**不绑定** `1600×900`。该尺寸只是设计和回归样本之一。实现使用：

```text
CSS Grid / Flexbox
clamp()
100dvh
minmax()
响应式断点
```

在较窄窗口中，页面会压缩列宽或将工作区与批注区上下排列；不能通过固定画布、整体缩放截图或水平滚动冒充响应式适配。

## 7. 功能使用顺序

### 大纲

1. 修改项目名称；
2. 新增一级章节和子级；
3. 直接修改章节标题；
4. 调整同层顺序；
5. 点击“生成页”建立稳定草案页；
6. 对节点添加批注。

### 草案

支持：

```text
页面标题
正文
要点列表
讲解稿
本页图片素材
```

修改后点击“保存草案”。

### 批注与多次提交

```text
添加批注
→ 自动保存，不增加内容 Revision
→ 提给Agent
→ 创建 ReviewRound + ReviewSubmission #1
```

同一轮未解决完时：

```text
继续本轮
→ 添加补充批注
→ 再次提给Agent
→ 同一 ReviewRound 下创建 ReviewSubmission #2
```

历史 Submission 不被覆盖；问题完成状态由用户明确确认。

## 8. DSH Agent Bridge

Report Studio 不内置第二套模型 Runtime。Agent 能力通过外部 DSH-compatible HTTP Bridge 接入。

未配置 Bridge 时：

- 人工大纲、草案、素材、批注、Submission 和 Revision 全部可用；
- 项目 Agent 显示 `DSH Bridge 未配置 · 可正常人工编辑`；
- 不生成 Mock Agent 假回复。

配置：

```bash
REPORT_STUDIO_AGENT_URL=http://127.0.0.1:5050/report-studio npm start
```

可选超时：

```text
REPORT_STUDIO_AGENT_TIMEOUT_MS=60000
```

Bridge 返回的 `commands` 先形成 Proposal，必须由用户确认后才能创建正式 Revision。具体请求合同以本仓库 `apps/studio-local/agent-bridge.mjs` 和测试为准。

## 9. 自动验证

### 完整验证

```bash
npm run verify:all
```

等价于：

```bash
npm test
npm run verify
npm run verify:ui
```

### `npm test`

覆盖领域核心、Repository、HTTP 服务、Agent Bridge、项目 Agent 内部元素点击、视觉结构合同和响应式静态合同。

### `npm run verify`

使用临时数据目录执行：

```text
项目改名
→ 新建大纲
→ 生成草案页
→ 保存草案
→ 添加批注
→ Submission #1
→ 同一 Round 补充批注
→ Submission #2
→ 停止服务
→ 重启并检查恢复
```

### `npm run verify:ui`

使用真实 Chromium/Chrome，通过 CDP 验证以下窗口样本：

```text
720×900
820×900
1024×768
1366×768
1600×900
1920×1080
```

这些尺寸是回归采样点，不是固定画布。验证内容：

- 页面无水平溢出；
- 大纲/草案阶段正常切换；
- 草案页面导航可见；
- 主工作区和批注区保持可用；
- 金色项目 Agent 按钮中心及内部元素可点击；
- Agent 弹窗不超出窗口并可正常关闭；
- 未配置 Bridge 的状态文案正确；
- 浏览器控制台和运行时错误为 0；
- 各窗口生成 Outline、Draft、Agent 截图供人工检查。

未找到浏览器时，可指定：

### macOS / Linux

```bash
CHROMIUM_PATH=/absolute/path/to/chrome npm run verify:ui
```

### Windows PowerShell

```powershell
$env:CHROMIUM_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe"
npm run verify:ui
```

## 10. 健康检查

```bash
curl http://127.0.0.1:4173/api/health
curl http://127.0.0.1:4173/api/state
```

健康检查应返回 `version: "v0.1.0"`，并明确 `agentConfigured` 状态。

## 11. 常见故障

### 页面仍是旧白色界面

确认当前分支和提交，并执行强制刷新：

```bash
git branch --show-current
git pull --ff-only
```

浏览器使用 `Ctrl/Cmd + Shift + R` 清理静态资源缓存。

### 页面在窄窗口出现水平滚动

执行：

```bash
npm run verify:ui
```

不得通过恢复 `min-width:1080px` 或固定 1600×900 画布处理。

### Agent 按钮不响应

执行：

```bash
node --test apps/studio-local/agent-fab.test.mjs
npm run verify:ui
```

点击事件必须通过 `closest('#agent-fab')` 支持按钮内部元素。

### 重启后项目不是原项目

确认使用了相同的 `REPORT_STUDIO_DATA_DIR`。

### Agent 提示 Bridge 未配置

这是正常状态，不影响人工工作流。配置 `REPORT_STUDIO_AGENT_URL` 后重启。

### Proposal 报 `stale_revision`

Proposal 生成后正式内容已经变化。旧 Proposal 不允许覆盖新 Revision，需要基于当前版本重新提交。

## 12. 阶段边界

### v0.1.0

```text
Outline
Draft
Basic Page Assets
Annotations
ReviewRound / ReviewSubmission
Proposal
Revision
Persistence / Recovery
Responsive prototype-parity UI
External DSH Bridge Contract
```

### v0.2.0

```text
正式排版画布
LayoutPageDocument
OpenPencil / Layout Adapter
sourceRef live / detached / orphaned
视觉样式与几何编辑
草案 ↔ 排版同步
排版导出
```
