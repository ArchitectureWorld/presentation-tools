---
document_id: report-studio-v0.1.1-review-blockers-resolution
status: candidate
verification_status: verified
release_approval: pending-human-acceptance
branch: feat/report-studio-v0.1.1-hardening
review_start: 9d18fcb03b889d2db5002665d7c18362cc7399ed
main_base: 804dbd4dfa7bafc9acd373e9ae51f2d02c9f1257
updated_at: 2026-09-04
---

# Report Studio v0.1.1 Review Blockers Resolution

## 阅读方式与结论边界

此文件记录本支线对 2026-09-03 blocker review 的处置和验证证据。最终代码 SHA 为 `2ebe7e43bad1bb1d0de1e5fc037aa15184c05585`；Windows/Linux、GitHub Actions、真实 DSH Web Shell、真实目标 Provider Proposal 闭环和 main required checks 均已有可追溯证据。`candidate` 表示 PR #6 仍为 Draft、尚未获得人工合并或发布批准，不表示存在未关闭的技术阻断。

| 问题 | 原问题 | 修复与文件范围 | 修复提交 | 自动化证据 | 状态 |
|---|---|---|---|---|---|
| P0-01 | clean install 缺 AJV、CI 和 smoke 未固定当前 tarball | 根 lockfile、v0.1.1 workflow、release integrity、fresh package smoke；Standard workflow 补根依赖；Report Studio workflow 补 Python/固定 pnpm、DSH workspace-root smoke 与 Chromium readiness | `627bb7f`, `3fa7312`, `32d25c2`, `33e24ff`, `c040df9`, `d49f2ba`, `f935326`, `6b93b12` | 176/176；push run `33858374268` 与 PR run `33858377994` 的 Linux/Windows 全绿 | fixed |
| P0-02 | 标准项目会跨 projectId 接到既有 Revision 链 | `initializeFromStandardProject()`、非空 Workspace 409、UI 提示 | `d883358` | `standard-project.test.mjs`、server import tests、完整 E2E | fixed |
| P0-03 | 附件字节可落入 Canonical / Agent context | Blob ObjectStore、受控 asset API、projection scrub | `7ef4cf5`, `de19cef`, `71294f7`, `7dc05e3` | 20MB、export hash、context scrub tests | fixed |
| P0-04 | Canonical 中存在竞争副本和身份漂移 | Canonical projection、stable IDs、Adapter 轮转 | `18f9d2c`, `a0c8d03`, `b2e9aa9`, `2adca59` | canonical / adapter regression tests | fixed |
| P0-05 | export staging 可能覆盖或留下半成品 | unique staging、claim/final publish、失败清理 | `4e50e76`, `24df691`, `65afcfc`, `c7166fe` | standard export tests | fixed |
| P0-06 | dirty edit、stale save、no-op Revision 语义不可靠 | page buffer、flush guard、CAS/no-op、caption save | `684b500`, `b5bd72f`, `d0bc441` | editor/server/domain regressions + 6 viewport browser gate | fixed |
| P0-07 | Submission/Command 的 scope、schema、context 过宽 | frozen submission、closed command schema、context whitelist；Review prompt 明确合法 command 字段 | `3ff1991`, `0e181b6`, `2ebe7e4` | contracts/review/context regressions + 真实 Provider command 闭环 | fixed |
| P0-08 | Submission 状态可倒退、投递没有稳定运行关联 | monotonic lifecycle、ReviewRun、retry / watcher isolation | `a57d201` | review lifecycle、真实 Provider、接受与重启恢复 | fixed |
| P0-09 | 原生 DSH 壳中隐藏了项目悬浮 Agent | 恢复同 Session FAB/modal，并保留 DSH 原生模型控件 | `4b9db99`, `474e3f0` | DSH plugin static integration + 真实 Shell | fixed |
| P1-01 | iframe URL sessionId 不能成为网络授权 | `local-single-user-only`、loopback guard、exec-context Session | prior baseline + current tests | server/plugin security tests | deferred：可信 server capability 暂无 DSH hook |
| P1-02 | vendor 和包来源可能漂移 | prepack sync、vendor manifest、current-HEAD tarball integrity | `627bb7f`, `3fa7312`, `1676abd`, `6b93b12` | vendor zero-diff + 当前 SHA 的 39-file 本地/CI tarball | fixed |
| P1-03 | 文档把候选态描述为已验证/生产基线 | README、DSH 安装说明、架构母文件、本文件与 handoff | 当前文档收尾提交 | 文档一致性搜索 + 完整门禁 | fixed；合并/发布仍待人工批准 |

## 运行时与数据边界

- 正式入口只能是 `http://127.0.0.1:3080/` 的 DSH Web 根页面；`4173` 仅用于源码调试。
- `@architectureworld/dsh-preplanning-agent`、`dsh-openai-codex-login` 和用户 Session 数据不是本整改的可修改对象。
- 正式 Web Profile 更新前必须备份 profile 配置、Report Studio 数据根与 SHA-256 清单；仅在插件更新导致服务不能恢复时使用该备份，正常验收不得回滚用户数据。
- 旧 `TRANSPORT / fetch failed` 只属于 2026-09-03 的历史验收；当前真实目标 Provider 已在同一 DSH Session 中完成闭环。

## 尚待人工决定的发布动作

1. PR #6 保持 Draft；人工验收前不得合并 `main` 或创建 GitHub Release。

## 2026-09-04 当前宿主证据

- 真实 `web` Profile 已部署最终代码 `2ebe7e43bad1bb1d0de1e5fc037aa15184c05585`；部署前备份为 `C:\Users\2899\.dsh\backups\report-studio-pre-2ebe7e4-20260904-173102`。
- 现场 tarball 为 `C:\pt-rvw-804dbd4\.tmp\report-studio-pack-2ebe7e4\architectureworld-report-studio-dsh-0.1.1.tgz`，39 files、89,201 bytes、SHA-256 `322A13CCC0E0F7D76216EBB1DA67F60AF5C0F167425265256CB0EAEC9B2B8271`。
- 迁移数据的 Revision 9 在部署后和重启后均可读，真实记录保持为 1 page / 4 annotations / 2 rounds / 3 submissions / 1 ReviewRun / 1 proposal；这是当前真实数据，不回写为旧附件中的历史计数。
- 真实浏览器复核确认 Proposal 位于对应“第 1 次提交”底部，“待确认 1”可把“确认应用”滚动到可视区；DSH 原生模型与输入区仍在外壳中，iframe 内没有复制模型控件。
- 真实目标 Provider 使用 Session `session-d8666c4f-f5e3-4028-89ae-d592e53bf06d` 完成 `ReviewSubmission → studio_get_context → studio_apply_commands → pending Proposal`；人工确认后 Revision `3 → 4`，标题更新为“验收页面：Agent Proposal 已生成”。DSH 重启后 Proposal 与 ReviewRun 均为 `accepted`，控制台新增错误为 0。
- 当前 health 回读为 `version=v0.1.1`、`agentMode=dsh-native`、`agentConfigured=true`、`migrationStatus=ready`、`securityMode=local-single-user-only`、`listenHost=127.0.0.1`。

## 2026-09-04 CI 跟进

- 最终代码提交 `2ebe7e4`：push run [`33858374268`](https://github.com/ArchitectureWorld/presentation-tools/actions/runs/33858374268) 与 PR run [`33858377994`](https://github.com/ArchitectureWorld/presentation-tools/actions/runs/33858377994) 均为 Linux/Windows success；Standard Project run [`33858377996`](https://github.com/ArchitectureWorld/presentation-tools/actions/runs/33858377996) success。
- main branch protection 已回读：`strict=true`，required checks 为 `linux-verification`、`windows-verification`，`required_pull_request_reviews` 已启用，`required_approving_review_count=0`，`enforce_admins=true`；force push 和 branch deletion 均禁用。PR #6 保持 Draft，未合并。
- Linux CI artifact：39 files / 88,175 bytes / SHA-256 `A8782935C9C08BD70A4CC8269A8181E6C035A8B38933E5694FEAF2D561A58D7A`。平台间 tgz 字节差异来自换行与打包环境，两个包均分别通过同一 release-integrity、安装 smoke 和内容清单验证。

详细命令、产物、真实宿主和 CI 结果写入 [验收记录](../acceptance/report-studio-v0.1.1-verification.md)；最终运维入口写入 handoff。
