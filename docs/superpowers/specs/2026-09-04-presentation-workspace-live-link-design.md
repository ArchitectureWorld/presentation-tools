# Presentation Workspace Live Link Design

## 目标与边界

Report Studio v0.1.1 在 DSH 中以当前 Session 的 `SessionHeader.cwd` 作为唯一 Workspace 根目录，直接读取该目录中的 Presentation Standard Project Directory 0.1.0。运行层不得修改 Contract、Schema、Stable ID、pre-design，也不得把 DSH Session、同步状态、ProjectHead、Revision/CAS 或 UI 状态写回标准目录。

固定坐标：Contract `974668d308728386ea005c9e77d58ebff9372f0a`，Schema Set SHA-256 `5bd329fcc8503ff7a48b3430e41b38dd264ae486cee7372a39cbbcccc2de2ebc`，产品版本保持 `0.1.1`。

## 架构

### Workspace 解析与项目共享

DSH host 注入 `sessions`，通过 `ctx.sessions.get(sessionId).header.cwd` 获取当前 Workspace。路径必须是非空绝对路径、实际存在的普通目录且根目录不是符号链接。浏览器只传递 `sessionId`，不能提交任意本地路径给 Live Link。

Runtime 对 Workspace 做 `realpath` 规范化，并以规范路径 SHA-256 作为私有 Repository 目录键。多个 Session 指向同一 Workspace 时复用同一个 Repository 和 Watcher；Session 切换 Workspace 时重新绑定，不继续显示旧 Workspace 内容。没有 Workspace 或没有 `project.json` 时返回结构化空状态，保留既有私有数据但不将其伪装成当前 Workspace 项目。

### 稳定快照与监听

`workspace-live-link.mjs` 负责：

- 检查 `project.json`；
- 调用固定 Contract 0.1.0 的 `validateProjectDirectoryWithAjv()` 全量验证；
- 通过 Standard Adapter 读取 Canonical Snapshot；
- 只归档 manifests 声明的 `source-materials/` 与 `assets/` 文件，不读取 `layouts/` 或 Workspace 其他资料；
- 对 Canonical Snapshot 计算稳定 SHA-256 指纹；
- 从所有 `sourceRefs` 收集来源明细，并以最高有效数值显示 Pre Revision。

Watcher 监听 Workspace 根及 `pages/`、`pages/drafts/`、`source-materials/`、`assets/`。任何 `rename`、`change`、缺失或目录重建事件仅触发 750ms 项目级防抖；防抖后重新扫描完整托管路径、全量验证并重建必要 watcher。中间无效状态不发布，继续保留最后合法快照并等待下一次事件自动恢复。

### 上游发布与冲突

Watcher 得到合法新快照后只保存为候选，不立即覆盖 Repository。浏览器周期读取同步状态：

- 本地无 dirty：自动请求应用候选；
- 本地有 dirty：保留当前内容，显示固定冲突提示和更新摘要；
- “保存当前编辑后重新加载”：先 flush 草案，再应用候选；
- “放弃本地未保存修改并重新加载”：明确清空 Draft Buffer 后应用候选；
- “暂时保留当前版本”：只关闭提示，候选仍可从状态入口恢复。

Repository 首次载入使用项目根 Revision 0；同 Workspace 后续合法快照使用 `workspace_upstream` 内容 Revision 发布，保持 Operational 数据。仍存在的 `activePageId` 被保留；页面已删除时回退到首个合法页面。所有同步元数据存放在 Report Studio 私有运行状态，不写入标准目录。

### API 与 UI

DSH tools：

- `studio_open_workspace_project`：按当前 Agent Session 打开并验证 Workspace 项目；
- `studio_reload_upstream`：重新扫描并暂存或应用合法上游快照。

HTTP：

- `GET /report-studio/api/workspace/status`；
- `POST /report-studio/api/workspace/reload`；
- `POST /report-studio/api/workspace/apply`。

主界面顶部增加低干扰同步状态按钮；详情面板显示 Workspace、Project ID、标准版本、指纹、Pre Revision、来源明细、最近读取时间、监听状态和结构化验证错误，并提供重新读取与冲突处理按钮。独立绝对路径导入继续作为兼容入口，但不作为 DSH 默认流程。

## 错误与安全

Live Link 使用 Studio 私有错误码：`workspace_unavailable`、`workspace_project_missing`、`workspace_contract_invalid`、`workspace_switch_required`、`workspace_upstream_conflict`、`workspace_watcher_disconnected`。无效或半写状态永远不改变 ProjectHead；Workspace 根以外的路径、符号链接根和浏览器传入路径均被拒绝。

## 验证

自动化覆盖需求中的 22 项最低测试，并新增 `npm run verify:workspace`。成功必须打印 `PRESENTATION_WORKSPACE_LIVE_LINK_PASS`。之后运行现有 `npm run verify:all`、同步 vendor、双平台 GitHub CI、当前 tarball DSH smoke，并在 Windows 真实 DSH Workspace 中验证自动打开、合法刷新、dirty 冲突、恢复监听及 `layouts/`/其他文件不变。
