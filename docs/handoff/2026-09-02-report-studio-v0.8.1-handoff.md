# Report Studio v0.8.1 Handoff

> 面向下一位产品、前端或 DSH 插件开发 Agent 的可执行交接文档。阅读本文件后，应能直接理解当前成果、稳定决策、代码结构、验收基线、正式集成边界和下一阶段实施顺序，无需重新讨论已冻结内容。

## 0. 交接摘要

- **产品名称**：Report Studio 三阶段汇报制作工作台
- **当前版本**：`0.8.1`
- **当前成果性质**：可运行前端交互原型
- **目标仓库**：`ArchitectureWorld/presentation-tools`
- **源码位置**：`tools/report-studio/`
- **直接运行文件**：`tools/report-studio/dist/report-studio-prototype-v0.8.1.html`
- **完整源码获取**：直接克隆仓库或使用 GitHub “Download ZIP”
- **正式宿主方向**：接入 `ArchitectureWorld/pre-design` 现有 DSH 原生插件
- **当前 Agent 状态**：Mock；没有调用真实模型
- **当前持久化状态**：浏览器本地存储；不是 DSH Project State
- **当前可作为基线的内容**：UI 布局、核心交互、批注作用域、批次模型、草案人工编辑、素材展示、项目级悬浮 Agent 交互

## 1. 权威版本与一致性规则

### 1.1 唯一有效版本

本次交付唯一有效版本为：

```text
0.8.1
```

不得将 `0.8.0`、`0.7.0` 或其他历史版本作为当前实施基线。

### 1.2 版本权威顺序

发生版本信息不一致时，按以下顺序判定：

1. `tools/report-studio/VERSION`
2. `tools/report-studio/package.json#version`
3. `tools/report-studio/release-manifest.json#version`
4. `tools/report-studio/scripts/build-single-file.js` 写入的 `report-studio-build` 元数据
5. 发布文件名、Release Notes、README 和本 Handoff

以上位置当前均为 `0.8.1`。

### 1.3 发布前强制校验

```bash
cd tools/report-studio
npm test
npm run build
cmp --silent report-studio-prototype.html dist/report-studio-prototype-v0.8.1.html
npm run verify:release
npm run verify:browser
```

禁止只修改文件名或 README 就提升版本。版本升级必须同时更新 `VERSION`、`package.json`、`release-manifest.json`、构建元数据、产物文件名、CHANGELOG、Release Notes 和 Handoff。

## 2. 产品目标

Report Studio 用于降低专业汇报制作中“表达不清、改动不确定、批注与内容脱节、素材难管理、Agent 缺少上下文”的问题。

核心流程固定为：

```text
大纲阶段 → 草案阶段 → 排版阶段
```

- **大纲阶段**：确定整份汇报由哪些大章节和小章节组成。
- **草案阶段**：在大纲基础上深化每一页的文字、讲解脚本和本页素材。
- **排版阶段**：对已经确定的页面内容进行具体版式设计。

脚本不再作为独立大阶段，归入草案阶段。

## 3. 已冻结的产品决策

以下内容已经由用户确认，后续不得无依据重新设计。

### 3.1 三阶段公共界面

- 三个阶段使用同一产品外壳和公共顶栏。
- 阶段名称的位置、尺寸和基线一致，只改变当前阶段高亮。
- 草案与排版使用页面导航；大纲不按单页工作。
- 右侧始终存在批注区域。
- 当前阶段的主要工作区位于左侧/中部。

### 3.2 批注作用域

```text
大纲：outline:root
草案：draft:<pageId>
排版：layout:<pageId>
```

- 整份大纲对应一个批注块。
- 草案每一页对应一个独立批注块。
- 排版每一页对应一个独立批注块。
- 同一页的草案批注和排版批注也不得混合。

### 3.3 两类批注操作

#### 添加批注

- 只保存当前编辑的一条批注。
- 批注进入当前作用域或指定历史批次。
- 状态为未提交/待提交。
- 不触发 Agent。

#### 提给Agent

- 按钮与具体批次绑定。
- 不存在跨批次的全局提交按钮。
- 所有按钮统一使用文案：`提给Agent`。
- 历史批次再次提交时仍使用同一 `roundId`。
- 每次提交生成新的 `submissionId` 与 `submissionNumber`。
- 只提交该批次中未完成的批注。

### 3.4 批注批次收敛

- 本轮未提交始终置顶并展开。
- 处理中批次自动展开。
- 已完成历史批次默认收起。
- 历史批次按时间倒序排列。
- 批次标题必须显示：`已完成 x · 未完成 x`。
- Agent 返回不等于批注完成；完成状态由用户应用或明确标记。
- 历史批次允许继续补充和编辑。
- 点击内容区上脚标时，自动展开所属批次并定位到对应批注。

### 3.5 批注栏滚动结构

右侧批注栏固定为三段：

```text
固定顶部：标题、数量、筛选
独立滚动区：本轮和历史批次
固定底部：目标提示、输入框、添加批注
```

不得让批次数量增长后继续压缩底部输入区，也不得让整个工作台随批注列表一起滚动。

### 3.6 草案文字人工编辑

用户可以点击 `编辑内容`，直接修改：

- 页面标题
- 页面正文
- 正文要点
- 关键指标数值和说明
- 讲解脚本时间点和文字

规则：

- 编辑状态提供 `保存修改 / 取消`。
- `Ctrl/⌘ + Enter` 保存，`Esc` 取消。
- 未保存时阻止切换页面或阶段。
- 编辑期间暂停文字拖选批注。
- 保存后更新结构化页面数据。
- 同步更新排版阶段已映射的文字。
- 同步不得改变排版元素的 `x / y / w / h`。

### 3.7 素材

- 图片、视频、图表处于同一层级。
- 草案页显示的是“本页素材”，不是全项目素材库。
- 素材以缩略图展示，点击后放大预览。
- 支持人工上传、移出本页和 Agent/AI 生成入口。
- 正式实现必须区分“移出本页”和“从项目素材永久删除”。

### 3.8 项目级悬浮 Agent

- 悬浮 Agent 使用金色全息能量核心样式。
- 图标可拖动。
- 松手后自动吸附左侧或右侧边缘。
- 记住最后位置。
- 点击后展开约 80% 屏幕的聊天窗口。
- 关闭后恢复为悬浮图标。
- 大纲、草案、排版共享一个项目级连续会话。
- 切换页面或阶段不清空聊天历史。
- 聊天窗口实时显示当前页面和当前阶段。
- 普通聊天和批注批次提交进入同一条时间线。
- 点击批次的 `提给Agent`，会在聊天中生成“系统 · 批注批次”消息。
- 聊天中的批次消息可定位回右侧原批次。

正式 DSH 接入时，这个会话必须绑定当前 DSH Session/Harness，不得新建第二套 Agent Runtime。

## 4. 当前实现状态

### 4.1 已实现并可运行

- 三阶段切换。
- 草案/排版页面切换。
- 大纲、草案、排版批注作用域隔离。
- 章节、内容块、局部文字、素材、排版元素批注定位。
- 单条批注添加。
- 批次级提交。
- 历史批次补充、编辑、完成/未完成切换和再次提交。
- 批次折叠、统计和独立滚动。
- 上脚标与批注定位联动。
- 草案文字人工编辑。
- 草案文字到排版文字同步。
- 素材缩略图、放大、上传、移出和模拟生成。
- 排版元素选择和拖动。
- 项目级悬浮 Agent 窗口。
- Agent 图标拖动、边缘吸附和位置记忆。
- 普通聊天消息和模拟回复。
- 批注提交进入项目级聊天时间线。
- 聊天批次消息定位回右侧批次。
- 浏览器本地状态恢复、重置和 JSON 导出。

### 4.2 当前仅为 Mock

- Agent 普通聊天回复。
- 批注提交后的 Agent 处理结果。
- AI 素材生成。
- 项目数据存储。
- Revision 与差异预览。

### 4.3 尚未实现

- 真实 DSH Session/Harness 连接。
- `DshStudioAdapter`。
- Studio Document 与 `pre-design` 现有 57 项业务状态映射。
- 受控 Command Schema。
- 正式 Revision、撤销、恢复、冲突与差异预览。
- Agent 建议一键应用到页面内容/素材/排版。
- 项目素材总库与本页素材的真实引用关系。
- 真实 AI 生图、上传存储、文件删除和权限。
- PPTX/PDF/HTML 正式报告投影。
- 多人协作；当前明确按单人系统设计。

## 5. 代码结构

```text
tools/report-studio/
├─ VERSION
├─ package.json
├─ release-manifest.json
├─ README.md
├─ CHANGELOG.md
├─ RELEASE-NOTES-v0.8.1.md
├─ PACKAGE-INFO.md
├─ prototype/
│  ├─ index.html
│  ├─ styles.css
│  └─ app.js
├─ src/
│  ├─ studio-model.js
│  └─ mock-studio-adapter.js
├─ scripts/
│  ├─ build-single-file.js
│  ├─ verify-browser.js
│  └─ verify-release-metadata.js
├─ tests/
├─ integration/
│  └─ dsh-client-integration.md
└─ dist/
   ├─ report-studio-prototype-v0.8.1.html
   └─ SHA256SUMS
```

### 5.1 `prototype/app.js`

负责：

- DOM 渲染与事件绑定；
- 三阶段和页面切换；
- 批注 UI；
- 草案内容编辑；
- 素材预览；
- 排版拖动；
- 悬浮 Agent UI、普通聊天和批次消息联动。

该文件当前较大。正式 React 迁移时必须按功能拆分，不能继续堆叠为单文件组件。

### 5.2 `src/studio-model.js`

负责纯状态模型和业务状态变换，包括：

- 初始项目、大纲、页面、素材和排版数据；
- 批注、轮次、提交和 Agent 返回；
- 作用域计算；
- 完成/未完成统计；
- 草案内容更新；
- 排版文字同步。

正式迁移时优先保留其业务语义，并改写为 TypeScript 类型和可测试 reducer/service。

### 5.3 `src/mock-studio-adapter.js`

负责：

- 对纯状态模型进行封装；
- 订阅通知；
- 浏览器本地持久化；
- 暴露 UI 语义接口。

正式实现以 `DshStudioAdapter` 替换，但 UI 组件不得直接依赖 DSH 内部服务。

## 6. 当前数据模型关键点

必须保留稳定实体关系：

```text
Project
├─ Outline
├─ Pages
│  ├─ DraftContent
│  ├─ PageAssets
│  └─ LayoutElements
├─ CommentsByScope
├─ RoundsByScope
├─ AgentMessagesByScope（原型侧）
└─ UI Preferences
```

正式数据合同需要新增或明确：

```text
Comment
Round
Submission
AgentMessage
Revision
CommandCandidate
AssetReference
```

重点：聊天消息是会话记录，不是 Project State 的替代品；业务修改必须通过 Command 和 Revision 落地。

## 7. DSH 集成原则

完整说明见：

```text
tools/report-studio/integration/dsh-client-integration.md
```

核心边界：

- Report Studio 是现有 DSH 插件的新工作台，不是独立站点。
- 第一轮集成**不改动 `contracts/v0.6`**。
- UI 只依赖 `StudioAdapter`。
- `MockStudioAdapter` 用于原型和测试。
- `DshStudioAdapter` 负责连接 DSH Session、Project State、Command、Revision 和 Storage。
- 模型不得直接写 Project State。
- Agent 不得自行批准 Gate。
- 悬浮 Agent 必须复用当前 DSH Session/Harness。

## 8. 开发启动门槛

在正式 MVP 开发前，隔壁架构至少要完成“最小架构基线验收”，冻结以下内容：

1. Project、Outline、Page、ContentBlock、Asset、LayoutElement、Comment、Round、Submission、AgentMessage 的稳定 ID。
2. Studio Document 与现有 57 项业务状态的映射。
3. 批注暂存、批次状态、聊天记录和 UI 偏好的持久化位置。
4. 批次级 `submitRound(roundId?)` Command Schema。
5. 当前 DSH Session 与项目级 Agent 会话的绑定方式。
6. Agent 返回 Command 候选、差异预览、应用确认和 Revision 之间的关系。
7. 草案文字更新后，排版同步和冲突提示规则。

不需要等待所有高级功能讨论完，但上述七项未冻结时，不应直接写正式数据层。

## 9. 下一阶段推荐任务

### P0：React 组件化 + Mock Adapter 保真迁移

目标：在 DSH 前端技术栈中复现当前原型，不连接真实数据。

验收：

- 三阶段公共布局一致；
- 所有现有核心交互可用；
- 作用域和批次行为与 `v0.8.1` 一致；
- 项目级悬浮 Agent 行为一致；
- 组件测试覆盖核心流程；
- 不修改 `contracts/v0.6`。

### P1：只读 DshStudioAdapter

目标：从现有 Project State 读取项目、大纲、页面、文字、素材和排版数据。

验收：

- UI 不再依赖演示数据；
- 稳定 ID 可跨重启恢复；
- 只读模式不写 Project State；
- 缺失映射有明确错误状态。

### P2：批注暂存与批次持久化

目标：接入大纲级和页面级批注作用域、批次折叠、完成状态与滚动偏好。

验收：

- 重启后批注和批次恢复；
- 历史批次原位补充；
- 草案与排版同页批注不混合；
- 单人系统下无多人身份字段干扰。

### P3：项目级 Agent 会话

目标：悬浮聊天绑定当前 DSH Session/Harness。

验收：

- 普通消息走当前项目 Session；
- 页面/阶段切换后会话连续；
- 自动上下文包含稳定 ID 和摘要；
- 不创建第二套模型配置或凭据管理。

### P4：批次级提给Agent

目标：把批次结构化提交包投递到同一项目会话。

验收：

- 提交消息在聊天时间线可见；
- 结果关联原 `roundId/submissionId`；
- 历史批次再次提交不新建外层轮次；
- 只提交未完成项；
- 错误可恢复且不丢失批注。

### P5：建议预览与受控应用

目标：Agent 返回 Command 候选，通过差异预览后应用到 Project State。

验收：

- 建议、Command 候选、预览、应用、Revision 五层分离；
- 用户可拒绝或部分采纳；
- 应用后批注状态可明确更新；
- 可回滚到应用前 Revision。

## 10. 不得擅自改变的内容

- 不得重新拆回“大纲、草案、脚本、排版”四阶段。
- 不得把脚本移出草案阶段。
- 不得把大纲批注拆成页面批注。
- 不得把草案与排版同页批注混在一起。
- 不得恢复跨批次全局“提给Agent”。
- 不得使用“重新提给Agent”等不同按钮名称。
- 不得让 Agent 返回自动等于批注已完成。
- 不得让批注列表挤压底部输入区。
- 不得把本页素材误称为完整素材库。
- 不得把图片与视频拆成不同大层级。
- 不得改成多人协作优先；当前是单人系统。
- 不得新建独立 Agent Runtime 或独立模型配置。
- 不得让模型直接覆盖 Project State。
- 不得修改 `contracts/v0.6` 以适配第一轮 UI 接入。

## 11. 验证证据

详见：

```text
docs/acceptance/report-studio-v0.8.1-verification.md
```

当前验证结果：

- 自动化测试：`57/57` 通过。
- 构建文件：`212,919 bytes`。
- 构建产物与版本化 HTML 逐字节一致。
- 发布元数据与 SHA-256 校验通过。
- Chromium 真实交互验证通过。

发布文件：

| 文件 | SHA-256 |
|---|---|
| `tools/report-studio/dist/report-studio-prototype-v0.8.1.html` | `94e8b74c4582274e4ff5238c5f8385961b345564a4214b7b9fe2563f950dc226` |

## 12. 接手检查清单

下一位 Agent 开始工作前必须依次完成：

- [ ] 阅读本 Handoff。
- [ ] 阅读 `tools/report-studio/README.md`。
- [ ] 阅读 `tools/report-studio/integration/dsh-client-integration.md`。
- [ ] 确认 `VERSION`、`package.json` 和 `release-manifest.json` 都是 `0.8.1`。
- [ ] 运行 `npm test`。
- [ ] 运行 `npm run build`。
- [ ] 运行 `npm run verify:release`。
- [ ] 有 Chromium 时运行 `npm run verify:browser`。
- [ ] 核对隔壁最小架构基线是否已经冻结。
- [ ] 在独立分支或 worktree 中开始正式开发。
- [ ] 保持 UI 与数据层通过 `StudioAdapter` 解耦。
- [ ] 每个功能先写失败测试，再实现。

## 13. 交接结论

`Report Studio v0.8.1` 已经完成交互原型阶段的主要验证，可作为正式 React/DSH 集成的视觉和行为基线。下一步不是继续无边界地打磨静态图，而是等待最小架构基线冻结后，按 `P0 → P5` 顺序将现有行为保真迁移到 DSH 原生插件中。
