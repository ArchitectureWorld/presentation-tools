# Report Studio v0.2.0 Layout Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an engine-neutral, independently testable layout foundation for Report Studio v0.2.0 without touching the current production UI or v0.1.1 storage/runtime paths.

**Architecture:** `studio-layout-contracts` owns canonical layout validation and typed IDs. `studio-layout-core` owns pure immutable domain operations and produces an engine-neutral render plan. Later adapters consume the render plan; OpenPencil or any other editor remains replaceable and never becomes the canonical fact source.

**Tech Stack:** Node.js 22+, ECMAScript modules, built-in `node:test`, no runtime dependencies for the foundation slice.

**Spec:** `docs/superpowers/specs/2026-09-03-report-studio-v0.2.0-layout-foundation-design.md`

## Global Constraints

- Development branch is exactly `feat/report-studio-v0.2.0-layout`.
- Branch base is `feat/report-studio-v0.1.1-hardening@29294803681758e0b65a0bc51f7ed9ab810cde9a`.
- Do not modify `apps/studio-local/public/**`, v0.1.1 Repository, Standard Adapter, or DSH runtime in this foundation phase.
- Do not open the production Layout tab.
- Do not implement OpenPencil-private documents, pagination, templates, animation, PPTX, PDF, HTML, or PNG export.
- Canonical coordinates use `studio_unit`; default canvas is `1600 × 900`.
- Live elements never duplicate source content in the layout document.
- Detached elements require local payload and have no writable live source reference.
- All domain functions are pure and return new objects.
- Tests are written and observed failing before production code is added.

---

### Task 1: Canonical Layout Contracts

**Files:**
- Create: `packages/studio-layout-contracts/index.test.mjs`
- Create: `packages/studio-layout-contracts/index.mjs`
- Create: `packages/studio-layout-contracts/package.json`
- Create: `packages/studio-layout-contracts/README.md`

**Interfaces:**
- Consumes: Node.js `crypto.randomBytes` only.
- Produces: `LAYOUT_SCHEMA_VERSION`, `DEFAULT_LAYOUT_CANVAS`, `LayoutContractError`, `createLayoutId()`, `sourceRefKey()`, `assertLayoutPageDocument()`.

- [ ] **Step 1: Write the failing ID and canonical validation tests**

Create tests that import the interfaces above and assert typed UUIDv7 IDs, a valid mixed live/detached document, duplicate element rejection, invalid frame rejection, and deterministic source keys.

- [ ] **Step 2: Run the contract test and verify RED**

Run:

```bash
node --test packages/studio-layout-contracts/index.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `packages/studio-layout-contracts/index.mjs`.

- [ ] **Step 3: Implement the minimal contract**

Implement:

```js
export const LAYOUT_SCHEMA_VERSION = 'report-studio.layout.v0.2.0-alpha.1'
export const DEFAULT_LAYOUT_CANVAS = Object.freeze({ width: 1600, height: 900, unit: 'studio_unit' })
export function createLayoutId(kind, options = {}) {}
export function sourceRefKey(sourceRef) {}
export function assertLayoutPageDocument(layout) {}
```

Validation rules must exactly match the design spec. Do not add storage or editor-specific fields.

- [ ] **Step 4: Run the contract test and verify GREEN**

Run:

```bash
node --test packages/studio-layout-contracts/index.test.mjs
```

Expected: 6 tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add packages/studio-layout-contracts
git commit -m "feat(layout): add canonical layout contracts"
```

### Task 2: Layout Page and Element Creation

**Files:**
- Create: `packages/studio-layout-core/index.test.mjs`
- Create: `packages/studio-layout-core/index.mjs`
- Create: `packages/studio-layout-core/package.json`
- Create: `packages/studio-layout-core/README.md`

**Interfaces:**
- Consumes: `assertLayoutPageDocument`, `createLayoutId`, `DEFAULT_LAYOUT_CANVAS` from Task 1.
- Produces: `createLayoutPage()`, `addLiveLayoutElement()`, `addDetachedLayoutElement()`.

- [ ] **Step 1: Write failing creation tests**

Test the default 16:9 document, live source binding without `localPayload`, detached local payload without `sourceRef`, default z-index assignment, and immutable input handling.

- [ ] **Step 2: Run the core test and verify RED**

Run:

```bash
node --test packages/studio-layout-core/index.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `packages/studio-layout-core/index.mjs`.

- [ ] **Step 3: Implement minimal immutable creation functions**

Use `structuredClone()`. Every returned document must pass `assertLayoutPageDocument()` before it is returned.

- [ ] **Step 4: Run tests and verify GREEN**

Run:

```bash
node --test packages/studio-layout-contracts/*.test.mjs packages/studio-layout-core/*.test.mjs
```

Expected: all contract and creation tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/studio-layout-core packages/studio-layout-contracts
git commit -m "feat(layout): create canonical layout pages and elements"
```

### Task 3: Geometry and Detach Operations

**Files:**
- Modify: `packages/studio-layout-core/index.test.mjs`
- Modify: `packages/studio-layout-core/index.mjs`

**Interfaces:**
- Consumes: canonical layout documents from Tasks 1–2.
- Produces: `updateLayoutElementFrame()`, `detachLayoutElement()`.

- [ ] **Step 1: Write failing geometry preservation tests**

The frame test must assert that changing `x` and `width` does not change `sourceRef`, `style`, `zIndex`, or `lastSyncedSourceRevision`.

- [ ] **Step 2: Write a failing detach test**

The detach test must assert removal of `sourceRef`, creation of `localPayload`, `syncPolicy='detached'`, and `lastSyncedSourceRevision=null`.

- [ ] **Step 3: Run tests and verify RED**

Run:

```bash
node --test packages/studio-layout-core/index.test.mjs
```

Expected: FAIL because both functions are missing.

- [ ] **Step 4: Implement minimal immutable operations**

A missing element throws `LayoutContractError('layout_element_not_found', ...)`. Detaching an already detached element throws `layout_element_already_detached`.

- [ ] **Step 5: Run tests and verify GREEN**

Run the full layout test command and expect 0 failures.

- [ ] **Step 6: Commit**

```bash
git add packages/studio-layout-core
git commit -m "feat(layout): support geometry edits and explicit detach"
```

### Task 4: Draft Reconciliation and Render Plan

**Files:**
- Modify: `packages/studio-layout-core/index.test.mjs`
- Modify: `packages/studio-layout-core/index.mjs`
- Create: `scripts/verify-layout-v0.2.0.mjs`

**Interfaces:**
- Consumes: source index objects keyed by `sourceRefKey()`.
- Produces: `markLayoutDraftAdvanced()`, `reconcileLayoutSources()`, `createLayoutRenderPlan()`.

- [ ] **Step 1: Write failing stale-state test**

Assert that advancing draft revision changes only `syncState` and leaves frames unchanged.

- [ ] **Step 2: Write failing orphan/recovery test**

Assert missing sources mark only live elements orphaned, detached elements remain normal, geometry is unchanged, and a later valid source restores `synced` state.

- [ ] **Step 3: Write failing render-plan purity test**

Assert live payload comes from source index, detached payload comes from `localPayload`, z-order is deterministic, and the canonical input remains byte-equivalent after rendering.

- [ ] **Step 4: Run tests and verify RED**

Run the core test and confirm failures are for the three missing functions.

- [ ] **Step 5: Implement minimal reconciliation and projection**

Do not copy resolved live payload into the canonical layout document. `createLayoutRenderPlan()` is the only function that combines layout and semantic payload.

- [ ] **Step 6: Add deterministic verification script**

The script creates a page, adds a live title and detached line, advances draft revision, reconciles, confirms geometry stability, builds a render plan, and prints:

```text
REPORT_STUDIO_LAYOUT_V0_2_0_FOUNDATION_PASS
```

- [ ] **Step 7: Run tests and verification**

```bash
node --test packages/studio-layout-contracts/*.test.mjs packages/studio-layout-core/*.test.mjs
node scripts/verify-layout-v0.2.0.mjs
```

Expected: 13 tests, 0 failures, verification marker present.

- [ ] **Step 8: Commit**

```bash
git add packages/studio-layout-core scripts/verify-layout-v0.2.0.mjs
git commit -m "feat(layout): reconcile draft sources and build render plans"
```

### Task 5: Dedicated Layout CI

**Files:**
- Create: `.github/workflows/report-studio-v0.2.0-layout-ci.yml`

**Interfaces:**
- Consumes: layout tests and verification script from Tasks 1–4.
- Produces: independent GitHub check `Report Studio v0.2.0 Layout Foundation CI`.

- [ ] **Step 1: Create branch-scoped workflow**

The workflow triggers on `feat/report-studio-v0.2.0-layout` pushes and pull requests that modify layout packages, the layout verification script, the layout spec/plan, or the workflow itself.

- [ ] **Step 2: Configure Node.js 22 and execute exact commands**

```bash
node --test packages/studio-layout-contracts/*.test.mjs packages/studio-layout-core/*.test.mjs
node scripts/verify-layout-v0.2.0.mjs
```

No root dependency installation is required for this pure foundation slice.

- [ ] **Step 3: Push and inspect the GitHub run**

Expected: workflow conclusion `success`; test count 13; verification marker present.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/report-studio-v0.2.0-layout-ci.yml
git commit -m "ci(layout): add independent v0.2.0 foundation gate"
```

### Task 6: Adapter Boundary and Independent Spike

**Files:**
- Create: `packages/studio-layout-adapter/index.mjs`
- Create: `packages/studio-layout-adapter/index.test.mjs`
- Create: `tools/layout-spike/index.html`
- Create: `tools/layout-spike/app.js`
- Create: `tools/layout-spike/styles.css`
- Create: `tools/layout-spike/README.md`

**Interfaces:**
- Consumes: engine-neutral render plans.
- Produces: a minimal adapter interface and an isolated browser spike that never writes production project data.

- [ ] **Step 1: Test adapter interface conformance**

Define `assertLayoutAdapter(adapter)` requiring `mount`, `render`, `readViewportState`, and `destroy` functions. The test rejects adapters missing any method.

- [ ] **Step 2: Implement the interface validator**

Do not import OpenPencil yet. The adapter package defines the replaceable boundary only.

- [ ] **Step 3: Build an isolated spike using a fixed fixture**

The spike renders a 1600×900 canvas with live title/image placeholders and detached shapes, supports selecting and dragging elements, and serializes only frame changes. It must not import `apps/studio-local` or write Repository state.

- [ ] **Step 4: Add browser smoke verification**

Verify no horizontal overflow at 1366×768 and 1920×1080, element dragging changes frame values, and reloading the fixed fixture resets state.

- [ ] **Step 5: Commit**

```bash
git add packages/studio-layout-adapter tools/layout-spike
git commit -m "feat(layout): add adapter boundary and isolated canvas spike"
```

### Task 7: Integration Readiness Contract

**Files:**
- Create: `docs/architecture/report-studio-v0.2.0-layout-integration-contract.md`
- Create: `packages/studio-layout-integration/index.test.mjs`
- Create: `packages/studio-layout-integration/index.mjs`

**Interfaces:**
- Consumes: stabilized v0.1.1 source projection in a later merge.
- Produces: `buildLayoutSourceIndex(draftPage, pageAssets)` and explicit compatibility errors.

- [ ] **Step 1: Define exact required source identities**

The document must require stable `contentBlockId`, `listItemId`, `metricId`, `tableCellId`, `scriptBlockId`, and `pageAssetId`, plus ObjectRef-backed assets.

- [ ] **Step 2: Write failing source-index tests using canonical fixtures**

Tests must cover content blocks, list items, metrics, table cells, script blocks, page assets, duplicate IDs, and missing references.

- [ ] **Step 3: Implement source-index projection**

The implementation returns a plain object keyed exclusively by `sourceRefKey()`. It excludes Data URLs, Base64, migration data, and UI state.

- [ ] **Step 4: Verify incompatibility with legacy simplified pages is explicit**

Legacy `{heading, body, bullets, script, assets}` pages must return a typed `layout_source_contract_unavailable` error rather than being silently guessed.

- [ ] **Step 5: Commit**

```bash
git add docs/architecture/report-studio-v0.2.0-layout-integration-contract.md packages/studio-layout-integration
git commit -m "feat(layout): define stabilized draft integration contract"
```

### Task 8: v0.2.0 Foundation Handoff

**Files:**
- Create: `docs/acceptance/report-studio-v0.2.0-layout-foundation-verification.md`
- Create: `docs/handoff/2026-09-03-report-studio-v0.2.0-layout-foundation-handoff.md`

**Interfaces:**
- Consumes: all test results and GitHub Actions evidence.
- Produces: a precise handoff that distinguishes implemented foundation from deferred production integration.

- [ ] **Step 1: Run the complete dedicated layout gate**

Run tests, verification script, adapter spike smoke, and integration projection tests from a clean checkout.

- [ ] **Step 2: Record exact evidence**

Include branch, base commit, final commit, workflow run, test counts, browser viewports, and remaining integration gates.

- [ ] **Step 3: State deferred capabilities explicitly**

The handoff must say that production Layout UI, OpenPencil binding, Repository persistence, DSH commands, pagination, and final exports are not delivered by the foundation milestone.

- [ ] **Step 4: Commit**

```bash
git add docs/acceptance/report-studio-v0.2.0-layout-foundation-verification.md docs/handoff/2026-09-03-report-studio-v0.2.0-layout-foundation-handoff.md
git commit -m "docs(layout): hand off the verified v0.2.0 foundation"
```
