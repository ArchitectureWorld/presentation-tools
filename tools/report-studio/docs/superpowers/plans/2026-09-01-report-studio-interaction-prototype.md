# Report Studio Interaction Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Build a dependency-free, runnable three-stage Report Studio interaction prototype that validates scoped annotations, per-page comments, material preview, and simulated Agent submission.

**Architecture:** A pure JavaScript state model and mock adapter drive a static HTML/CSS UI. The UI consumes only the adapter contract so it can later be ported to the existing DSH React client without changing interaction semantics.

**Tech Stack:** HTML5, CSS, browser JavaScript, Node.js built-in test runner.

**Spec:** `docs/superpowers/specs/2026-09-01-report-studio-interaction-prototype-design.md`

## Global Constraints

- Do not modify existing DSH contracts or Project State.
- Do not connect a real Agent or real storage service.
- Keep outline, draft-page, and layout-page comment scopes isolated.
- “添加批注” and “提给Agent” must remain separate actions.
- The prototype must run without downloading third-party dependencies.

---

### Task 1: Core scoped annotation state

**Files:**
- Create: `src/studio-model.js`
- Test: `tests/studio-model.test.js`

**Interfaces:**
- Produces: `createInitialState`, `scopeKeyFor`, `addComment`, `submitRound`, `completeRound`, `setStage`, `setPage`, `selectTarget`.

- [x] Write failing tests for scope isolation, single-comment staging, structured round submission, and Agent completion.
- [x] Run `node --test tests/studio-model.test.js` and verify failure because the model is missing.
- [x] Implement the minimal state model.
- [x] Run the test and verify all cases pass.
- [x] Commit the task.

### Task 2: Mock adapter and local persistence

**Files:**
- Create: `src/mock-studio-adapter.js`
- Test: `tests/mock-studio-adapter.test.js`

**Interfaces:**
- Consumes: functions from `src/studio-model.js`.
- Produces: `createMockStudioAdapter(options)` with subscribe/mutation methods.

- [x] Write failing tests for subscriptions, persisted snapshots, page switching, asset add/remove, and round completion.
- [x] Run the adapter test and verify expected failures.
- [x] Implement the adapter.
- [x] Run both test files and verify all tests pass.
- [x] Commit the task.

### Task 3: Three-stage visual shell

**Files:**
- Create: `prototype/index.html`
- Create: `prototype/styles.css`
- Create: `prototype/app.js`

**Interfaces:**
- Consumes: `window.StudioCore` and `window.MockStudioAdapter`.
- Produces: a browser UI with stage navigation, page navigation, stage workspaces, and a shared comment panel.

- [x] Build the common 16:9 shell and fixed stage navigation.
- [x] Render outline, draft, and layout stages from adapter state.
- [x] Implement page switching and scope labels.
- [x] Verify manually in a local HTTP server.
- [x] Commit the task.

### Task 4: Annotation and Agent round interactions

**Files:**
- Modify: `prototype/app.js`
- Modify: `prototype/styles.css`

**Interfaces:**
- Consumes: adapter selection, addComment, submitCurrentRound, completeRound.
- Produces: target selection, superscript markers, comment targeting, two submit actions, and Agent status cards.

- [x] Implement block/asset/layout target selection.
- [x] Implement local text selection and composer targeting.
- [x] Implement “添加批注” and marker linkage.
- [x] Implement “提给Agent” and simulated processing/completion.
- [x] Verify each scope submits only its own comments.
- [x] Commit the task.

### Task 5: Material interactions and single-file build

**Files:**
- Modify: `prototype/app.js`
- Modify: `prototype/styles.css`
- Create: `scripts/build-single-file.js`
- Create: `report-studio-prototype.html`

**Interfaces:**
- Produces: thumbnail preview, local upload, remove-from-page, mock AI generation, and a directly openable single HTML file.

- [x] Implement the asset preview modal.
- [x] Implement upload and remove-from-page actions.
- [x] Implement mock AI-generated material.
- [x] Build the single-file HTML artifact.
- [x] Verify the single file contains no external resource dependencies.
- [x] Commit the task.

### Task 6: Documentation and final verification

**Files:**
- Create: `README.md`
- Create: `integration/dsh-client-integration.md`

**Interfaces:**
- Produces: run instructions, interaction checklist, and DSH integration mapping.

- [x] Document direct-open and local-server usage.
- [x] Document the adapter-to-DSH migration boundary.
- [x] Run `node --test tests/*.test.js`.
- [x] Run `node scripts/build-single-file.js`.
- [x] Validate generated HTML structure and required labels.
- [x] Create the delivery ZIP.

## Execution Notes

- Browser verification uses Chromium DevTools Protocol with `Page.setDocumentContent` because the container policy blocks local HTTP and `file:` navigation.
- The delivered single-file artifact remains network-independent and can be opened directly by the user.
- Real DSH Project State, Agent, Revision and export integration remain intentionally outside this prototype.


### Task 7: Batch-scoped Agent submission and historical batch editing

**Files:**
- Modify: `src/studio-model.js`
- Modify: `src/mock-studio-adapter.js`
- Modify: `prototype/app.js`
- Modify: `prototype/styles.css`
- Modify: `scripts/verify-browser.js`
- Test: `tests/batch-submission.test.js`
- Test: `tests/round-scoped-submit.test.js`
- Test: `tests/batch-submission-ui.test.js`

**Interfaces:**
- Produces: `getBatchProgress`, `getBatchStats`, `setCommentCompleted`, `submitRound(roundId?)`, and per-batch `submissionHistory`.

- [x] Write failing tests for completed/unfinished counters, historical-round edits, in-place submissions, and unified Agent action copy.
- [x] Verify the tests fail against the v0.2.0 global submit interaction.
- [x] Implement batch-level `提给Agent` actions and remove the global Agent submit button.
- [x] Add historical batch continuation, edit, completion toggles, and same-round submission history.
- [x] Verify all Agent action buttons use exactly `提给Agent`.
- [x] Run the full automated suite, single-file build, and Chromium interaction verification.
