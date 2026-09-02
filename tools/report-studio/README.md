# Report Studio 三阶段交互原型

**当前版本：`0.8.1`**  
**交付状态：可运行前端交互原型**  
**运行边界：Mock Adapter + 浏览器本地状态；尚未连接真实 DSH Agent、Project State、Revision、Storage 或报告导出链路。**

Report Studio 用于验证专业汇报生产过程中的三阶段工作台：

```text
大纲阶段 → 草案阶段 → 排版阶段
```

## 直接体验

打开版本化交付文件：

```text
dist/report-studio-prototype-v0.8.1.html
```

它已经内联 CSS、状态模型、Mock Adapter、交互代码及压缩后的 Agent 图标资源，不依赖网络、第三方 CDN 或构建环境。

## 核心交互

### 三阶段

- **大纲阶段**：整份大纲对应一个批注作用域。
- **草案阶段**：每一页对应独立批注作用域，包含文字内容与本页素材。
- **排版阶段**：每一页对应独立批注作用域，可选择和拖动排版元素。
- 草案页与排版页即使 `pageId` 相同，也使用不同作用域，批注不会混合。

### 批注与批次

- 章节、内容块、局部文字、素材和排版元素均可作为批注目标。
- **添加批注**：只把当前单条批注加入当前作用域，不触发 Agent。
- **提给Agent**：按钮与具体批次绑定，不存在跨批次的全局提交按钮。
- 每个批次显示 `已完成 x · 未完成 x`。
- 本轮未提交置顶展开；处理中批次自动展开；历史批次默认折叠并按时间倒序排列。
- 历史批次允许继续补充、编辑和再次提交；仍保留原 `roundId`，只提交该批次未完成内容。
- 同一批次的多次提交使用不同 `submissionId`，但不创建新的外层轮次。
- 批注卡片支持内联编辑、保存、取消、完成/未完成切换。
- 点击内容区上脚标会自动展开所属批次并定位到对应批注。
- 批次列表独立滚动；顶部标题/筛选和底部输入区固定。

### 草案内容人工编辑

点击“编辑内容”后，“文字内容”进入显式编辑模式，可人工修改：

- 页面标题
- 页面正文
- 正文要点
- 关键指标数值与说明
- 讲解脚本时间点与文字

编辑状态支持：

- `保存修改 / 取消`
- `Ctrl/⌘ + Enter` 保存
- `Esc` 取消
- 未保存时阻止切换页面或阶段
- 编辑期间暂停文字拖选批注
- 保存后同步排版阶段中已映射文字，但不改变元素位置与尺寸

### 素材

- 图片、视频和图表处于同一素材层级。
- 本页仅显示当前页已使用或候选素材。
- 支持缩略图、点击放大预览、上传、移出本页和模拟 AI 生成。

### 项目级悬浮 Agent

- 工作界面提供金色全息能量核心样式的悬浮入口。
- 图标可拖动，松手后自动吸附左右边缘，并记住最后位置。
- 点击后打开约 80% 屏幕的聊天窗口；关闭后恢复悬浮状态。
- 大纲、草案和排版共享一个项目级连续会话，切换页面或阶段不会清空聊天记录。
- 窗口顶部实时显示当前阶段和当前页面。
- 普通聊天和批注批次提交进入同一会话时间线。
- 点击批次的“提给Agent”后，会话内新增“系统 · 批注批次”消息，并触发模拟 Agent 返回。
- 会话中的批次消息可定位回右侧对应批次。

## 本地运行

### 单文件

直接打开：

```text
dist/report-studio-prototype-v0.8.1.html
```

### 源码版本

```bash
python3 -m http.server 4173
```

访问：

```text
http://127.0.0.1:4173/prototype/index.html
```

## 开发与验证

要求：Node.js 20+；完整浏览器验证还需要系统可执行文件 `chromium`。

```bash
npm test
npm run build
npm run verify:release
node scripts/verify-browser.js
```

| 命令 | 作用 |
|---|---|
| `npm test` | 运行状态模型、Adapter、结构、批注、内容编辑、预览体积和发布元数据测试 |
| `npm run build` | 生成根目录临时构建文件 `report-studio-prototype.html` |
| `npm run verify:release` | 校验版本号、HTML 元数据、发布文件名及 SHA-256 |
| `node scripts/verify-browser.js` | 使用 Chromium DevTools Protocol 执行真实浏览器交互验收并生成截图 |

## 目录

```text
prototype/                         多文件开发版本
src/studio-model.js                纯状态模型与业务状态变换
src/mock-studio-adapter.js         Mock Adapter、本地持久化及订阅通知
scripts/build-single-file.js       自包含 HTML 构建器
scripts/verify-browser.js          Chromium 真实交互验证（本地生成 screenshots/，不提交二进制截图）
scripts/verify-release-metadata.js 发布版本与校验值验证
integration/dsh-client-integration.md
dist/report-studio-prototype-v0.8.1.html
dist/SHA256SUMS
VERSION
release-manifest.json
```

## 版本权威顺序

发生版本或发布信息不一致时，按以下顺序处理：

1. `VERSION`
2. `package.json#version`
3. `release-manifest.json#version`
4. `scripts/build-single-file.js` 写入的 HTML 元数据
5. 发布文件名、Release Notes、README 与 Handoff

任何发布前必须执行：

```bash
npm test
npm run build
npm run verify:release
```

## 正式接入边界

本原型不能直接替代现有 DSH 插件。后续应：

1. 将界面拆为 React 组件；
2. 保持 UI 只依赖统一 `StudioAdapter`；
3. 用 `DshStudioAdapter` 替换 `MockStudioAdapter`；
4. 将项目级悬浮 Agent 绑定至当前 DSH Session/Harness；
5. 将批次提交转换为受控 Command，而不是让模型直接覆盖 Project State；
6. 将 Agent 返回结果写入 Revision/差异预览/确认流程。

详细边界见：[`integration/dsh-client-integration.md`](integration/dsh-client-integration.md)。
