# Report Studio v0.1.1 稳定化整改设计

状态：执行中（Review blockers only）  
工作支线：`feat/report-studio-v0.1.1-hardening`  
Review 起点：`9d18fcb03b889d2db5002665d7c18362cc7399ed`  
Standard Contract：Presentation Standard Project Directory `0.1.0`，固定内容提交 `974668d308728386ea005c9e77d58ebff9372f0a`

## 1. 决策边界

本轮只做 v0.1.1 的安全收口，不增加排版、模板、母版、分页、动画或成品导出。DSH Harness 继续是唯一 Agent Runtime；Report Studio 不复制模型选择器、Provider 凭据或第二套 Session。

Presentation Standard Project Directory `0.1.0` 的正式 Schema、稳定 ID 规则、名称、版本和 Schema Set Hash 均保持冻结。整改只修复 Studio 的消费、持久化、验证和宿主集成。

## 2. 权威数据与存储

Canonical Snapshot 是可编辑项目内容的唯一事实源，正式保存 Project、OutlineNode、Page、ContentBlock、ListItem、ScriptBlock 和 PageAsset 的稳定身份及字段。UI 暂不支持的标准内容作为 opaque extension 无损保留，但不得与可编辑字段形成第二套竞争事实源。

Operational Store 保存 Annotation、ReviewRound、ReviewSubmission、ReviewRun、Proposal、迁移审计和状态机；Workspace View 保存阶段、当前页和局部界面状态。二者不得进入内容 Revision。

JSON 对象与二进制 Blob 均使用内容寻址 ObjectStore。二进制通过 staging 流式写入、哈希校验和原子发布进入 Blob Store；Canonical 只保存 ObjectRef，不保存 `dataBase64`、`dataUrl` 或文件字节。

## 3. Revision 与标准导入导出

普通内容修改使用 ProjectHead CAS。Candidate 与当前 Canonical 相同则返回 no-op，不创建 RevisionRecord、不前移 Head。

标准项目仅可导入全新空白 Workspace。导入通过专用 `initializeFromStandardProject()` 创建新的项目根：源 `projectId` 成为 ProjectHead，Revision 号为 0，父 Revision 及引用均为 null。非空 Workspace 返回 HTTP 409 和 `standard_import_requires_new_workspace`，且任何失败都不改变旧 Head。

标准导出写入唯一 staging 目录，恢复文件、更新 Manifest 并完成 Contract 全量验证后才原子发布。失败清理 staging，不覆盖既有导出，不产生可见半成品。

## 4. 编辑一致性

页面输入先进入按 Page 隔离的 Draft Edit Buffer，并维护 dirty/saving/conflict 状态。切页、切阶段、结构操作、批注、Submission、Proposal 接受、标准导入导出和 Agent 刷新前必须 flush。

保存失败或 `stale_revision` 时保留本地 Buffer，阻止后续破坏性导航，明确展示冲突，并提供重试或放弃。打开已有草案只改变 View；只有创建缺失草案时才产生内容 Revision。

## 5. Review、Command 与状态机

ReviewSubmission 冻结 project、stage、scope、page、baseRevision、批注快照、allowedCommands、writableIds 和 idempotencyKey。继续 ReviewRound 必须验证 open 状态及 scope/stage/page 一致。

`studio_get_context(submissionId)` 只返回该 Submission 所需的语义投影，不返回整个项目全文、标准归档、迁移备份、Workspace View 或二进制内容。

`studio_apply_commands` 使用严格判别式 Command Schema。创建 Proposal 前依次执行 Schema、project、Revision、Submission、scope、writableIds、risk、隔离 Candidate、不变量和 Before/After Diff 校验；任一步失败都不创建 Proposal。普通任务不允许 `outline.delete`。

Submission 状态只能沿以下边迁移：

```text
pending_dispatch -> dispatched -> proposal_created -> accepted | rejected | stale
pending_dispatch -> dispatch_failed -> pending_dispatch
```

ReviewRun 记录同一 Submission 在当前 DSH Session 的投递尝试、结果 Proposal 和错误。重复上报幂等，失败可恢复重投，watcher 只监听当前 submissionId/reviewRunId。

## 6. DSH 与 Session 边界

正式入口保持 DSH 根页面和当前 Session 的 `conversation.view`。DSH 原生外壳继续管理模型、推理等级、消息输入和 Session；Report Studio 恢复项目级悬浮 Agent，窗口绑定同一 Session，仅通过 DSH bridge 投递消息和 ReviewSubmission。

iframe API 使用短期 Session Capability；Capability 绑定 sessionId、插件实例、签发时间、过期时间和随机 nonce。若宿主 SDK 无法提供可靠身份绑定，则产品明确降级为 `local-single-user-only`、仅监听 `127.0.0.1`，不得宣称多人或网络共享安全。

## 7. 验证与发布边界

根项目提交精确 AJV 依赖和 lockfile。v0.1.1 CI 在 PR、普通支线 push、Windows 与 Linux 干净 checkout 中执行 `npm ci`、Contract 安装和 `verify:all`。vendor 必须从权威源码生成并零 diff；smoke 只安装当前 HEAD 刚生成的 tgz。

在 GitHub Actions、双平台干净 checkout、真实 DSH Shell、真实 Provider Proposal 闭环及 main required checks 全部有证据前，状态只能是 candidate/stabilization-required，不得声明可发布、可合并或生产可用。
