# Report Studio v0.2.0 批注任务失败修复与验收交接

> **交给下一个 Agent：** 这是一个执行交接文件。请先阅读“当前事实”和“禁止事项”，再按任务顺序开发、测试和部署。不要把历史测试结果当作本轮验收结果。

**Goal:** 修复隔离 worker 对非法 ChangeSet 没有纠正回路的问题，并完成隔离实例、真实 DSH 批注链路和正式部署验收。

**Architecture:** 主 DSH 会话只负责界面和任务引用；每次批注提交创建独立 worker。worker 只拥有 `studio_get_context` 与 `studio_apply_commands` 两个能力，模型输出必须经过严格合同校验后才能进入 Repository/CAS 应用链路。

**Tech Stack:** Node.js ESM、Node Test Runner、AJV 8、DSH `0.1.1-rc.2` Web Profile、`@architectureworld/report-studio-dsh`、PowerShell。

**Spec:** 本文件承接当前仓库的独立批注 worker 方案、直接应用修改要求，以及用户补充的“单轮次未自动或手动确认完成前不得关闭子 Agent”要求。

**Global Constraints:**

- 不复制主会话完整历史、凭据或工具注册表到 worker。
- 不通过放宽 Schema、跳过身份校验或直接信任模型输出解决失败。
- 不引入 Proposal UI；当前批注修改直接应用并保留审计记录。
- 正式部署前必须备份；不得停止 `tailscaled.exe`；正式服务仅监听 `127.0.0.1`。
- 隔离 smoke、模拟 LLM 和 HTTP 200 不能替代真实 DSH 批注验收。

## 目标

修复正式 DSH 批注任务在模型返回非法 `studio_apply_commands` 时直接失败的问题，并完成隔离实例测试、真实批注链路验收和正式部署。

最终要求：

- 批注任务继续使用独立 worker，不向主 DSH 会话发送批注 prompt，也不混入普通聊天历史。
- worker 只接收当前 `ReviewSubmission`、基线 Revision、相关页面和批注上下文。
- `studio_apply_commands` 仍使用严格 Schema、身份、基线、范围、可写 ID 和命令权限校验；不能因为重试而放宽校验。
- Schema 校验失败时，向模型返回脱敏、结构化的校验错误，最多允许 2 次纠正重试；其它安全错误立即失败。
- 当前产品行为是直接应用修改，不创建或展示 Proposal。成功后 Revision 递增并显示完成摘要。
- 在本轮自动应用完成，或用户手动确认本轮结束前，不关闭对应子 Agent。失败/超时任务保留可重试审计状态；重试创建新 task，不复用旧 task 上下文。

## 当前事实

- 仓库：`C:\Users\2899\Documents\Codex\2026-09-06\presentation-tools-dsh-design`
- 分支：`feat/report-studio-v0.2.0-layout`
- 最新提交：`15d7c35 fix: tolerate optional DSH visual bridge`
- 工作区现有变更：`packages/studio-dsh-plugin/isolated-worker.test.mjs` 已新增 RED 测试；`.tmp/` 为未跟踪目录。不要覆盖或删除它们，先审阅后再决定是否纳入提交。
- 远程：`https://github.com/ArchitectureWorld/presentation-tools.git`
- 正式入口：`http://127.0.0.1:3080/`
- 正式 DSH 数据根：`C:\Users\2899\.dsh\report-studio-v0.1.0`
- 已有正式备份：`C:\Users\2899\.dsh\backups\report-studio-v0.2.0-pre-20260906-182648`
- 正式项目 workspace：`C:\Users\2899\.dsh\report-studio-v0.1.0\workspaces\a1e98b62ad6de7af31b33552d87f06c5`
- 已知正式 Revision：`112`
- 当前 `127.0.0.1:3080` 回环访问拒绝。检测到的 3080 监听属于 `tailscaled.exe` 的非回环地址，**绝对不能停止 Tailscale**。启动/停止正式 DSH 前必须重新按命令行确认真正的 DSH Node 进程。

## 已确认根因

关键文件：

- `packages/studio-dsh-plugin/lib/isolated-worker.js`
- `packages/studio-dsh-plugin/isolated-worker.test.mjs`
- `apps/studio-local/review-task-runner.mjs`
- `packages/studio-dsh-plugin/lib/runtime.js`
- `packages/studio-contracts/index.mjs`

当前 worker 在 `studio_apply_commands` 分支直接调用 `assertStudioApplyCommands(args)`。如果模型漏掉 `riskLevel` 等必填字段，`StudioError.details.validationErrors` 虽然包含 AJV 细节，但没有反馈给模型，worker 直接失败，正式界面只能看到“Agent ChangeSet Schema 校验失败”。

真实正式记录曾出现：

- `baseRevision=111` 的“丰富正文内容”成功，Revision 从 111 到 112。
- `baseRevision=112` 的“正文是不是太多了一点，需要提炼出来”失败，原因是 ChangeSet Schema 校验失败。
- 另一次失败为投递等待超时。

因此问题不是所有 DSH 批注都不可用，而是模型工具输出没有纠正回路，加上此前测试没有覆盖真实模型的非法首答。

## 执行顺序

### 任务 1：让 Schema 错误可纠正

**修改：** `packages/studio-dsh-plugin/lib/isolated-worker.js`

- 在 `studio_apply_commands` 分支包裹 `assertStudioApplyCommands(args)`。
- 仅捕获 `StudioError` 且 `details.validationErrors` 为数组的情况。
- 将每个错误压缩为 `instancePath`、`keyword`、`params`、`message` 四类字段，追加一个工具错误结果到 `messages`，并继续下一轮模型请求。
- 工具错误结果不得包含主会话历史、凭据、完整内部对象或文件路径。
- 设置明确上限 `MAX_SCHEMA_RETRIES = 2`。超过上限后抛出原始 Schema 错误摘要并结束任务。
- `submissionId`、`projectId`、`baseRevision`、`scopeKey`、`idempotencyKey` 不匹配、未先读取上下文、未授权工具、非法 JSON、超时和 step limit 都立即失败，不进入纠正循环。
- 成功纠正后仍必须再次调用严格 `assertStudioApplyCommands`，再进入现有应用/CAS 流程。

不得采用的修复：删除 `riskLevel` 必填项、关闭 `additionalProperties`、直接信任模型第二次输出、把父会话历史复制给 worker。

### 任务 2：先跑定向 RED/Green 测试

运行：

```powershell
node --test packages/studio-dsh-plugin/isolated-worker.test.mjs
```

预期：新增测试 `worker feeds ChangeSet schema errors back to the model and accepts its corrected retry` 由失败变为通过；原有 worker 隔离、未授权工具、身份错误、超时重试测试继续通过。

新增/调整测试至少断言：

- 第三次模型请求的消息包含 `riskLevel` 或结构化校验错误字段。
- 模型第二次纠正后返回的命令仍经严格 Schema 校验。
- 请求中不存在 `PRIVATE_HISTORY`、`PRIVATE_KEY` 或主会话 prompt。
- schema 错误最多重试 2 次，身份/权限/超时错误不重试。

### 任务 3：补齐任务生命周期回归

**重点文件：** `apps/studio-local/review-task-runner.mjs`、相关 `review-task-runner.test.mjs`。

确认并测试以下生命周期：

- 任务创建后阶段按 `reading_context -> processing -> completed/failed/timed_out` 迁移。
- 普通直接应用成功后，Revision 递增、ReviewRun 有摘要和完成时间；此时才允许释放 worker。
- 在本轮尚未自动完成或用户尚未手动确认结束前，不调用 `agentBridge.close` 关闭对应子 Agent。
- 失败/超时终止当前模型请求但保留 ReviewRun、taskId、摘要和可重试状态；不伪造成功，不删除审计记录。
- 重试必须创建新的 taskId、ReviewRun 和 worker session ref，不恢复旧 worker 上下文。
- `closeSubmission` 只在本轮已完成/用户确认结束时关闭 worker；关闭失败要保留 `closedAt=null` 和可重试信息。

这里的“保留子 Agent”是生命周期和审计上的保留；已经超时的模型请求可以中止，不能让一个失控请求继续占用资源。

### 任务 4：运行完整自动化验证

在任务 1-3 通过后，从仓库根目录运行：

```powershell
npm test
npm run verify:dsh
npm run sync:vendor
npm run verify:release
```

若完整测试出现与本修复无关的既有失败，必须记录完整命令、失败测试名、首个错误和是否阻断部署；不能用“部分通过”代替结论。

### 任务 5：隔离 DSH 实例烟测

使用独立临时 `DSH_HOME` 和动态端口，不读写正式 `C:\Users\2899\.dsh`。已有基础命令：

```powershell
npm run smoke:dsh
```

基础 smoke 只证明安装、启动、健康检查和页面路由，不能单独作为批注验收。必须增加或临时执行一条隔离批注链路，至少覆盖：

1. 创建隔离 DSH Home、web profile 和测试 workspace。
2. 提交两组批注，确认生成两个不同 taskId，且主会话没有收到批注 prompt。
3. 第一组模拟/触发一次缺少 `riskLevel` 的非法 ChangeSet，确认 worker 收到校验反馈后纠正并成功应用。
4. 验证 Proposal 不出现，Revision 正常递增，结果摘要可见。
5. 失败或超时后重试，确认产生新 task，不复用旧 task。
6. 检查正式数据根、正式 Revision 和正式 workspace 的修改时间/哈希未变化。

若真实模型路由不可用，必须明确标记为“隔离执行器/模拟 LLM 通过，真实模型未验收”，不能把模拟结果写成真实 DSH 验收。

### 任务 6：正式部署前备份与重启

只有任务 1-5 通过后才能部署正式实例。

1. 再次确认 3080 真实 owner；不要停止 `tailscaled.exe`。
2. 备份 `C:\Users\2899\.dsh\profiles\web` 和正式 report-studio 数据根，备份目录名必须带时间戳。
3. 打包插件并记录 tgz 的 SHA-256；确认包内 `lib/isolated-worker.js` 与源码一致。
4. 停止真正的 DSH Web Node，安装新包，使用最小命令启动：

```powershell
dsh --profile web --no-open
```

5. 只通过 `http://127.0.0.1:3080/` 验收正式入口；`/report-studio/?sessionId=...` 仅作为内部/备用地址。

### 任务 7：正式验收

健康检查至少应包含：

- `agentMode=dsh-native`
- `reviewWorkerMode=dsh-local-worker`
- `migrationStatus=ready`
- `agentConfigured=true`
- `securityMode=local-single-user-only`
- `listenHost=127.0.0.1`
- `networkSharedSecurity=false`

然后在正式界面创建一条新的普通批注验证：

- 只出现一次提交反馈和一次完成反馈。
- 批注文本完整可读，当前轮次与批注归属一致。
- 直接修改成功，无 Proposal/确认按钮。
- Revision 从部署前值递增 1。
- 任务完成后才关闭 worker；失败时保留可重试状态。

不要直接重放历史失败 submission，除非先确认其基线仍然有效；优先创建新的批注任务。

## 禁止事项

- 不得删除或覆盖正式数据，不得跳过备份。
- 不得停止 `tailscaled.exe`，不得把 Tailscale 的 3080 监听误判为 DSH。
- 不得把旧失败 submission 直接重试当作修复证据。
- 不得为了消除报错而放宽 ChangeSet Schema、删除身份校验或复制主会话历史。
- 不得重新引入 Proposal UI；当前用户要求是直接应用修改。
- 不得把隔离 smoke、静态检查或 HTTP 200 写成真实产品验收。

## 交付报告必须包含

- 修改文件和提交哈希。
- 定向测试、`npm test`、`verify:dsh`、`verify:release`、隔离 smoke 的逐项结果。
- 正式部署前后 Revision、taskId、worker 状态和健康检查关键字段。
- 正式数据备份路径和插件包 SHA-256。
- 未通过或未覆盖的项目，尤其是真实模型是否可用。
