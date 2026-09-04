---
document_id: report-studio-v0.1.1-review-blockers-resolution
status: candidate
verification_status: stabilization-required
branch: feat/report-studio-v0.1.1-hardening
review_start: 9d18fcb03b889d2db5002665d7c18362cc7399ed
main_base: 804dbd4dfa7bafc9acd373e9ae51f2d02c9f1257
updated_at: 2026-09-04
---

# Report Studio v0.1.1 Review Blockers Resolution

## 阅读方式与结论边界

此文件记录本支线对 2026-09-03 blocker review 的代码级处置。它不是发布批准、main 合并批准或真实 Provider 验收记录。只有当前 HEAD 的 Windows/Linux clean checkout、GitHub Actions、真实 DSH Web Shell、真实 Provider Proposal 闭环和 main required checks 分别取得可追溯证据后，才能改变本文件的 `candidate / stabilization-required` 状态。

| 问题 | 原问题 | 修复与文件范围 | 修复提交 | 自动化证据 | 状态 |
|---|---|---|---|---|---|
| P0-01 | clean install 缺 AJV、CI 和 smoke 未固定当前 tarball | 根 lockfile、v0.1.1 workflow、release integrity、fresh package smoke | `627bb7f`, `3fa7312` | `release-integrity.test.mjs`、CI matrix | partially-fixed：GitHub 当前 run 待记录 |
| P0-02 | 标准项目会跨 projectId 接到既有 Revision 链 | `initializeFromStandardProject()`、非空 Workspace 409、UI 提示 | `d883358` | `standard-project.test.mjs`、server import tests | fixed（代码）；宿主验收待记录 |
| P0-03 | 附件字节可落入 Canonical / Agent context | Blob ObjectStore、受控 asset API、projection scrub | `7ef4cf5`, `de19cef`, `71294f7`, `7dc05e3` | 20MB、export hash、context scrub tests | fixed（代码）；GitHub 待记录 |
| P0-04 | Canonical 中存在竞争副本和身份漂移 | Canonical projection、stable IDs、Adapter 轮转 | `18f9d2c`, `a0c8d03`, `b2e9aa9`, `2adca59` | canonical / adapter regression tests | fixed（代码）；GitHub 待记录 |
| P0-05 | export staging 可能覆盖或留下半成品 | unique staging、claim/final publish、失败清理 | `4e50e76`, `24df691`, `65afcfc`, `c7166fe` | standard export tests | fixed（代码）；GitHub 待记录 |
| P0-06 | dirty edit、stale save、no-op Revision 语义不可靠 | page buffer、flush guard、CAS/no-op、caption save | `684b500`, `b5bd72f`, `d0bc441` | editor/server/domain regressions | fixed（代码）；真实浏览器待记录 |
| P0-07 | Submission/Command 的 scope、schema、context 过宽 | frozen submission、closed command schema、context whitelist | `3ff1991`, `0e181b6` | contracts/review/context regressions | fixed（代码）；真实 Provider 待记录 |
| P0-08 | Submission 状态可倒退、投递没有稳定运行关联 | monotonic lifecycle、ReviewRun、retry / watcher isolation | `a57d201` | review lifecycle and restart tests | fixed（代码）；真实 Provider 待记录 |
| P0-09 | 原生 DSH 壳中隐藏了项目悬浮 Agent | 恢复同 Session FAB/modal，并保留 DSH 原生模型控件 | `4b9db99`, `474e3f0` | DSH plugin static integration | partially-fixed：真实 Shell 人工验收待记录 |
| P1-01 | iframe URL sessionId 不能成为网络授权 | `local-single-user-only`、loopback guard、exec-context Session | prior baseline + current tests | server/plugin security tests | deferred：可信 server capability 暂无 DSH hook |
| P1-02 | vendor 和包来源可能漂移 | prepack sync、vendor manifest、current-HEAD tarball integrity | `627bb7f`, `3fa7312` | release integrity + smoke | partially-fixed：现场 pack/安装待记录 |
| P1-03 | 文档把候选态描述为已验证/生产基线 | README、DSH 安装说明、架构母文件与本文件 | documentation commit after this file | docs consistency review | fixed（文档）；外部验收状态仍待记录 |

## 运行时与数据边界

- 正式入口只能是 `http://127.0.0.1:3080/` 的 DSH Web 根页面；`4173` 仅用于源码调试。
- `@architectureworld/dsh-preplanning-agent`、`dsh-openai-codex-login` 和用户 Session 数据不是本整改的可修改对象。
- 正式 Web Profile 更新前必须备份 profile 配置、Report Studio 数据根与 SHA-256 清单；仅在插件更新导致服务不能恢复时使用该备份，正常验收不得回滚用户数据。
- `TRANSPORT / fetch failed` 是外部 Provider 阻断，不能标成 Proposal 闭环通过。

## 尚待关闭的外部门槛

1. 当前 HEAD push 后的 GitHub Actions Linux/Windows clean checkout。
2. main required checks 的实际配置权限和结果。
3. 真实 3080 DSH Shell 中当前 Session iframe、原生控件、FAB、消息区、长批注 Proposal 归属与重启持久化。
4. 真实目标 Provider 的 `ReviewSubmission → studio_get_context → studio_apply_commands → Proposal → 接受 → 新 Revision → 重启恢复`。

详细命令、产物、真实宿主和 CI 结果写入 `.superpowers/sdd/2026-09-03-report-studio-v0.1.1-stabilization/task-10-report.md`；最终运维入口写入 handoff。
