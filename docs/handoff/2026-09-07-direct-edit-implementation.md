# 直接修改与双项目边界：开发交接 v1.1

## 唯一开发分支

Studio：`feat/report-studio-v0.2.0-layout`。Pre：`feat/pre-v2.0.0`。不得新建分支，不强推、不合并 main、不发布、不操作生产 DSH。

Pre 的报告设计 Skill 决定写作、叙事、素材选择与排版；Studio 提供中立的读取/编辑/渲染/检查/持久化工具；DSH 提供主会话、模型及 Agent。人工编辑保留。

## 本批源码变化

1. 新宿主设计任务为 direct 模式。新 UI 不再有自动采用选项或逐条确认按钮；显式旧只读请求不能升级为写入。旧 Proposal 字段保留作为操作记录，历史候选不自动执行。
2. 直接布局仍要求真实预览与观察；内容整理、素材关联、拆合页直接保存。仅工具实际创建的派生页面继承来源页的任务范围；受保护页和未选择页不扩权。
3. 默认批注投递当前 DSH 主 Agent，而非另起 Studio 模型 worker。显式配置的旧外部 bridge 保留兼容，不是默认路径。
4. 以上次导入的 Canonical 快照检测已保存内容偏离。上游替换先返回 local_saved_conflict；明确放弃才替换，历史保留。这不是三方自动合并。
5. annotationResults 可表达 completed/partial/unresolved，绑定 annotationId/version/commandIds；仅实际覆盖且未被改写的批注完成。无命令返回 no_changes，保持批注未完成。
6. 补全 apply_failed/conflict/no_changes 状态、投递回执竞态、执行超时和新版冻结重试；完全相同的重复请求幂等，不同参数拒绝复用。
7. 补图结果内部保留来源/哈希/任务，默认图注为空。挂接失败可按原 runId、pageId、sourceStateHash、requestId 续接；Pre 也持久校验原 runId，不能由另一设计任务冒领回执，不依赖 Agent 记住内部 proposalId；Studio 挂页后把精确 linkReceipt 回写 Pre，将 adopted_unlinked 闭合为 linked。回执失败只补回执，不重复生成或重复挂图。此项自动化仍不代表真实模型视觉质量验收通过。
8. Windows 测试父目录使用真实长路径。诊断作业证实 RUNNER~1 与 runneradmin 造成字符串不一致，不修改生产 noLinks 检查。浏览器测试不再硬编码 Windows 路径，启动失败也关闭测试服务。

## 版本与兼容

Studio 根包 0.2.0-alpha.3；DSH 插件包 0.1.1；Pre 产品包 2.0.0；标准目录 0.1.0；Node >=24.11.0。这些不同对象的版本不强制相等。本批是开发修订，不是发布版本。

旧记录通过现有运行态额外字段向后兼容；不改已有 Snapshot、源文件或 SchemaSet 哈希。新状态需要新代码读取，回滚代码前备份整个工作区/Studio 控制存储。

## 测试入口

```sh
npm ci
npm ci --prefix contracts/presentation-standard-project --ignore-scripts --no-audit --no-fund
npm run sync:vendor
npm test
npm run verify:all
```

重点回归：direct-edit-regressions.test.mjs、native-direct-edit.test.mjs、direct-design.test.mjs；以及原有 CAS、隔离、资产、标准目录、主会话、浏览器测试。完整 Git 历史是固定合同一致性测试的输入，源码压缩快照不能代替 git checkout。

## 仍待完成／不得冒充完成

按内容块三方合并、事实纠错的跨项目回写工作流、跨进程强制中断恢复、全量报告导出、真实 DSH + 实际模型/图像能力/同一对安装包联合验收。当前保留历史不等于已新增完整的可视化撤销产品。

本批测试通过只证明自动化覆盖范围；完整 CI 和真实宿主验收结果分别记录，不能互相替代。


## 2026-09-07 T05/T06 补充

新增 `studio_resume_design_visual`。Studio 在内容 Revision 中保存页面素材、内部 provenance 与 `presentation-tools.page-visual-link.v1` 回执，再由 Pre 以同一请求身份确认；任一侧瞬时失败均可幂等续接。观众画面不自动增加 AI 标签，内部记录继续区分概念图与项目证据。
