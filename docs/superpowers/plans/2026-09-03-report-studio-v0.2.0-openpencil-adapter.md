# Report Studio v0.2.0 OpenPencil Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and verify an isolated OpenPencil transaction adapter plus a one-to-one `LayoutEngineBinding` without touching the v0.1.1 production runtime.

**Architecture:** A new engine-binding package owns derived engine identity records. A new OpenPencil adapter compiles engine-neutral render plans into transactional `batch_design` operations, validates returned node bindings, emits frame-only update transactions, and maps OpenPencil selection back to LayoutElement identities. The external runtime remains dependency-injected and replaceable.

**Tech Stack:** Node.js 22+, ECMAScript modules, built-in `node:test`, `node:crypto`; no OpenPencil runtime dependency in this phase.

**Spec:** `docs/superpowers/specs/2026-09-03-report-studio-v0.2.0-openpencil-adapter-design.md`

## Global Constraints

- Work only on `feat/report-studio-v0.2.0-layout`.
- Base commit for this phase is `69859cdd65abebeadba196ad3e8e0f3f1fce5675`.
- OpenPencil target is `ZSeven-W/openpencil@e6c9bcef45c5b48b38f42824d56b5513178e1a0b`.
- DSH OpenPencil target is `ZSeven-W/dsh-openpencil@99e05cdbae5e26c920cc20e0793c66446685b0cd`, package `0.1.0-rc.9`.
- Do not modify `apps/studio-local/public/**`, v0.1.1 Repository, Standard Adapter, DSH runtime, or production package.
- Do not install, vendor, fork, or import OpenPencil private modules.
- Do not write `.op` files or open the production Layout tab.
- Tests must be committed and observed failing before implementation.

---

### Task 1: Layout Engine Binding Contract

**Files:**
- Create: `packages/studio-layout-engine-binding/index.test.mjs`
- Create: `packages/studio-layout-engine-binding/index.mjs`
- Create: `packages/studio-layout-engine-binding/package.json`
- Create: `packages/studio-layout-engine-binding/README.md`

**Interfaces:**
- Produces: `ENGINE_BINDING_SCHEMA_VERSION`, `LayoutEngineBindingError`, `createLayoutEngineBindingId()`, `assertLayoutEngineBinding()`, `engineNodeIdForLayoutElement()`, `layoutElementIdForEngineNode()`, `mapEngineSelection()`.

- [ ] Write tests for typed UUIDv7, valid binding, duplicate layout ID, duplicate engine ID, duplicate binding key, forward lookup, reverse lookup, and unmapped selection.
- [ ] Run `node --test packages/studio-layout-engine-binding/index.test.mjs`; expect `ERR_MODULE_NOT_FOUND`.
- [ ] Implement the minimal immutable contract and lookups.
- [ ] Run the test; expect 8 tests and 0 failures.
- [ ] Commit with `feat(layout): define derived engine bindings`.

### Task 2: OpenPencil Create Transaction Compiler

**Files:**
- Create: `packages/studio-layout-openpencil/index.test.mjs`
- Create: `packages/studio-layout-openpencil/index.mjs`
- Create: `packages/studio-layout-openpencil/package.json`
- Create: `packages/studio-layout-openpencil/README.md`
- Create: `packages/studio-layout-openpencil/compatibility/openpencil-baseline.json`

**Interfaces:**
- Consumes: engine-neutral Render Plan from `studio-layout-core`.
- Produces: `OPENPENCIL_ADAPTER_VERSION`, `OpenPencilAdapterError`, `compileOpenPencilCreateTransaction()`.

- [ ] Write tests for deterministic binding keys, stable operation ordering, root frame creation, text mapping, shape mapping, group mapping, image URL resolution, forbidden Data URL, forbidden absolute path, unknown element type, style whitelist, and input immutability.
- [ ] Run the package test; expect `ERR_MODULE_NOT_FOUND`.
- [ ] Implement a deterministic `batch_design` compiler using only `I(parent,node)` assignments.
- [ ] Run all new tests and existing layout tests; expect 0 failures.
- [ ] Commit with `feat(layout): compile OpenPencil create transactions`.

### Task 3: Execution Result Binding and Incremental Frame Patch

**Files:**
- Modify: `packages/studio-layout-openpencil/index.test.mjs`
- Modify: `packages/studio-layout-openpencil/index.mjs`

**Interfaces:**
- Produces: `createOpenPencilEngineBinding()`, `compileOpenPencilFramePatchTransaction()`, `mapOpenPencilSelection()`.

- [ ] Write failing tests for complete result binding, missing root, missing element, unknown binding, duplicate result binding, duplicate engine node, frame-only update output, unmapped LayoutElement rejection, empty patch rejection, and reverse selection mapping.
- [ ] Run the package test; confirm failures reference missing functions.
- [ ] Implement the minimal result validator and transaction compiler.
- [ ] Run all layout tests; expect 0 failures.
- [ ] Commit with `feat(layout): bind OpenPencil nodes and compile frame patches`.

### Task 4: Deterministic Adapter Verification and CI

**Files:**
- Create: `scripts/verify-layout-openpencil-v0.2.0.mjs`
- Modify: `.github/workflows/report-studio-v0.2.0-layout-ci.yml`

**Interfaces:**
- Produces verification marker: `REPORT_STUDIO_OPENPENCIL_ADAPTER_V0_2_0_PASS`.

- [ ] Build a fixed Render Plan with text, image, shape, and group elements.
- [ ] Compile twice and assert byte-identical operations.
- [ ] Feed a deterministic fake OpenPencil result and build a Binding.
- [ ] Compile a frame patch and map a mixed selection.
- [ ] Assert no domain input mutation and print the marker.
- [ ] Add both new packages and the verification script to CI paths and commands.
- [ ] Push and inspect GitHub Actions; expect all tests and all verification scripts to pass.
- [ ] Commit with `ci(layout): verify OpenPencil adapter contracts`.

### Task 5: Phase Acceptance and Handoff

**Files:**
- Create: `docs/acceptance/report-studio-v0.2.0-openpencil-adapter-verification.md`
- Create: `docs/handoff/2026-09-03-report-studio-v0.2.0-openpencil-adapter-handoff.md`

**Interfaces:**
- Records exact source commit, workflow run, tests, external compatibility coordinates, and remaining production integration gates.

- [ ] Record exact branch, phase base, final source commit, workflow run and test counts.
- [ ] State that OpenPencil runtime installation, `.op` persistence, managed editor embedding and production Repository integration remain deferred.
- [ ] Record the next safe phase as real-runtime compatibility smoke in an isolated DSH Profile.
- [ ] Commit with `docs(layout): hand off OpenPencil adapter evaluation`.
