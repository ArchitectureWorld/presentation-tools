---
document_id: report-studio-v0.1.1-final-merge-gate
status: approved-for-main-merge-after-required-checks
product_version: 0.1.1
branch: feat/report-studio-v0.1.1-hardening
reviewed_head_before_this_record: 5edf7583dbae1117fb22ae683efffe494803c2a4
main_base: 804dbd4dfa7bafc9acd373e9ae51f2d02c9f1257
standard_version: 0.1.0
updated_at: 2026-09-04
---

# Report Studio v0.1.1 最终合并门禁

## 结论

Report Studio `0.1.1` 的“大纲 + 草案 + DSH Agent + Presentation Standard Project + Workspace Live Link”技术闭环已经完成。该版本可以在本文件提交后的 GitHub required checks 全部成功后，由 PR #6 合并进入 `main`。

本文件不把 v0.2.0 排版能力纳入 v0.1.1，也不修改 Presentation Standard Project Directory `0.1.0`。

```text
V0_1_1_TECHNICAL_GATE=PASS
V0_1_1_USER_AUTHORIZATION_FOR_ROUTE_A=YES
PR_6_REQUIRED_CHECKS=MUST_PASS_ON_FINAL_HEAD
V0_2_0_LAYOUT_INCLUDED=NO
PRESENTATION_CONTRACT_CHANGED=NO
```

## 组成证据

v0.1.1 最终候选由以下已经验证的阶段共同组成：

1. 核心稳定化、真实 DSH Shell 与真实 Provider Proposal 闭环：
   - `docs/acceptance/report-studio-v0.1.1-verification.md`
   - `docs/review/2026-09-03-report-studio-v0.1.1-review-blockers-resolution.md`
2. 当前 DSH Workspace 与 pre-design 标准项目的实时连接：
   - `docs/handoff/PRESENTATION_WORKSPACE_LIVE_LINK_IMPLEMENTATION.md`
3. 当前分支收口坐标：
   - reviewed HEAD: `5edf7583dbae1117fb22ae683efffe494803c2a4`
   - 本文件提交后的最终 PR HEAD 以 GitHub 为准，并必须重新通过 required checks。

## 已通过能力

- Canonical Snapshot、项目级 Revision 和 ProjectHead CAS；
- 稳定的 Project / Outline / Page / Draft / ContentBlock / ListItem / ScriptBlock / PageAsset / Asset ID；
- Blob ObjectStore，Canonical 与 Agent Context 不承载附件 Base64；
- Dirty Buffer、冲突处理、no-op Revision；
- ReviewRound / ReviewSubmission / ReviewRun / Proposal；
- 严格 Agent Command Schema、Scope 与 Proposal 确认；
- DSH `conversation.view`、同 Session 悬浮 Agent；
- Presentation Standard Project Directory 0.1.0 导入、导出与验证；
- 当前 Session Workspace 自动打开、Watcher、clean 自动更新和 dirty 冲突保护；
- `layouts/` 和 Workspace 其他非 Contract 文件不被 v0.1.1 Live Link 修改；
- Windows/Linux CI、当前 checkout 打包与隔离 DSH smoke。

## Node.js 边界

```text
Report Studio v0.1.1: Node.js >=22
Report Studio v0.2.0: planned Node.js >=24.11.0
```

v0.1.1 不提高 Node.js 下限，以保持已经验证的兼容承诺。OpenPencil 是 v0.2.0 能力，因此 Node.js `>=24.11.0` 只在 v0.2.0 支线合流后生效。

## pre-design 与 Project ID 边界

`projectId` 是 Presentation Standard Project Directory 0.1.0 已有的跨系统稳定身份：

```text
pre-design standard project
→ project.json.projectId
→ DraftPageDocument.projectId
→ Report Studio CanonicalSnapshot.project.projectId
→ v0.2.0 LayoutPageDocument.projectId
```

本次合流不得修改 pre-design Schema，也不得新建第二个 Project ID。后续 v0.2.0 只修正 Presentation 内部的 Project ID 传递接口，并增加端到端一致性测试。

```text
PROJECT_ID_STANDARD_IMPACT=NO_SCHEMA_CHANGE
PRE_DESIGN_CHANGE_REQUIRED=NO
CROSS_SYSTEM_ID_INVARIANT_TEST_REQUIRED=YES
```

## 合并规则

1. PR #6 的最终 HEAD 必须通过 `linux-verification`、`windows-verification` 和 Presentation Standard Project 检查。
2. PR 描述必须更新为当前事实，不再保留“CI 尚未完成、Provider 无效、main 未保护”等历史状态。
3. 使用 merge commit 保留稳定化历史；必须提供 expected head SHA，防止分支移动后误合并。
4. 合并后，以新的 `main` 为 v0.2.0 唯一基础；不得把 v0.2.0 代码回灌到 v0.1.1。
5. v0.2.0 支线吸收 main 后，先做联合回归、Node 升级和 Project ID 接口统一，再继续 OpenPencil Runtime 和生产排版接入。
