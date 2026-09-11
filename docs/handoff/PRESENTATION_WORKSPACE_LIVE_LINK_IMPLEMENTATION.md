# Presentation Workspace Live Link 实施交接

## 交付状态

本文件记录 Report Studio 0.1.1 在 `feat/report-studio-v0.1.1-hardening` 支线上的 Workspace Live Link 实施。代码、发布门禁、正式 Windows DSH Web Profile 部署与真实宿主验收已经完成；未经人工验收不得合并 `main`。

实施代码与 tgz 完整性绑定提交：`cc205b0f787703e4f10dc50362c5438e73f593a2`。真实宿主证据提交：`e22a83b86aae8737c2db0f28dd35912b6efd5a63`。最终跨平台验证修复提交：`9b9f8f4ac2d46c5dbc6a44a7a83126f04490c506`；该修复只让 Windows 测试以 `realpath()` 规范路径断言，没有修改运行时或发布产物。

## 固定坐标与不可变边界

- 产品：Report Studio 0.1.1
- 标准：Presentation Standard Project Directory
- Contract 0.1.0
- Contract 固定提交：`974668d308728386ea005c9e77d58ebff9372f0a`
- Schema Set SHA-256：`5bd329fcc8503ff7a48b3430e41b38dd264ae486cee7372a39cbbcccc2de2ebc`
- Workspace 来源：当前 DSH Session 的 `SessionHeader.cwd`
- Watcher 防抖：默认 `750 ms`

本轮不修改 Contract、Schema、Factory、Stable ID、sourceRefs 语义或 pre-design，也不把 DSH Session、同步状态、Proposal、Revision/CAS 或 Presentation 私有 UI 状态写入标准目录。

## 新增和修改文件

核心新增：

- `apps/studio-local/workspace-live-link.mjs`
- `apps/studio-local/workspace-live-link.test.mjs`
- `apps/studio-local/workspace-live-link-ui.test.mjs`
- `scripts/verify-workspace-live-link.mjs`
- `scripts/verify-workspace-live-link.test.mjs`

核心修改：

- `apps/studio-local/repository.mjs` 及测试
- `apps/studio-local/public/index.html`
- `apps/studio-local/public/app.js`
- `apps/studio-local/public/styles.css`
- `packages/studio-standard-adapter/index.mjs` 及测试
- `packages/studio-dsh-plugin/lib/index.js`
- `packages/studio-dsh-plugin/lib/runtime.js` 及测试
- `packages/studio-dsh-plugin/vendor/`
- `scripts/verify-dsh-plugin.mjs`
- `package.json`
- `README.md`
- `DSH_INSTALL.md`

## Workspace 获取与项目共享

DSH host 注入 `sessions`，Runtime 只从 `sessions.get(sessionId).header.cwd` 解析 Workspace。路径必须是非空绝对路径、存在的普通目录且根目录不是符号链接。浏览器和 Agent 不能指定其他本地路径，Runtime 不扫描磁盘。

Workspace 经过 `realpath` 规范化后，以规范路径的 SHA-256 作为 Report Studio 私有 Repository 键。同一 Workspace 的多个 Session 复用 Repository 和 Watcher；Session 切换 Workspace 时释放旧绑定并打开新项目。

入口：

- `studio_open_workspace_project`：打开当前 Session Workspace、检查 `project.json`、执行 Contract 全量验证并载入项目。
- `studio_reload_upstream`：重新扫描当前 Workspace，生成安全候选或返回结构化错误。
- HTTP：`GET /report-studio/api/workspace/status`
- HTTP：`POST /report-studio/api/workspace/reload`
- HTTP：`POST /report-studio/api/workspace/apply`

正式入口是 `http://127.0.0.1:3080/`，不是独立 `4173` 调试服务。

## Watcher 实现

Watcher 监听 Workspace 根目录以及 `pages/`、`pages/drafts/`、`source-materials/`、`assets/`，覆盖 Contract 托管的 manifest 与草案。任何 change、rename、文件缺失或目录替换只触发 `750 ms` 项目级防抖，之后重新扫描所有托管路径并执行 Contract 0.1.0 全量验证。

单个文件系统事件不等于一次完整提交。中间写入无效时保留最后合法快照并报告结构化状态，不污染 ProjectHead；后续合法写入可自动恢复。Workspace 切换或应用关闭时关闭 Watcher。

## dirty 冲突策略

- clean：合法上游候选自动应用，保持仍存在的 activePageId，并恢复纯 UI 的展开与滚动状态。
- dirty：固定提示“上游 Pre 内容已更新，但当前 Presentation 存在未保存修改。”，不自动覆盖。
- 用户动作：查看更新摘要、保存当前编辑后重新加载、放弃本地未保存修改并重新加载、暂时保留当前版本。
- 不执行语义自动合并，不依据 sourceRefs 自动删除本地内容。

## 内容所有权

Pre 可更新项目基础信息、规则、大纲、页面清单、草案、讲解稿、source-materials、assets 与 sourceRefs。Presentation 负责可视化、编辑交互、排版、导出、dirty 状态、冲突提示以及 `layouts/`。

Workspace Live Link 不读取、删除或重建 `layouts/`，不改动 Presentation 私有缓存，也不触碰 Workspace 中其他用户资料。

## 测试命令与当前结果

```powershell
node --test apps/studio-local/workspace-live-link.test.mjs
node --test scripts/verify-workspace-live-link.test.mjs
npm run sync:vendor
npm run verify:workspace
npm run verify:all
```

最终结果：

- Workspace parser/Watcher 聚焦测试：`9/9` 通过。
- 全量 Node 测试：`198/198` 通过。
- `npm run verify:ui`：`6/6` 视口通过。
- `npm run verify:dsh`：PASS。
- `npm run verify:workspace`：`22/22`，输出 `PRESENTATION_WORKSPACE_LIVE_LINK_PASS`。
- `npm run verify:all`：PASS。
- 隔离真实 DSH smoke：`5/5` 通过。
- 固定 Contract 提交和 Schema Set SHA-256：零漂移。
- tarball：`C:\pt-rvw-804dbd4\.tmp\report-studio-live-link-27e0f34\architectureworld-report-studio-dsh-0.1.1.tgz`，`98,673 bytes`，SHA-256 `F0414210B2CDFA9CFCE1D89430C39812AA7E60375744E2685F1AC90A04C48D91`。
- GitHub `Presentation Standard Project v0.1.0 CI` run 14：PASS。
- GitHub `Report Studio v0.1.1 CI` run 23：Windows 与 Linux job 均 PASS。

## Windows 人工测试结果

正式 Web Profile `C:\Users\2899\.dsh\profiles\web` 已安装上述 tgz；部署前完整备份位于 `C:\Users\2899\.dsh\backups\report-studio-live-link-pre-20260904-200807`，其中包含 `1,952` 个文件、`44,228,310 bytes` 和 `sha256.csv`。现有 `@architectureworld/dsh-preplanning-agent`、`dsh-openai-codex-login`、`dsh-free-search`、`dshmarket` 及 Report Studio 数据根均保留。

真实宿主验收使用：

- DSH 正式入口：`http://127.0.0.1:3080/`
- Session：`session-report-studio-live-link-acceptance`
- Workspace：`C:\pt-rvw-804dbd4\.tmp\host-acceptance-workspace-cc205b0`
- Project ID：`project_01992a80-0000-7000-8000-000000000101`

验收结果：

- DSH 会话侧栏、当前 Session、`Report Studio` 标签、原生消息输入框、模型选择器和访问/推理控制同时可见；点击标签后未离开 DSH 外壳。
- iframe 自动绑定当前 Session Workspace；Contract `0.1.0` 全量验证通过，Watcher 显示“监听中”，Contract 错误为“无”。
- clean 上游写入自动应用到 Pre Revision 50，没有手动刷新或跳转独立工作台。
- 制造真实草案乐观锁冲突后，本地未提交输入保持可见；再发布 Pre Revision 51 时没有覆盖本地内容，并显示“查看更新摘要 / 保存后重新加载 / 放弃后重新加载 / 暂时保留”四个动作。
- 执行“放弃后重新加载”后恢复为正式上游内容并应用 Pre Revision 51；当前 Workspace 状态为 `connected`、`hasUpstreamCandidate=false`。
- 停止并重新启动本机 DSH Node 服务后，Session、Workspace 绑定、Studio Revision 19 和已应用 Pre Revision 51 仍可读取；Tailscale 进程未停止。
- `/report-studio/api/health`：`version=v0.1.1`、`agentMode=dsh-native`、`agentConfigured=true`、`migrationStatus=ready`。
- 浏览器控制台 error：`0`。
- `layouts/acceptance-layout.json` SHA-256 仍为 `E56220902FA2769AD092DA7E8CE0312A7AC2C39342DE5C128F2DE42443BA5FF2`；`user-notes.txt` SHA-256 仍为 `00C8AEEF60E4677A4D9E777D50F0B78EAAC6A3E916B7C7B04E6406FCCC6754D6`。

截图证据：

- `C:\pt-rvw-804dbd4\.tmp\report-studio-live-link-27e0f34\host-restart-persistence-rev51.jpg`
- `C:\pt-rvw-804dbd4\.tmp\report-studio-live-link-27e0f34\host-clean-update-rev50.jpg`
- `C:\pt-rvw-804dbd4\.tmp\report-studio-live-link-27e0f34\host-dirty-conflict-rev51.jpg`
- `C:\pt-rvw-804dbd4\.tmp\report-studio-live-link-27e0f34\host-conflict-resolved-rev51.jpg`

## 已知边界

- 当前 DSH 基线为 `0.1.1-rc.2`，插件安全模式为 `local-single-user-only`，正式服务只监听 `127.0.0.1`。
- query `sessionId` 是本机单用户路由键，不是多人部署认证凭据。
- 原有绝对路径导入仅作为独立兼容能力；DSH 默认入口必须使用当前 Workspace。
- Presentation 产品版本与 Pre 产品版本相互独立。

## 回滚方式

停止正式 DSH Web 后，移除当前 `@architectureworld/report-studio-dsh@0.1.1`，恢复部署前完整 Web Profile 备份并重新启动。不得删除 `C:\Users\2899\.dsh\report-studio-v0.1.0` 数据根、旧 `state.json`、迁移备份或 Workspace 内容。详细命令见 `DSH_INSTALL.md`。

## 下一开发入口

从本支线最终已推送提交继续，先运行 `npm run verify:workspace` 与 `npm run verify:all`。如需扩展同步范围，必须先确认 Contract 托管边界；不得把 `layouts/`、其他 Workspace 资料或运行态字段加入 Pre 的写入范围。
