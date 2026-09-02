# Report Studio 架构开发前自检报告

- 审查对象：`report-studio-architecture.md`
- 审查版本：`1.0.0`
- 审查方式：用户同意以多轮对抗自检替代当前不可用的独立 Agent 审查
- 审查结论：**PASS，可进入 MVP 开发**
- 文件 SHA-256：`b0d6e78632576ffc3983fd9afd33b73f04d15436521fb130b20d8bc073d8caa1`

## 1. 六轮审查结论

| 审查轮次 | 核心问题 | 结论 |
|---|---|---|
| 产品与领域边界 | 是否仍是通用汇报平台，是否被前期策划、Tiptap、OpenPencil 或 DSH Session 绑死 | 通过 |
| DSH 责任边界 | 是否错误自建 Agent、模型路由、Agent Loop 或隐藏上下文 | 通过 |
| Agent 读写协议 | 是否使用稳定 ID、冻结 baseRevision、明确可读/可写范围和对象级 Command | 通过 |
| 存储与崩溃一致性 | 无跨记录事务时，是否能保证旧版本或新版本二选一，不出现半提交 | 通过 |
| Schema、恢复与迁移 | 历史是否不可变、旧版本是否可读、回滚和便携包是否不破坏父链 | 通过 |
| MVP 颗粒度 | 是否过度建设，是否保留可验证的最小纵向闭环 | 通过 |

## 2. 对抗审查中发现并修正的问题

1. **批注提交曾隐含跨多个 Annotation 记录原子更新。** 已改为每个工作范围一个 `AnnotationDraftScopeRecord`，自动保存和提交切换均通过单记录 `update` 完成。
2. **Agent 上下文存在混读不同版本的风险。** 已固定读取 `ReviewBatch.baseRevision` 对应的冻结 Snapshot；Head 已前进时先返回 `stale_review_batch`。
3. **ProjectHead 曾存在重复 Head 版本或 Snapshot 指针。** 已只保留 `currentRevision + currentRevisionRef`，Snapshot 从 RevisionRecord 解析。
4. **Head 成功、二级幂等索引失败后可能重复提交。** RevisionRecord 现保存 `idempotencyKey + changeSetRef`，重试可从 Head 可达 Revision 恢复结果。
5. **已提交批注的长期可达性可能依赖二级索引。** Scope 现永久保存 `submittedBatchRefs`，另以 `pendingDispatchBatchRefs` 表达待投递队列。
6. **单版本便携包可能携带悬空 `parentRevisionRef`。** 已改为导入时创建新的根 Revision；只有完整历史包才复制父链。
7. **Canonical 内容与运行侧记录边界不够直观。** 已明确 `Revisioned Canonical Content` 与 `Operational / Derived Records`，只有前者进入 Snapshot 与导出。
8. **项目公共规则缺少最小结构。** 已增加 `ProjectRulesDocument`，同时明确模型、Agent Preset 和工具路由仍只属于 DSH 配置层。
9. **DSH Domain 返回对象引用可能被上层原地修改。** 已要求 `StudioControlStore` 返回只读投影、冻结对象或防御性副本，所有修改必须走 `update()`。
10. **Snapshot 哈希可能受 JavaScript 属性插入顺序影响。** 已要求使用 RFC 8785 兼容的规范化 JSON 或经合同测试证明等价的固定实现。

## 3. 协议故障模拟

使用独立的小型状态机脚本验证以下场景：

- Snapshot、ChangeSet、RevisionRecord 写入前后的五个崩溃窗口；
- Head 更新前故障保持旧正式版本；
- Head 更新后、索引更新前故障仍保持新正式版本；
- 同一 `baseRevision` 的两个写入最多一个成功；
- 回滚创建新的前向 Revision；
- ReviewBatch 已写但 Scope CAS 未执行时，draft 批注仍完整保留；
- 批注并发编辑会使旧 `scopeVersion` 提交失败；
- 已成功提交的 Scope 同时保留 submitted 与 pending 批次引用。

执行结果：

```text
protocol_simulation_cases=6
protocol_simulation_assertions=16
result=PASS
```

## 4. 全文机械校验

```text
status=development-baseline-frozen
version=1.0.0
review_status=multi-pass-self-review-passed
lines=2519
bytes=122039
code_fences=146
json_blocks=21
adrs=62
MVP_items=44
consistency_items=48
errors=0
warnings=0
```

机械校验覆盖：YAML 文档头、Markdown 代码围栏、全部 JSON 示例、主章节编号、ADR 连续性、MVP 验收编号、架构一致性编号、旧冲突字段和禁止术语扫描。

## 5. 未完成但不阻塞架构冻结的实现级验证

以下事项必须在开发中以 Spike 或 Adapter 验证，但失败时只替换实现，不推翻核心架构：

- DSH 独立工作台的正式 UI Slot 与路由；
- ReviewBatch 投递当前 DSH Session 的稳定接口；
- OpenPencil 嵌入、中文文字、节点映射和渲染一致性；
- `dsh-storage-sqlite` 的真实 CAS、重启恢复和多 Session 冲突测试；
- StudioObjectStore 在 Windows、macOS、Linux 上的 durable publish；
- 大页面、大素材和长 Revision 历史的性能阈值；
- 排版预览作为 DSH Artifact Reference 的读取方式。

## 6. 最终准入意见

架构已经具备开始 MVP 开发所需的最小稳定边界。开发应先完成一条纵向闭环，而不是横向铺满功能：

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

任何实现只完成三张静态 UI、绕过 Studio Command Gateway、直接修改编辑器私有 JSON，或在对象 durable publish 前更新 Head，都不得通过“最小架构基线验收”。
