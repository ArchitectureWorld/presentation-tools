# Presentation Tools — Report Studio 0.2.0-alpha.3

当前开发分支为 `feat/report-studio-v0.2.0-layout`。Presentation 是可手工编辑的汇报工具：负责页面、内容块、批注、素材、布局渲染、检查、版本保存与标准目录交换。写作、叙事、视觉选择和排版 Skill 由 **Pre-design** 提供；会话、模型与 Agent 执行复用 **DSH**。

用户提交本轮修改要求后，Agent 通过受控工具直接修改，不再等待 Proposal 二次审批。内部旧字段 `proposals` / `proposalId` 暂作兼容操作记录，不代表审批步骤。AI 来源保留在内部资产与生成记录，不强制渲染来源标签，也不删除用户自己的图注。补图挂接中断时使用 `studio_resume_design_visual` 按原 `runId + pageId + sourceStateHash + requestId` 续接；不得换 requestId 重新付费生成。

本轮自动化源码与剩余验收范围见 [2026-09-11 开发交接](docs/handoff/2026-09-11-unattended-production.md)。历史绿色 CI 不能证明当前修订通过；安装前运行下面的完整验证命令。未经过真实 DSH 双插件验收，不合并 `main`、不发布 Release。

## 本轮自动化增量（开发态）

支持结构化 DesignIntent、`layout-dom-checks-v3` 真实预览、人工页面/元素锁定、可恢复批量任务、单页异常隔离及最终交付。DSH 调用工具推进全流程，Pre 负责设计与看图评审；Studio 不增加第二套模型调度或逐页审批。

`studio_next_design_batch` 只按当前来源匹配的已保存预览计算完成。最多100页、每页3次候选；恢复复用原候选与有效预览；锁定页单独计数。来源或检查版本过期会阻止应用与导出。与页面无关的新增素材不会使整套已完成页面失效。

**HTML、PDF、PPTX 当前均为通过检查的图像式页面**，保证与预览一致。PPTX不支持在PowerPoint内直接编辑每个文字框；PDF不是可搜索原生文字。另附 `source.json` 保留 Studio 内容与布局，未增加新的自动重导入格式。不存在“导出成功即专业质量通过”的承诺。

```sh
npm run verify:unattended
```

此命令用真实Chromium完成12页技术夹具，在第6页重启并验证原候选/预览复用，导出三种格式。它不是实模型DSH验收，也不是专业项目效果评分；完整验证仍为 `npm run verify:all`。

## 产品边界

```text
标准项目目录 0.1.0  ←→  Studio Adapter  ←→  Canonical Revision
                                              ├─ 大纲 / 草案 / 素材
                                              └─ DSH 批注任务 / 执行结果（运行态）
```

标准目录只承载可交换的项目内容；批注、Submission、Proposal、DSH Session、Head/CAS 和界面状态不会写入标准目录。这样既保持结构文件中立，也让当前 UI、产品架构和底层存储使用同一条受控数据链。

## 部署基线

```text
Branch: feat/report-studio-v0.2.0-layout
Report Studio: 0.2.0-alpha.3
DSH plugin: @architectureworld/report-studio-dsh@0.1.1
Tested DSH: 0.1.1-rc.2
Profile: web
Node.js: >=24.11.0
```

## 安装

```bash
git clone https://github.com/ArchitectureWorld/presentation-tools.git
cd presentation-tools
git checkout feat/report-studio-v0.2.0-layout
git pull --ff-only
npm ci
npm ci --prefix contracts/presentation-standard-project --ignore-scripts --no-audit --no-fund
npm run verify:all
npm run sync:vendor
git diff --exit-code -- packages/studio-dsh-plugin/vendor
mkdir -p .tmp/report-studio-pack
npm pack ./packages/studio-dsh-plugin --pack-destination .tmp/report-studio-pack
REPORT_STUDIO_PLUGIN_PACKAGE=.tmp/report-studio-pack/architectureworld-report-studio-dsh-0.1.1.tgz npm run smoke:dsh
dsh plugin --profile web add ./.tmp/report-studio-pack/architectureworld-report-studio-dsh-0.1.1.tgz
dsh --profile web --dump-config
dsh --profile web --no-open
```

正式入口统一为 `http://127.0.0.1:3080/`：先在 DSH 中选择或创建 Session，再点击会话顶部的 `Report Studio` 标签；模型和推理等级继续在 DSH 底部原生控制栏选择。不要把 `/report-studio/?sessionId=...` 作为安装后的默认入口。

会话头部的 `Report Studio · 独立打开` 只是带提示的备用动作。独立窗口不显示 DSH 模型、推理等级、Session 侧栏或主对话区。完整备份、升级和回滚说明见 [DSH_INSTALL.md](DSH_INSTALL.md)。

## A1.1 旧数据升级

检测到旧 `state.json` 时，工作台保持只读并显示“备份并升级”。只有用户确认后才会：

1. 逐字节备份旧文件；
2. 生成并持久化稳定 ID 映射；
3. 校验候选对象和引用；
4. 原子发布新 `control.json`。

旧 `state.json` 不会被覆盖或删除；失败时不会切换 Head，可使用同一映射重试。

## DSH 原生能力

```text
/report-studio              DSH 同源内部 UI/API 路由，不是正式入口
conversation.view           Report Studio 会话视图
session.header.actions      明确标注的独立打开备用动作
studio_get_context          按 Submission 冻结 Revision 读取上下文
studio_apply_commands       按任务范围幂等直接修改，返回逐条批注结果
```

正式模式不需要 `REPORT_STUDIO_AGENT_URL`，也不会启动第二套 Agent Runtime。

### Workspace Live Link

DSH 插件会把当前会话的 `SessionHeader.cwd` 作为唯一可信 Workspace，调用 `studio_open_workspace_project` 自动识别并全量验证其中的 Presentation Standard Project Directory `0.1.0`。浏览器不会提交任意绝对路径，插件也不会扫描磁盘或把 DSH Profile 误当成项目目录。

验证通过后，Workspace Live Link 读取大纲、页面草案、讲解稿、source materials 与正式 assets，并以默认 `750 ms` 项目级防抖监听 Contract 托管文件。连续写入、Windows rename 或目录替换都会先触发完整重扫；只有整个项目再次通过 Contract 验证后，才会向界面发布新候选。无效或未完成的上游写入会保留上一份合法快照，并在后续合法写入时自动恢复。

- 相对上次上游基线没有内容修改，且没有未保存编辑：可自动载入合法上游快照。
- 即使已经保存，只要内容偏离上次上游基线，就进入 `local_saved_conflict`；保留当前成果与上游候选。只有用户明确放弃本地修改才允许整份替换，历史 Revision 保留。
- 本地存在 dirty 编辑：绝不静默覆盖，用户可查看摘要、保存后重新加载、明确放弃后重新加载，或暂时保留当前版本。
- `layouts/` 始终由 Presentation 管理；Workspace 其他资料也不会被 Live Link 读取、删除或重建。
- 手动重新扫描可使用界面中的“重新读取 Workspace”或 DSH 工具 `studio_reload_upstream`。

正式入口仍是 `http://127.0.0.1:3080/`。切换 DSH Workspace 后应重新进入当前 Session 的 `Report Studio` 标签，不能继续使用上一个 Workspace 的内容。发布门禁：

```bash
npm run verify:workspace
```

成功时输出 `PRESENTATION_WORKSPACE_LIVE_LINK_PASS`。

### Session 安全边界

当前验证基线 DSH `0.1.1-rc.2` 的 `webServer` 只提供 HTTP 路由与监听地址，未提供可把 iframe 请求绑定到可信服务端 Session 身份的 capability hook。因此本版本明确运行在 `securityMode=local-single-user-only`：DSH Web 与独立调试服务都必须监听 `127.0.0.1`，配置为 `0.0.0.0` 会拒绝启动；不支持多人或网络共享安全，也不把 query `sessionId` 宣称为认证。`/api/health` 会返回 `securityMode`、`listenHost` 和 `networkSharedSecurity=false`。Agent 工具的 Session 仍只取自 DSH exec context，模型参数不能选择其他 Session。

## 验证

```bash
npm run verify:all
npm run sync:vendor
git diff --exit-code -- packages/studio-dsh-plugin/vendor
rm -rf .tmp/report-studio-pack
mkdir -p .tmp/report-studio-pack
npm pack ./packages/studio-dsh-plugin --pack-destination .tmp/report-studio-pack
REPORT_STUDIO_PLUGIN_PACKAGE=.tmp/report-studio-pack/architectureworld-report-studio-dsh-0.1.1.tgz npm run smoke:dsh
```

`verify:all` 覆盖单元/集成测试、Contract、迁移、并发 CAS、E2E、6 个浏览器视口和 DSH 静态集成；`smoke:dsh` 只安装 `REPORT_STUDIO_PLUGIN_PACKAGE` 明确指定的当前 checkout 新打 tarball，不会自动读取 `dist`。旧版曾验证人工接受 Proposal 的闭环，但该记录不证明本轮直接修改流程通过真实模型验收；本轮须另行验证主会话 → 直接修改 → 新 Revision → 重启恢复。

## 独立调试

```bash
npm start
```

独立开发服务默认监听 `127.0.0.1:4173`，只用于源码调试，不得作为正式部署入口。正式使用始终从 `http://127.0.0.1:3080/` 进入 DSH 原生界面。同一数据目录只允许一个 Node.js 进程写入。

<!-- PRESENTATION_STANDARD_PROJECT_V0_1_0_START -->

## Presentation 标准项目格式 0.1.0

中立 Contract 位于 [`contracts/presentation-standard-project`](contracts/presentation-standard-project)。它定义版本、稳定 ID、引用、目录和文件校验，不承担 Agent、审批、Revision、同步或调用方恢复职责。

```bash
npm ci --prefix contracts/presentation-standard-project --ignore-scripts --no-audit --no-fund
npm run verify:contracts
```

<!-- PRESENTATION_STANDARD_PROJECT_V0_1_0_END -->
