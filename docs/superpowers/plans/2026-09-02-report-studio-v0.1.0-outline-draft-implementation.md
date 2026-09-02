# Report Studio v0.1.0 Outline + Draft Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a directly runnable local Report Studio v0.1.0 focused on outline + draft production, review rounds, persistence, revision history, and an optional external DSH agent bridge; layout remains a v0.2.0 placeholder.

**Architecture:** Use a zero-runtime-dependency Node.js 22 local server plus a browser UI. Formal content state lives in server-side JSON with atomic temp-file replacement. Human content edits produce monotonic revisions; annotations autosave outside content revisions; one ReviewRound may contain multiple immutable ReviewSubmissions. Agent execution is delegated through an optional external bridge and never implemented as a second model runtime inside Studio.

**Tech Stack:** Node.js 22 built-ins (`http`, `fs`, `crypto`, `node:test`) + vanilla browser JavaScript/CSS/HTML.

**Spec:** `docs/architecture/report-studio-mvp-baseline-v0.1.0.md`

## Global Constraints

- Current product version is exactly `v0.1.0`.
- v0.1.0 production scope is Outline + Draft + Annotation/ReviewRound + persistence/recovery; Layout production work is deferred to v0.2.0.
- `pre-design` is not a dependency.
- DSH remains the only Agent/Model runtime; Studio may only call a configured external bridge.
- A user-visible ReviewRound may contain multiple immutable ReviewSubmissions.
- Agent output never auto-resolves annotations.
- No external npm runtime dependency is required for the local app.

---

### Task 1: Core domain and revision rules

**Files:**
- Create: `packages/studio-core/index.mjs`
- Test: `packages/studio-core/index.test.mjs`

**Interfaces:**
- Produces: `createInitialState()`, `executeAction(state, action)`, `submitReviewRound(state, input)`, `createProposalFromAgent(state, submissionId, result)`, `acceptProposal(state, proposalId)`.

- [ ] Write failing tests for stable outline IDs, draft page creation, manual content revision increments, annotation autosave without revision increments, two submissions in one ReviewRound, immutable submission snapshots, and proposal acceptance.
- [ ] Run `node --test packages/studio-core/index.test.mjs` and confirm failure because the module is absent.
- [ ] Implement the minimum pure domain functions.
- [ ] Re-run tests until green.

### Task 2: Atomic local repository and HTTP application API

**Files:**
- Create: `apps/studio-local/server.mjs`
- Create: `apps/studio-local/repository.mjs`
- Test: `apps/studio-local/server.test.mjs`

**Interfaces:**
- `GET /api/state`
- `POST /api/action`
- `POST /api/review/submit`
- `POST /api/proposal/:id/accept`
- `GET /api/health`

- [ ] Write failing tests for first-run state, persisted mutation across repository reload, and API health/state/action behavior.
- [ ] Run tests and confirm expected failure.
- [ ] Implement atomic JSON persistence with same-directory temp file + rename.
- [ ] Implement HTTP API and static file serving.
- [ ] Re-run all tests.

### Task 3: Direct-use Outline + Draft browser UI

**Files:**
- Create: `apps/studio-local/public/index.html`
- Create: `apps/studio-local/public/app.js`
- Create: `apps/studio-local/public/styles.css`
- Test: `apps/studio-local/ui.contract.test.mjs`

**Interfaces:**
- Browser uses only the HTTP application API.

- [ ] Write failing contract tests asserting required controls and production copy exist.
- [ ] Run tests and verify failure.
- [ ] Implement three-stage shell with Layout disabled as `v0.2.0`, editable outline tree, draft page navigation/editor, script, page assets, fixed annotation panel, ReviewRound history, proposal preview, and floating Agent panel.
- [ ] Run contract and core tests.

### Task 4: Optional external DSH bridge and deployable packaging

**Files:**
- Modify: `apps/studio-local/server.mjs`
- Create: `apps/studio-local/agent-bridge.mjs`
- Test: `apps/studio-local/agent-bridge.test.mjs`
- Create: `scripts/verify-v0.1.0.mjs`
- Create: `package.json`
- Modify: `docs/deployment/report-studio-v0.1.0-local-deployment.md`
- Modify: `README.md`

**Interfaces:**
- Optional `REPORT_STUDIO_AGENT_URL` points to an external DSH-compatible HTTP bridge accepting a ReviewSubmission envelope and returning `{ message, commands }`.
- Without the bridge, all manual Outline/Draft functionality remains usable and the Agent UI reports `DSH Bridge 未配置` instead of simulating a model.

- [ ] Write failing tests for disabled bridge behavior, valid external response validation, and malformed response rejection.
- [ ] Implement bridge delegation with timeout and typed errors.
- [ ] Add zero-dependency `npm start`, `npm test`, and `npm run verify` scripts.
- [ ] Update deployment documentation with exact local commands, data path, port, environment variables, backup instructions, and verification checklist.
- [ ] Run `npm test` and `npm run verify`.

### Task 5: Release verification

**Files:**
- Modify only if verification exposes defects.

- [ ] Start the server against a temporary data directory.
- [ ] Verify `GET /api/health` and `GET /api/state`.
- [ ] Exercise outline creation, page creation, draft save, annotation, ReviewRound submission #1 and #2, restart recovery, and proposal acceptance using HTTP requests.
- [ ] Run the complete test suite again.
- [ ] Record the verified commands and results in the v0.1.0 handoff.
