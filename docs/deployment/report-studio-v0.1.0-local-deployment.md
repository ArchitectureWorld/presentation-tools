# Report Studio v0.1.0 本地安装与部署说明

## 1. 文件用途

本文件面向本地开发 Agent、开发人员和验收人员，目标是：**拿到仓库后，不需要重新询问项目背景，即可完成环境检查、依赖安装、本地启动、DSH 接入验证、测试和故障定位。**

当前版本统一为：

```text
Report Studio v0.1.0
```

当前第一阶段目标是：**优先完成大纲 + 草案阶段，使其可以直接投入实际使用。排版阶段进入 v0.2.0。**

当前通用平台不依赖 `pre-design`。

---

## 2. v0.1.0 本地可用目标

本地部署成功后，至少应能完成：

```text
打开 Report Studio
→ 新建/打开项目
→ 编辑大纲
→ 生成并切换草案页面
→ 编辑 heading / text / list / 讲解稿
→ 管理本页素材引用
→ 添加批注并自动保存
→ 同一 ReviewRound 多次“提给Agent”
→ DSH Agent 返回 Proposal
→ 用户确认应用
→ 形成 Revision
→ 关闭并重新启动后恢复项目、草案、批注和历史 Submission
```

v0.1.0 **不以排版完成为本地部署成功条件**。排版入口可以保留，但正式排版能力属于 v0.2.0。

---

## 3. 支持环境

### 3.1 必需工具

建议开发环境：

```text
Git        >= 2.40
Node.js    22.x LTS
pnpm       10+（workspace 建立后以 packageManager 字段为准）
Chromium / Chrome（用于浏览器 E2E）
```

如果仓库后续在根 `package.json` 固定了 `packageManager`，必须优先使用该版本，不得继续以本文建议值覆盖仓库事实。

### 3.2 DSH

Report Studio 的 Agent 能力必须复用 **DSH Harness**，不得另建模型 Runtime。

开发 Agent 开始 DSH 接入前必须先检测本机实际 DSH 环境：

```bash
dsh --version
```

然后记录实际版本到：

```text
docs/spikes/dsh-local-environment.md
```

不得在没有检测的情况下假设用户机器上的 DSH 版本、Storage Provider、Profile 路径或插件目录。

---

## 4. 获取代码

```bash
git clone https://github.com/ArchitectureWorld/presentation-tools.git
cd presentation-tools
git fetch --all --prune
git checkout integration/report-studio-mvp-v0.1.0
```

当 v0.1.0 整合 PR 合并到 `main` 后，应改为：

```bash
git checkout main
git pull --ff-only
```

部署 Agent 必须先确认当前版本：

```bash
git branch --show-current
git log -1 --oneline
```

并核对根 README 显示：

```text
Report Studio v0.1.0
```

---

## 5. 当前原型快速验证

在正式 TypeScript MVP 尚未完全落地时，可先验证历史 UI 原型没有损坏。

```bash
cd tools/report-studio
npm test
npm run build
npm run verify:release
```

如本机已有 Chromium：

```bash
npm run verify:browser
```

历史原型可直接打开：

```text
tools/report-studio/dist/report-studio-prototype-v0.8.1.html
```

注意：该原型只用于 UI/交互回归，不是 v0.1.0 正式数据层，也不代表 DSH 已接通。

---

## 6. 正式 v0.1.0 Workspace 安装

当根 workspace 已按开发计划建立后，统一从仓库根目录安装：

```bash
corepack enable
pnpm install --frozen-lockfile
```

如果是首次建立 lockfile 的实现分支，可使用：

```bash
pnpm install
```

提交前必须生成并提交 lockfile。后续 Agent 不允许删除 lockfile 后重新解析依赖。

预期正式结构：

```text
apps/
└─ studio-dev-harness/

packages/
├─ studio-contracts/
├─ studio-core/
├─ studio-storage/
├─ studio-dsh-plugin/
├─ studio-ui/
└─ studio-testkit/
```

v0.1.0 第一阶段允许 `studio-ui` 暂时只实现 Outline + Draft；Layout 只保留入口和兼容边界。

---

## 7. 本地开发启动

最终根 `package.json` 必须提供稳定脚本。开发 Agent应将以下脚本视为 v0.1.0 的目标接口：

```bash
pnpm dev
pnpm build
pnpm typecheck
pnpm test
pnpm test:e2e
```

建议语义：

```text
pnpm dev        启动 studio-dev-harness 本地工作台
pnpm build      构建全部正式 packages / app
pnpm typecheck  TypeScript 全仓类型检查
pnpm test       contract + domain + storage + integration 单元/集成测试
pnpm test:e2e   浏览器端 Outline/Draft 主流程
```

若上述脚本尚未存在，**当前实现 PR 的职责之一就是建立它们**；不要让每个 Agent 使用不同命令启动项目。

---

## 8. 本地数据目录

正式业务数据不得写入浏览器 `localStorage` 作为事实源。

开发环境必须将数据根放在明确可识别的本地目录，例如：

```text
<repo>/.local/report-studio/
```

建议结构：

```text
.local/report-studio/
├─ control/
├─ objects/
├─ staging/
├─ derived/
├─ exports/
└─ logs/
```

`.local/` 必须加入 `.gitignore`。

正式接入 DSH Storage 后，物理路径应由 DSH/配置层解析，领域代码不得硬编码用户目录或 `~/.dsh`。

开发环境应支持显式覆盖，例如：

```bash
REPORT_STUDIO_DATA_DIR=/absolute/path/to/data pnpm dev
```

具体环境变量名称一旦在代码中落地，必须同步更新本文，不允许文档和实现各自维护一套名称。

---

## 9. DSH 接入部署

### 9.1 原则

```text
Report Studio UI
→ Studio Application API
→ DshStudioAdapter
→ 当前 DSH Session / Harness
```

必须满足：

- 普通悬浮 Agent 聊天进入当前 DSH Session；
- ReviewSubmission 进入同一 Session 的可追踪任务时间线；
- `studio_get_context` / `studio_apply_commands` 由 DSH Harness 调用；
- UI 不直接调用模型；
- Studio Tool 内部不再次调用模型；
- Agent 不能直接覆盖 Canonical Project State。

### 9.2 本地插件安装方式

由于 DSH 仍处于快速演进阶段，具体插件安装命令必须以实现时检测到的本机 DSH 版本为准。

开发 Agent需要完成并写入本文件的最终步骤应类似：

```bash
# 1. 构建 Studio DSH plugin
pnpm --filter studio-dsh-plugin build

# 2. 将本地产物安装/链接到当前 DSH profile
# <REAL_DSH_LOCAL_PLUGIN_COMMAND>

# 3. 启动/重载 DSH
# <REAL_DSH_START_OR_RELOAD_COMMAND>
```

**在真实 Spike 验证前，不允许用猜测的 DSH 命令冒充部署说明。**

完成 DSH Spike 的 PR 必须把占位符替换为经过本机验证的实际命令，并记录：

```text
DSH version
Profile
Plugin install command
Plugin reload command
Session binding evidence
Storage Provider
```

---

## 10. v0.1.0 本地验收步骤

### 10.1 基础启动

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm dev
```

浏览器打开终端输出的本地地址。

### 10.2 大纲验收

必须验证：

1. 创建项目；
2. 新增一级/二级大纲节点；
3. 修改标题；
4. 调整层级和顺序；
5. 刷新/重启后稳定 ID 不变；
6. 提交大纲批注给 Agent；
7. Proposal 不自动覆盖正式内容；
8. 接受后形成新 Revision。

### 10.3 草案验收

必须验证：

1. 大纲节点生成稳定 `pageId`；
2. 页面切换；
3. 编辑标题、正文、列表、讲解稿；
4. 本页素材引用可加载；
5. 对内容块添加批注；
6. draft 批注自动保存；
7. 首次提交形成 `ReviewRound + ReviewSubmission #1`；
8. Agent 未完全解决时继续在同一 Round 添加意见；
9. 再次提交形成 `ReviewSubmission #2`；
10. 两次 Submission 历史均可追溯且不可被覆盖；
11. 用户明确标记 resolved；
12. 重启后项目、Revision、批注和 Round 历史完整恢复。

### 10.4 DSH 验收

必须验证：

- 当前 Session 连续；
- 普通聊天可用；
- ReviewSubmission 可以投递；
- Studio Tool 调用出现在 DSH 可追踪事件中；
- Proposal 与对应 Submission / ReviewRun 关联；
- 不存在第二套 Agent Runtime。

---

## 11. 开发 Agent 必须执行的检查

任何实现 Agent 在声明“本地部署完成”前至少执行：

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

并记录实际结果。

若只修改历史原型，则还需：

```bash
cd tools/report-studio
npm test
npm run build
npm run verify:release
npm run verify:browser
```

不得以“页面能打开”代替正式验收。

---

## 12. 常见故障定位顺序

### 无法安装依赖

依次检查：

```text
Node 版本
→ corepack / pnpm 版本
→ packageManager
→ lockfile
→ registry / network
```

禁止直接删除 lockfile 作为第一处理方式。

### 页面打开但数据丢失

检查：

```text
REPORT_STUDIO_DATA_DIR
→ ControlStore
→ ProjectHead
→ RevisionRecord
→ Snapshot hash
```

不要先从 React State 或 localStorage 恢复正式数据。

### Agent 能聊天但不能修改内容

检查：

```text
DSH Session binding
→ ReviewSubmission
→ ReviewRun
→ studio_get_context
→ allowedCommands / writableIds
→ studio_apply_commands
→ Proposal
→ baseRevision / Head CAS
```

不要通过 UI 直接写状态绕过问题。

### 批注重复提交

检查：

```text
reviewRoundId
reviewSubmissionId
submissionNumber
idempotencyKey
ReviewRun
```

同一用户轮次允许多次 Submission，但同一个 Submission 的网络重试不得产生第二份业务任务。

### 重启后无法恢复

检查：

```text
ProjectHead
→ RevisionRecord
→ Canonical Snapshot
→ AnnotationDraftScopeRecord
→ ReviewRoundControlRecord
→ pending ReviewRun / Proposal
```

---

## 13. v0.1.0 与 v0.2.0 边界

### v0.1.0：必须可直接使用

```text
Outline
Draft
Page assets basic references
Annotations
ReviewRound / ReviewSubmission
DSH Agent
Proposal
Revision
Persistence / recovery
```

### v0.2.0：排版阶段

```text
LayoutPageDocument
OpenPencil / Layout Adapter
元素拖拽与样式
sourceRef live / detached / orphaned
草案 ↔ 排版同步
布局渲染
排版导出深化
```

因此部署 Agent 不得因为 v0.2.0 排版尚未开发而阻止 v0.1.0 大纲/草案版本发布。

---

## 14. 文档维护规则

本文件是 **v0.1.0 本地安装与部署权威说明**。

任何 PR 只要改变以下任意一项，就必须同步修改本文：

- Node / pnpm 版本；
- 根安装命令；
- dev/build/test 脚本；
- 环境变量；
- 数据目录；
- DSH 插件安装方式；
- DSH Profile / Storage Provider；
- 本地端口或启动地址；
- E2E 运行方式；
- 发布/升级/重启步骤。

**代码可以变化，但部署说明不得落后于可运行版本。**
