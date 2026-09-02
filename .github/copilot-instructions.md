# Copilot Code Review Instructions

当审查 `docs/report-studio-storage-version-review.md` 时，请将其视为规范性架构文档，而不是普通说明文字。

请使用中文，只评论会造成下列后果的具体问题：

- 数据丢失、半提交、错误覆盖或无法恢复；
- 对 DSH Storage Domain 跨记录事务能力作了不存在的假设；
- ProjectHead、RevisionRecord、Snapshot、ChangeSet 或 Hash 之间可能不一致；
- 崩溃恢复、幂等重试、并发写入、Schema 迁移或 GC 存在不可封闭的失败路径；
- Annotation / ReviewBatch / Proposal 与正式 Revision 的状态可能失配；
- 方案明显超过 MVP 所需，或把 Provider 细节泄漏进 Canonical Model；
- 与“DSH Harness 是唯一 Agent 执行面”发生冲突。

不要评论标点、措辞、Markdown 风格或 UI。每条意见必须包含：严重级别、对应小节、可复现失败场景、最小修正建议。没有阻断项时，请明确写出“未发现阻断开发的问题”，并把需要实现测试确认的内容标为非阻断验证项。
