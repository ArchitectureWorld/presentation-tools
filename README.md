# Report Studio / presentation-tools

本分支保存 **Report Studio 通用汇报工作台 MVP 开发前冻结基线 v1.0.0**。

## 从这里开始

1. [MVP 开发交接文件](docs/handoff/2026-09-02-report-studio-mvp-development-handoff.md)
2. [唯一架构母文件](docs/architecture/report-studio-architecture.md)
3. [架构开发前自检报告](docs/review/report-studio-architecture-self-review.md)
4. [机械校验结果](docs/review/report-studio-architecture-verification.txt)

## 当前状态

```text
architecture_baseline=1.0.0
status=development-baseline-frozen
approved_for=mvp-development
review_method=user-approved-adversarial-self-review
```

本项目是通用的按页汇报内容生产与排版平台，不绑定“前期策划”或其他单一业务。DSH Harness 是唯一 Agent / Model 执行面；Report Studio 提供结构化项目事实、稳定 ID、批注、Studio 工具、Command、Proposal、Revision、ProjectHead、素材和排版能力。

首个 MVP 必须打通：

```text
大纲节点
→ 稳定 pageId
→ 结构化草案
→ draft 批注自动保存
→ ReviewBatch
→ DSH Harness 调用 Studio 工具
→ Proposal / Candidate
→ ProjectHead 正式 Revision
→ live 排版同步
```

只实现三张静态 UI 不属于最小架构基线验收。
