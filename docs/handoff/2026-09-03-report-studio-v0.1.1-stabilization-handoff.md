---
document_id: report-studio-v0.1.1-stabilization-handoff
status: candidate
branch: feat/report-studio-v0.1.1-hardening
review_start: 9d18fcb03b889d2db5002665d7c18362cc7399ed
main_base: 804dbd4dfa7bafc9acd373e9ae51f2d02c9f1257
report_studio_version: 0.1.1
presentation_standard_version: 0.1.0
contract_commit: 974668d308728386ea005c9e77d58ebff9372f0a
schema_set_sha256: 5bd329fcc8503ff7a48b3430e41b38dd264ae486cee7372a39cbbcccc2de2ebc
updated_at: 2026-09-04
---

# Report Studio v0.1.1 Stabilization Handoff

## 已交接状态

Repository 为 `ArchitectureWorld/presentation-tools`；唯一工作支线为 `feat/report-studio-v0.1.1-hardening`。Review 起点为 `9d18fcb03b889d2db5002665d7c18362cc7399ed`，main 基线为 `804dbd4dfa7bafc9acd373e9ae51f2d02c9f1257`。本 handoff 随所在提交一起更新；部署来源 SHA、tarball SHA-256、测试、宿主和 CI 的实际结果见同一次 Task 10 报告，不能由本文件的候选状态推导为发布许可。

当前可部署代码提交为 `1676abd3737e6fda53bd97918c5b7c2d746bc178`；对应现场 tarball 是 39 files / 88,476 bytes / SHA-256 `f6b4fc6a81dcf01df51dd66d071c0969d930a4a605d5764af890d9ff2ad24748`。它已在真实 Web Profile 部署；代码、完整验证与宿主迁移读取证据见 Task 10 报告，GitHub Actions、main required checks 和真实 Provider 闭环仍是独立门槛。

## 架构与兼容性

- Canonical 只保存可编辑项目内容及 ObjectRef；Operational 保存 Annotation、ReviewRound、ReviewSubmission、ReviewRun、Proposal 与迁移审计；Workspace View 不进入内容 Revision。
- ObjectStore 使用内容寻址 JSON/Blob、staging、哈希校验和原子发布。二进制、Data URL、完整 archive 与私有 View 不进入 Canonical 或 Agent Context。
- A1.1 旧数据采取备份优先迁移，保留 `state.json`，以稳定 migration-map 生成 `control.json`；不同 projectId 不可进入同一 Revision 父子链。
- 标准项目仅能初始化全新空白 Workspace；非空 workspace 返回 409 `standard_import_requires_new_workspace`。导出在唯一 staging 目录完成 Contract 验证后发布。
- 普通编辑先经过按页 Draft Buffer；flush 失败和 `stale_revision` 必须保留本地修改且阻止破坏性导航；Canonical no-op 和 View 切换不创建 Revision。
- 术语固定：ReviewRound 是用户可见一轮，ReviewSubmission 是该轮内不可变提交，ReviewRun 是该 Submission 的 DSH 投递关联。
- `studio_get_context(submissionId)` 只输出 Submission 需要的语义投影；`studio_apply_commands` 先做 closed-schema、project/revision/scope/writable/risk 和 isolated candidate 校验，失败不创建部分 Proposal；普通权限不含 `outline.delete`。
- DSH Harness 是唯一 Runtime。Report Studio 以当前 Session 的 `conversation.view` 呈现，保留同 Session 悬浮 Agent；模型、推理等级与输入框属于 DSH 原生外壳。

## API 与错误码

新增或收紧的运行边界包括 `standard_import_requires_new_workspace`（HTTP 409）、`stale_revision`、`migration_required`、`migration_failed` 和 `local-single-user-only`。插件只允许 loopback Web listener；query `sessionId` 不是认证令牌，Agent Session 从 DSH exec context 获取。没有 DSH capability hook 前，不得宣称多人或网络共享安全。

## 部署顺序

1. 只在当前支线、无历史 `node_modules` 的 checkout 执行 `npm ci`、Contract `npm ci`、`npm run verify:all`、vendor zero-diff、现场 pack 和 smoke。
2. 对 `C:\Users\2899\.dsh\profiles\web` 和 Report Studio 数据根做带 SHA-256 清单的精确备份；不触碰 `@architectureworld/dsh-preplanning-agent`、`dsh-openai-codex-login` 或用户数据。
3. 核验已解析的 `@architectureworld/report-studio-dsh/package.json` 不再指向旧 `link:` 来源；仅移除该目标插件，再添加本次现场生成 tgz。
4. 重启真实 Web Profile，在 `http://127.0.0.1:3080/` 从当前 DSH Session 进入 Report Studio；4173 不得充当部署入口。
5. 记录 health、原生壳、iframe、FAB、同 Session 消息、长批注 Proposal、控制台与重启持久化。Provider 有 `TRANSPORT/fetch failed` 时记录为外部阻断。

## 回滚边界

仅当安装后 DSH 无法恢复服务时，停止 DSH、移除目标 `@architectureworld/report-studio-dsh`、恢复本次 Web Profile 备份后重启。不要删除或覆盖 Session 数据、ObjectStore、preplanning-agent 或 login 插件。正常验收失败不回滚用户数据。

## 下一位执行者入口与合并判定

先读 [review resolution](../review/2026-09-03-report-studio-v0.1.1-review-blockers-resolution.md)、Task 10 报告和 CI run。禁止新增分支、禁止 force push、禁止合并 main。当前合并判定为 **否**：仍需 GitHub Linux/Windows 当前 run、真实 Provider 闭环和 main required checks 的可验证证据。自动化测试总数、失败数、最终 SHA、Actions Run、tarball 清单及 DSH Shell 结果必须以 Task 10 的现场输出为准。
