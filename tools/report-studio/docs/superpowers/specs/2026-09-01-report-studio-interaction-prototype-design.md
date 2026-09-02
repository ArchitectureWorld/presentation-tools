# Report Studio 交互原型设计

## 目标

在不改动现有 DSH 前期策划插件业务合同、Project State、真实 Agent 与报告导出链路的前提下，建立一个可直接运行的三阶段交互原型，用于验证“大纲—草案—排版”工作台及批注闭环。

## 产品边界

- 原型是 DSH 插件后续工作台的开发预览，不是第二套正式产品。
- 使用模拟数据与本地状态；不写入现有 57 项业务合同。
- 不连接真实 Agent、Storage、Revision 或 PPTX/PDF/HTML 导出。
- 交互与数据边界应可映射为后续 DSH Client React 组件和 Adapter。
- 当前只考虑单人系统。

## 三阶段工作区

### 大纲阶段

- 整份大纲是一个业务作用域。
- 整份大纲对应一个批注块。
- 可选择章节或小节作为批注目标。
- “提给Agent”提交整份大纲当前轮次的待提交批注。

### 草案阶段

- 每个汇报页是一个独立作用域。
- 每页包含文字内容、讲解脚本和本页素材。
- 文字支持整块选择与局部文本选择；素材支持缩略图、大图/视频预览、上传、移出本页和模拟 AI 生成。
- 每页对应一个独立批注块；切换页面时右侧批注同步切换。

### 排版阶段

- 每个汇报页是一个独立作用域，并与草案阶段同页码映射。
- 可选择页面、文本元素、图像元素或图表元素作为批注目标。
- 每页对应一个独立批注块；草案和排版的批注不混用。

## 批注机制

### 单条批注提交

1. 用户选择章节、文字、素材、页面或排版元素。
2. 用户输入一条批注。
3. 点击“添加批注”。
4. 批注进入当前作用域的批注列表，状态为 `staged`。
5. 对应内容显示上脚标编号。
6. 此操作不触发 Agent。

### 批次级 Agent 提交

1. “提给Agent”属于具体批次，不设置跨批次的全局按钮。
2. 本轮首次提交时创建 `roundId`；历史批次继续提交时沿用原 `roundId`。
3. 系统只收集该批次中未完成的批注及当前最新上下文，生成结构化提交包。
4. 同一批次的每次提交生成独立 `submissionId` 和递增的 `submissionNumber`。
5. 原型将该批次标记为 `processing`，随后把 Agent 返回写入原批次。
6. Agent 返回后批注状态为 `responded`；只有用户明确标记完成后才计入“已完成”。

## 作用域规则

- `outline:root`：整份大纲。
- `draft:<pageId>`：草案某页。
- `layout:<pageId>`：排版某页。
- 页面切换只切换当前作用域，不迁移批注。
- 阶段切换不合并草案和排版批注。

## 核心数据接口

```ts
interface StudioAdapter {
  getState(): StudioState
  subscribe(listener: (state: StudioState) => void): () => void
  selectTarget(target: AnnotationTarget | null): void
  addComment(input: AddCommentInput & { roundId?: string }): Comment
  editComment(commentId: string, input: { text: string }): Comment
  setCommentCompleted(commentId: string, completed: boolean): void
  submitRound(roundId?: string): SubmissionPackage
  completeRound(roundId: string, result: AgentResult): void
  setStage(stage: Stage): void
  setPage(pageId: string): void
  addAsset(pageId: string, asset: Asset): void
  removeAsset(pageId: string, assetId: string): void
}
```

原型实现 `MockStudioAdapter`；后续 DSH 集成时保留 UI 组件，替换为 DSH Adapter。

## 结构化提交包

```json
{
  "schemaVersion": "report-studio.prototype.v1",
  "projectId": "project-demo-001",
  "stage": "draft",
  "scopeKey": "draft:page-04",
  "pageId": "page-04",
  "roundId": "round-001",
  "submissionId": "submission-002",
  "submissionNumber": 2,
  "submittedAt": "ISO-8601",
  "context": {
    "outline": [],
    "page": {},
    "selectedAssets": [],
    "layout": []
  },
  "comments": []
}
```

## 错误处理

- 未选择目标时，允许创建“整页/整份大纲”批注。
- 空批注不可添加。
- 当前批次没有未完成批注时，该批次不显示可执行的“提给Agent”。
- 文件上传失败或类型不支持时显示局部错误，不破坏当前页面状态。
- 模拟 Agent 处理失败时，批次标记为 `failed`，批注保留，仍通过该批次的“提给Agent”处理。

## 验收标准

1. 三阶段可切换，公共顶部区域位置一致，仅当前阶段高亮不同。
2. 草案与排版可切换页面，右侧批注按阶段和页面独立加载。
3. 文字局部选择、内容块、素材和排版元素均可成为批注目标。
4. “添加批注”只增加单条批注并生成上脚标。
5. 点击上脚标可定位右侧对应批注，点击批注可定位内容目标。
6. 每个批次独立显示“提给Agent”；历史批次沿用原 `roundId`，只提交该批次未完成内容。
7. 批次标题显示“已完成 x · 未完成 x”，模拟 Agent 状态至少包含处理中、待确认和已完成。
8. 素材缩略图可打开预览，支持上传、移出本页和模拟 AI 生成。
9. 页面刷新后可通过本地存储恢复演示状态，并可一键重置。
10. 核心状态模型通过自动化测试。
