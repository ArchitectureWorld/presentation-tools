# Report Studio v0.2.0 OpenPencil Runtime Smoke Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with verification checkpoints.

**Goal:** 在 `feat/report-studio-v0.2.0-layout` 上新增一次性隔离的 OpenPencil Runtime 烟测 Harness，真实探测固定 DSH/dsh-openpencil 能力，执行可验证的 Adapter 事务，并如实记录通过或上游阻断。

**Architecture:** `studio-layout-openpencil-runtime` 只负责隔离策略、Capability URL、真实结果校验和文档生命周期合同；`tools/openpencil-runtime-smoke` 负责固定 Fixture、Runtime/浏览器编排和证据脱敏；`scripts/verify-openpencil-runtime.mjs` 负责统一输出标记、清理临时环境和正式目录指纹复核。任何真实 Runtime 不可达时，Harness 输出 BLOCKED，不伪造结果。

**Tech Stack:** Node.js ESM, `node:test`, fixed npm package `@deepseek-ai/dsh@0.1.2-rc.1`, local compatibility fork `@zseven-w/dsh-openpencil@0.1.0-compat.1`, native platform package `0.1.0-rc.9`, local HTTP capability server and in-app browser automation.

**Spec:** User-provided Report Studio v0.2.0 OpenPencil Real Runtime Smoke requirements.

## Global Constraints

- 工作支线固定为 `feat/report-studio-v0.2.0-layout`，不修改 main，不 force push。
- 固定外部提交：OpenPencil `e6c9bcef45c5b48b38f42824d56b5513178e1a0b`，dsh-openpencil `99e05cdbae5e26c920cc20e0793c66446685b0cd`。
- 固定包：`@deepseek-ai/dsh@0.1.2-rc.1`、`@zseven-w/dsh-openpencil@0.1.0-compat.1`、`@zseven-w/dsh-openpencil-win32-x64@0.1.0-rc.9`；禁止 latest/next/未固定源码。
- 所有测试子进程使用临时 `USERPROFILE/APPDATA/LOCALAPPDATA/TEMP/TMP/npm_config_cache`，服务只监听 `127.0.0.1` 动态端口。
- 不读取 Provider API Key、Session、正式 Profile、浏览历史、正式项目或插件安装目录。
- 不修改 `apps/studio-local/public/**`、v0.1.1 Repository/Canonical Snapshot/Standard Adapter/正式 DSH Runtime/生产排版入口。
- 关键 Runtime 未执行时不得输出总 PASS，必须输出 `REPORT_STUDIO_OPENPENCIL_RUNTIME_SMOKE_BLOCKED`。

### Task 1: Runtime contract tests (RED first)

**Files:**
- Create: `packages/studio-layout-openpencil-runtime/index.test.mjs`
- Create: `packages/studio-layout-openpencil-runtime/package.json`
- Create: `packages/studio-layout-openpencil-runtime/README.md`

**Interfaces:**
- Tests will consume `assertIsolatedRuntimeContext`, `assertLoopbackUrl`, `assertPinnedDependency`, `assertCapabilityUrl`, `validateRealExecutionResult`, `validateDocumentLifecycle`.

- [x] Write tests covering non-isolated Home, non-localhost URL, floating dependency, missing platform package, missing `batch_design`, forged results, missing/duplicate bindings, Data URL, host path, geometry-only patch, reopen identity, cleanup and production fingerprint.
- [x] Run `node --test packages/studio-layout-openpencil-runtime/index.test.mjs`; expect module-not-found or missing-export failures.

### Task 2: Minimal runtime boundary implementation

**Files:**
- Create: `packages/studio-layout-openpencil-runtime/index.mjs`
- Modify: `packages/studio-layout-openpencil-runtime/index.test.mjs` only if a test assertion needs exact error code.

**Interfaces:**
- `assertIsolatedRuntimeContext(context): void`
- `assertLoopbackUrl(url): URL`
- `assertPinnedDependency(packageJson, name, version): void`
- `assertCapabilityUrl(url, origin): URL`
- `validateRealExecutionResult(transaction, result): { rootNodeId, nodeIds }`
- `validateDocumentLifecycle(before, after, patch): void`

- [x] Implement only the checks required by failing tests, preserving adapter identity fields and rejecting forged/ambiguous data.
- [x] Run the contract tests and confirm green.

### Task 3: Isolated Fixture and Capability service

**Files:**
- Create: `tools/openpencil-runtime-smoke/fixture.mjs`
- Modify: `packages/studio-layout-openpencil-runtime/index.mjs` for a loopback capability server helper if needed.
- Modify: `packages/studio-layout-openpencil-runtime/index.test.mjs` with regression coverage.

- [x] Build one deterministic Render Plan containing title, body, controlled image, rectangle and group with explicit geometry.
- [x] Serve only the temporary image through a short-lived token URL; reject traversal, absolute paths, unsupported schemes and expired tokens.
- [x] Run fixture/capability tests.

### Task 4: Real Runtime and browser harness

**Files:**
- Create: `tools/openpencil-runtime-smoke/runtime-harness.mjs`
- Create: `tools/openpencil-runtime-smoke/browser-harness.mjs`
- Create: `tools/openpencil-runtime-smoke/README.md`

- [x] Probe actual fixed package exports, platform package, DSH CLI help, plugin registry and managed-editor routes in the isolated runtime.
- [x] Use `compileOpenPencilCreateTransaction`, call the actual dsh-openpencil/OpenPencil `batch_design` path when available, validate real results and then apply `compileOpenPencilFramePatchTransaction`.
- [x] Read selection, save, close, reopen and render only inside temporary documents; do not synthesize results.
- [x] Start managed editor on a random loopback port and run browser automation when a supported browser/Playwright is present; otherwise return a precise blocked reason.

### Task 5: Verification script and evidence

**Files:**
- Create: `scripts/verify-openpencil-runtime.mjs`
- Create: `docs/acceptance/report-studio-v0.2.0-openpencil-runtime-smoke.md`
- Create: `docs/handoff/2026-09-03-report-studio-v0.2.0-openpencil-runtime-handoff.md`

- [x] Capture OS/arch, Node/npm, branch/SHA, start time, production DSH process/port summary and fixed upstream coordinates.
- [x] Run isolated setup, harness, cleanup with bounded retries; copy only redacted evidence into `docs/acceptance/evidence/`.
- [x] Emit required PASS/BLOCKED markers and all individual capability fields.
- [x] Re-run formal layout tests and existing verification scripts; record exact counts and remaining boundary.

### Task 6: Review and commits

- [ ] Inspect diff for credentials, user paths, node_modules, browser profiles and unredacted logs.
- [ ] Commit tests, implementation, and docs in separate focused commits on the fixed branch.
- [ ] Run final verification command fresh before any completion claim.
