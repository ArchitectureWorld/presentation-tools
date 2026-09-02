# Report Studio 与 DSH 的正式集成边界

版本基线：`Report Studio v0.8.1`  
目标仓库：`ArchitectureWorld/presentation-tools`  
目标宿主：现有 `ArchitectureWorld/pre-design` DSH 原生插件

## 1. 结论

Report Studio 应作为现有 DSH 原生插件中的**统一汇报工作台**，不得演变为第二套独立 Web 应用、第二套项目状态或第二套 Agent Runtime。

正式集成只允许替换原型的宿主入口与 Adapter：

```text
可运行原型 UI
   ↓ 保留交互与组件语义
React 组件
   ↓
StudioAdapter
   ├─ MockStudioAdapter（原型/测试）
   └─ DshStudioAdapter（正式）
          ↓
DSH Session / Harness / Command / Project State / Revision / Storage
```

第一轮正式集成明确**不改动 `contracts/v0.6`**。现有 `pre-design` 业务合同、Gate、Revision 和报告生成机制仍是事实源。模型不得直接覆盖 Project State，也不得自行批准 Gate。

## 2. 现有宿主入口

当前 `pre-design` 插件已通过 `src/client/index.tsx` 使用 DSH Slot：

```text
conversation.session.header.actions
conversation.chat.node
```

Report Studio 推荐从 `conversation.session.header.actions` 提供“打开工作台”入口，在 DSH 页面内部打开全屏工作区或宿主支持的工作台容器。不要跳转到独立站点。

## 3. 推荐组件边界

```text
src/client/report-studio/
├─ ReportStudio.tsx                 工作台入口与生命周期
├─ ReportStudioShell.tsx            公共顶栏、阶段导航与页面导航
├─ stages/
│  ├─ OutlineStage.tsx
│  ├─ DraftStage.tsx
│  └─ LayoutStage.tsx
├─ comments/
│  ├─ CommentPanel.tsx
│  ├─ CommentBatch.tsx
│  ├─ CommentCard.tsx
│  └─ CommentComposer.tsx
├─ agent/
│  ├─ FloatingAgentLauncher.tsx
│  ├─ AgentChatWindow.tsx
│  └─ AgentTimelineItem.tsx
├─ assets/
│  ├─ PageAssetGrid.tsx
│  └─ AssetPreview.tsx
├─ adapters/
│  ├─ studio-adapter.ts
│  ├─ mock-studio-adapter.ts
│  └─ dsh-studio-adapter.ts
└─ model/
   ├─ studio-types.ts
   ├─ studio-selectors.ts
   └─ studio-commands.ts
```

原则：

- UI 组件只依赖 `StudioAdapter`。
- UI 不直接调用 Session、Storage、Agent Tool 或数据库。
- Adapter 负责把 UI 语义动作转换为 DSH 受控 Command。
- 所有稳定对象必须使用持久化 ID，不以数组位置或显示标题作为主键。

## 4. StudioAdapter 语义接口

```ts
interface StudioAdapter {
  getState(): StudioState
  subscribe(listener: (state: StudioState) => void): () => void

  setStage(stage: 'outline' | 'draft' | 'layout'): void
  setPage(pageId: string): void
  selectTarget(target: AnnotationTarget | null): void

  addComment(input: { text: string; roundId?: string }): Comment
  editComment(commentId: string, input: { text: string }): Comment
  setCommentCompleted(commentId: string, completed: boolean): void
  setRoundExpanded(scopeKey: string, roundId: string, expanded: boolean): void

  submitRound(roundId?: string): SubmissionPackage
  completeRound(roundId: string, result: AgentResult): void

  updatePageContent(pageId: string, input: PageContentPatch): void
  addAsset(pageId: string, asset: Asset): void
  removeAsset(pageId: string, assetId: string): void
  updateLayoutElement(pageId: string, elementId: string, patch: LayoutPatch): void

  sendAgentMessage(input: AgentMessageInput): Promise<AgentMessageResult>
  focusRound(input: { stage: Stage; pageId?: string; roundId: string }): void
}
```

正式实现可以异步化部分接口，但不得改变其业务语义。

## 5. 三阶段与批注作用域

必须保留以下不可混用的作用域：

```text
outline:root
草案：draft:<pageId>
排版：layout:<pageId>
```

- 大纲本身是一个完整业务，所以整份大纲对应一个批注块。
- 草案和排版属于页面级，每页分别对应一个批注块。
- 同一 `pageId` 的草案批注和排版批注也不得合并。
- 切换页面或阶段时，右侧批注栏只加载当前作用域数据。

## 6. 批注批次模型

每个作用域内部按轮次收敛：

```text
本轮未提交：始终置顶并展开
处理中批次：自动展开
已完成历史批次：默认收起，按提交时间倒序
```

必须满足：

- 首次“提给Agent”时创建 `roundId`。
- 历史批次再次提交仍沿用原 `roundId`。
- 每个批次显示 `已完成 x · 未完成 x`。
- Agent 返回不等于批注完成；完成状态由用户应用或明确标记。
- 历史批次可继续补充、编辑和再次提交。
- 每次提交创建新的 `submissionId` 与 `submissionNumber`。
- 提交内容只包含该批次未完成项。
- Agent 结果写回原批次，不得混入其他作用域或轮次。
- 批次展开状态按 `scopeKey + roundId` 持久化。
- 点击内容上脚标时先展开所属批次，再定位批注。

## 7. 两种提交

### 7.1 添加批注

- 保存当前单条批注。
- 状态进入 `staged`。
- 保存定位对象与上脚标编号。
- 不触发 Agent。

### 7.2 提给Agent

- 按钮属于具体批次，不设置跨批次全局按钮。
- 生成结构化 `SubmissionPackage`。
- 通过 DSH Harness/Command Gateway 投递给当前项目 Agent 会话。
- Agent 返回与原批次、原提交和 Revision 建立引用关系。

建议结构：

```ts
interface SubmissionPackage {
  projectId: string
  stage: 'outline' | 'draft' | 'layout'
  pageId?: string
  scopeKey: string
  roundId: string
  submissionId: string
  submissionNumber: number
  comments: SubmittedComment[]
  documentContext: StudioDocumentContext
  baseRevisionId: string
}
```

## 8. 项目级悬浮 Agent

### 8.1 单一会话原则

悬浮 Agent 不是新建的独立 Agent。正式实现必须绑定当前项目在 DSH 中的现有 Session/Harness：

```text
普通聊天消息 ─────┐
                  ├─ 同一项目级 Agent 会话时间线
批注批次提交 ─────┘
```

- 大纲、草案和排版共享一个项目级连续会话。
- 切换阶段或页面不清空聊天记录。
- 每条消息记录当前 `stage`、`pageId`、`scopeKey` 和可选 `roundId`。
- 普通聊天时自动附带当前页面的结构化上下文摘要。
- 批注批次提交以系统消息形式进入同一时间线。
- 聊天中的批次消息可以定位回右侧对应批次。
- 右侧批次中的 Agent 结果也应能打开会话并定位对应消息。

### 8.2 悬浮入口

- 图标允许拖动。
- 松手后吸附左侧或右侧边缘。
- 位置偏好是 UI 偏好，可存于客户端配置，不属于业务 Revision。
- 不得遮挡固定批注输入区或关键操作。
- 展开后使用宿主工作区内的模态/浮层，不打开新页面。

### 8.3 自动上下文

普通聊天最小上下文：

```text
项目 ID / 项目名称
当前阶段
当前页面或整份大纲
当前 Revision
当前页面文字内容
当前页素材引用
当前排版元素摘要
当前选中对象（如有）
```

Agent 不应每次读取完整项目全部原文。应通过稳定 ID 和摘要按需扩展上下文，避免无控制地增加 Token。

## 9. 草案文字人工编辑

- 编辑状态先保存在前端临时缓冲区。
- 点击“保存修改”后，通过单一受控 Command 写入。
- 点击“取消”不得修改 Project State。
- 编辑期间暂停文字批注选择，并阻止切换页面或阶段。
- 保存后同步排版阶段中与该页绑定的文字元素。
- 同步只改变文本，不改变 `x / y / w / h`。
- 正式接入时必须创建 Revision 或等价审计记录。

## 10. Agent 返回与应用

原型当前只模拟返回文本。正式实现必须区分：

```text
Agent 建议
Agent 生成的 Command 候选
差异预览
用户确认应用
Revision 提交
```

禁止：

- Agent 直接覆盖整页或整份 Project State。
- 未经预览和受控 Command 将结果静默写入。
- 将 Agent 返回自动标记为批注已完成。
- 用聊天消息替代持久化业务状态。

## 11. 最小架构基线必须冻结的内容

正式开发前至少确认：

1. Project、Outline、Page、ContentBlock、Asset、LayoutElement、Comment、Round、Submission、AgentMessage 的稳定 ID。
2. Studio Document 与现有 57 项业务状态之间的映射。
3. 批注暂存、批次展开状态和 UI 偏好的持久化位置。
4. `submitRound(roundId?)` 的 Command Schema。
5. 当前 DSH Session 与项目级 Agent 会话的绑定方式。
6. Agent 返回 Command、Revision、差异预览与应用确认之间的关系。
7. 草案更新后排版同步、冲突和重新生成规则。

## 12. 推荐实施顺序

1. 将当前 HTML 原型拆为 React 组件，继续使用 `MockStudioAdapter`。
2. 在 DSH Slot 中挂载工作台，验证尺寸、键盘、焦点、滚动和模态层级。
3. 接入只读 `DshStudioAdapter`，读取项目、大纲、页面和素材。
4. 接入批注暂存、批次折叠和作用域切换。
5. 绑定现有 DSH Session，实现项目级 Agent 普通聊天。
6. 将“提给Agent”转换为批次级结构化 Command，并写入同一会话时间线。
7. 接入 Agent 结果、差异预览、应用确认和 Revision。
8. 最后接入真实素材管理、AI 生图以及 HTML/PPTX/PDF 导出投影。
