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
final_code_commit: 2ebe7e43bad1bb1d0de1e5fc037aa15184c05585
verification_status: verified
release_approval: pending-human-acceptance
updated_at: 2026-09-04
---

# Report Studio v0.1.1 Stabilization Handoff

## 已交接状态

Repository 为 `ArchitectureWorld/presentation-tools`；唯一工作支线为 `feat/report-studio-v0.1.1-hardening`。Review 起点为 `9d18fcb03b889d2db5002665d7c18362cc7399ed`，main 基线为 `804dbd4dfa7bafc9acd373e9ae51f2d02c9f1257`，最终代码 SHA 为 `2ebe7e43bad1bb1d0de1e5fc037aa15184c05585`。技术门禁已取得当前证据；`candidate` 只表示 PR #6 仍为 Draft，合并与发布必须等待人工验收。

真实 `web` Profile 已安装最终代码 SHA 的现场 tarball：39 files / 89,201 bytes / SHA-256 `322A13CCC0E0F7D76216EBB1DA67F60AF5C0F167425265256CB0EAEC9B2B8271`。同一 SHA 的 Linux CI artifact 为 39 files / 88,175 bytes / SHA-256 `A8782935C9C08BD70A4CC8269A8181E6C035A8B38933E5694FEAF2D561A58D7A`；二者分别通过内容清单、release-integrity 与 DSH smoke。GitHub push/PR Linux/Windows、真实 Provider 闭环和 main required checks 均已验证。

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

1. 只在当前支线、无历史 `node_modules` 的 checkout 执行根 `npm ci`、Contract `npm ci`、`npm run verify:all`、vendor zero-diff、现场 pack 和显式 tarball smoke。
2. 对 `C:\Users\2899\.dsh\profiles\web` 和 Report Studio 数据根做带 SHA-256 清单的精确备份；不触碰 `@architectureworld/dsh-preplanning-agent`、`dsh-openai-codex-login` 或用户数据。
3. 核验已解析的 `@architectureworld/report-studio-dsh/package.json` 不再指向旧 `link:` 来源；仅移除该目标插件，再添加本次现场生成 tgz。
4. 重启真实 Web Profile，在 `http://127.0.0.1:3080/` 从当前 DSH Session 进入 Report Studio；4173 不得充当部署入口。
5. 记录 health、原生壳、iframe、FAB、同 Session 消息、长批注 Proposal、控制台与重启持久化。真实 Provider 必须形成 Proposal，且只能在人工确认后产生新 Revision。

现场命令（POSIX shell）：

```bash
npm ci
npm ci --prefix contracts/presentation-standard-project --ignore-scripts --no-audit --no-fund
npm run verify:all
npm run sync:vendor
git diff --exit-code -- packages/studio-dsh-plugin/vendor
rm -rf .tmp/report-studio-pack
mkdir -p .tmp/report-studio-pack
npm pack ./packages/studio-dsh-plugin --pack-destination .tmp/report-studio-pack
REPORT_STUDIO_PLUGIN_PACKAGE=.tmp/report-studio-pack/architectureworld-report-studio-dsh-0.1.1.tgz npm run smoke:dsh
```

当前 Windows 现场包完整路径：`C:\pt-rvw-804dbd4\.tmp\report-studio-pack-2ebe7e4\architectureworld-report-studio-dsh-0.1.1.tgz`。部署前备份：`C:\Users\2899\.dsh\backups\report-studio-pre-2ebe7e4-20260904-173102`。

## 回滚边界

仅当安装后 DSH 无法恢复服务时，停止 DSH、移除目标 `@architectureworld/report-studio-dsh`、恢复本次 Web Profile 备份后重启。不要删除或覆盖 Session 数据、ObjectStore、preplanning-agent 或 login 插件。正常验收失败不回滚用户数据。

## 下一位执行者入口与合并判定

先读 [review resolution](../review/2026-09-03-report-studio-v0.1.1-review-blockers-resolution.md)、本 handoff 和当前 CI run。禁止新增分支、禁止 force push。自动化为 176/176、失败 0；push run `33858374268`、PR run `33858377994` 和 Standard run `33858377996` 均 success。真实 Provider 使用 Session `session-d8666c4f-f5e3-4028-89ae-d592e53bf06d` 完成 Proposal、人工接受、Revision `3 → 4` 与重启恢复；当前 health 为 `v0.1.1 / dsh-native / agentConfigured=true / migrationStatus=ready`，控制台新增错误为 0。

main 保护规则已启用 strict required checks、PR 必经和 `enforce_admins=true`；force push 与删除禁用。**合并判定：技术前置条件已满足，但治理决定仍为否**——PR #6 必须保持 Draft，等待用户人工验收后再决定是否转 Ready、合并或发布。
