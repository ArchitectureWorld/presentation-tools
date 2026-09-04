# Report Studio v0.1.1 → v0.2.0 Convergence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close and merge the verified Report Studio v0.1.1 foundation, synchronize it into the existing v0.2.0 layout branch, align v0.2.0 with OpenPencil's Node.js runtime floor, and establish a contract-safe project identity bridge for pre-design → Presentation → Layout.

**Architecture:** `main` remains the released v0.1.1 foundation. `feat/report-studio-v0.2.0-layout` absorbs the latest `main` and becomes the only continuing product-development branch. Presentation Standard Project Directory 0.1.0 remains frozen; layout consumes project identity through a Presentation-internal snapshot projection rather than changing the pre-design contract or duplicating `projectId` into Canonical Page records.

**Tech Stack:** Node.js ESM, Node test runner, AJV, DSH 0.1.1-rc.2, Presentation Standard Project Directory 0.1.0, OpenPencil/dsh-openpencil 0.1.0-rc.9, GitHub Actions.

**Spec:** `docs/architecture/report-studio-architecture.md`, `docs/architecture/report-studio-v0.2.0-layout-integration-contract.md`

## Global Constraints

- Do not merge v0.2.0 code back into the v0.1.1 release branch.
- Merge `feat/report-studio-v0.1.1-hardening` into `main` before synchronizing `main` into `feat/report-studio-v0.2.0-layout`.
- Keep Presentation Standard Project Directory at version `0.1.0`, Contract commit `974668d308728386ea005c9e77d58ebff9372f0a`, Schema Set SHA-256 `5bd329fcc8503ff7a48b3430e41b38dd264ae486cee7372a39cbbcccc2de2ebc`.
- Keep v0.1.1 runtime floor at `Node.js >=22`; set v0.2.0 runtime floor to `Node.js >=24.11.0` after branch synchronization.
- `projectId` remains a Contract identity supplied by pre-design. The integration must not introduce a second project ID or modify the Contract Schema.
- Do not open the production Layout tab until real OpenPencil Runtime smoke and production persistence gates pass.

---

### Task 1: Close v0.1.1 Release Metadata

**Files:**
- Modify: `docs/acceptance/report-studio-v0.1.1-verification.md`
- Modify: `docs/handoff/PRESENTATION_WORKSPACE_LIVE_LINK_IMPLEMENTATION.md`
- Modify: PR #6 metadata

**Interfaces:**
- Consumes: v0.1.1 branch HEAD, current successful Windows/Linux checks, real-host acceptance evidence.
- Produces: one current release-candidate narrative anchored to the branch HEAD and an accurate PR description.

- [ ] **Step 1:** Confirm `feat/report-studio-v0.1.1-hardening` HEAD and all required checks are successful.
- [ ] **Step 2:** Update the acceptance document so the release candidate is explicitly composed of the verified core commit plus Workspace Live Link closure commits up to the current branch HEAD.
- [ ] **Step 3:** Update PR #6 body to remove obsolete statements about running CI, absent branch protection, and invalid Provider credentials.
- [ ] **Step 4:** Mark PR #6 ready for review only after the documentation update checks pass.
- [ ] **Step 5:** Merge PR #6 using a merge commit and an expected-head SHA guard.

### Task 2: Synchronize v0.2.0 with the New main

**Files:**
- Preserve: `packages/studio-layout-*`
- Preserve: `tools/layout-spike/**`
- Preserve: `.github/workflows/report-studio-v0.2.0-layout-ci.yml`
- Merge from: latest `main`

**Interfaces:**
- Consumes: merged v0.1.1 `main` and the 14 v0.2.0 layout commits based on `29294803681758e0b65a0bc51f7ed9ab810cde9a`.
- Produces: a two-parent merge commit on `feat/report-studio-v0.2.0-layout` retaining both histories.

- [ ] **Step 1:** Compare latest `main` and `feat/report-studio-v0.2.0-layout` and record the common ancestor.
- [ ] **Step 2:** Merge latest `main` into `feat/report-studio-v0.2.0-layout` without rebasing or squashing the layout history.
- [ ] **Step 3:** Resolve root `package.json`, root lockfile, CI, and documentation in favor of the verified v0.1.1 foundation plus explicit v0.2.0 additions.
- [ ] **Step 4:** Verify no v0.1.1 runtime, Workspace Live Link, release-integrity, vendor, or DSH tests were dropped.

### Task 3: Align the v0.2.0 Node Runtime Floor

**Files:**
- Modify: `package.json`
- Modify: `.github/workflows/report-studio-v0.2.0-layout-ci.yml`
- Modify: relevant v0.2.0 README, architecture, acceptance, and handoff documents

**Interfaces:**
- Consumes: `@zseven-w/dsh-openpencil@0.1.0-rc.9` engine requirement `>=24.11.0`.
- Produces: one v0.2.0 runtime floor and CI matrix with no hidden Node 22 execution path for OpenPencil.

- [ ] **Step 1:** Add a failing verification asserting v0.2.0 `engines.node` is `>=24.11.0` and the layout/OpenPencil job uses Node 24.11 or newer.
- [ ] **Step 2:** Update v0.2.0 root `package.json` to version `0.2.0-alpha.3` and `engines.node` to `>=24.11.0`.
- [ ] **Step 3:** Run the complete v0.1.1 regression gate under Node 24.11+.
- [ ] **Step 4:** Keep the released v0.1.1 documentation explicit that its floor remains Node 22; do not retroactively alter the v0.1.1 compatibility promise.

### Task 4: Establish the Project Identity Bridge

**Files:**
- Modify: `packages/studio-layout-integration/index.mjs`
- Modify: `packages/studio-layout-integration/index.test.mjs`
- Modify: `docs/architecture/report-studio-v0.2.0-layout-integration-contract.md`
- Add/Modify: pre-design compatibility regression documentation

**Interfaces:**
- Consumes: `CanonicalSnapshot.project.projectId`, selected Canonical Page, resolved page assets, project revision.
- Produces: `buildLayoutSourceIndex({ snapshot, pageId })` or an equivalently explicit snapshot-level projection; no duplicate page-level project identity.

- [ ] **Step 1:** Add failing tests proving layout obtains `projectId` from `snapshot.project.projectId`, rejects page/project mismatches, and preserves the same Contract project identity end-to-end.
- [ ] **Step 2:** Replace the draft-only API with a snapshot-aware API such as `buildLayoutSourceIndex({ snapshot, pageId, resolvedPageAssets })`.
- [ ] **Step 3:** Keep `projectId` out of Canonical Page duplication; LayoutPageDocument receives the project ID from the snapshot-level projection.
- [ ] **Step 4:** Add a regression covering pre-design standard directory → Workspace Live Link → Canonical Snapshot → LayoutPageDocument with one unchanged `projectId`.
- [ ] **Step 5:** Document that this is a Presentation-internal integration correction, not a Presentation Contract 0.1.0 or pre-design Schema change.

### Task 5: Unify IDs and Revision Semantics

**Files:**
- Modify: `packages/studio-contracts/index.mjs`
- Modify: `packages/studio-layout-contracts/index.mjs`
- Modify: `packages/studio-layout-engine-binding/index.mjs`
- Modify: corresponding tests

**Interfaces:**
- Consumes: the v0.1.1 UUIDv7/stable-ID factory and project-level Revision model.
- Produces: unified `layoutPage`, `layoutElement`, and `layoutEngineBinding` IDs plus project-revision-based layout synchronization metadata.

- [ ] **Step 1:** Add layout ID kinds to the authoritative Studio ID factory.
- [ ] **Step 2:** Remove duplicated UUIDv7 generation from layout packages.
- [ ] **Step 3:** Rename layout revision fields from draft-local wording to project-revision wording while preserving an explicit migration path for alpha fixtures.
- [ ] **Step 4:** Add tests proving no layout/view operation creates an unrelated project content Revision.

### Task 6: Build the Unified Verification Gate

**Files:**
- Modify: `package.json`
- Modify: `.github/workflows/report-studio-v0.2.0-layout-ci.yml`
- Add/Modify: v0.2.0 convergence verification scripts

**Interfaces:**
- Consumes: v0.1.1 complete gate, Workspace Live Link gate, layout foundation, OpenPencil Adapter tests.
- Produces: a Windows/Linux product gate and a Node 24.11+ OpenPencil-specific gate.

- [ ] **Step 1:** Include all layout package tests in root `npm test` or a mandatory `verify:layout` called by `verify:all`.
- [ ] **Step 2:** Run v0.1.1 regression, Contract, Workspace, browser, DSH, release-integrity, layout, and OpenPencil Adapter gates.
- [ ] **Step 3:** Add a separate real-runtime job when the isolated OpenPencil harness is available; do not mark it passed before actual execution.
- [ ] **Step 4:** Verify Windows and Linux with Node 24.11+ and current-HEAD tarball smoke.

### Task 7: Publish the Convergence Review and Handoff

**Files:**
- Create: `docs/review/2026-09-04-report-studio-v0.1.1-v0.2.0-convergence-review.md`
- Create: `docs/handoff/2026-09-04-report-studio-v0.2.0-convergence-handoff.md`

**Interfaces:**
- Consumes: merge SHAs, test runs, Node decision, project-identity tests, remaining OpenPencil Runtime boundary.
- Produces: the authoritative entry point for subsequent v0.2.0 development.

- [ ] **Step 1:** Record exact branch/merge SHAs and all test evidence.
- [ ] **Step 2:** Give `PROJECT_ID_STANDARD_IMPACT=NO_SCHEMA_CHANGE` its own prominent section.
- [ ] **Step 3:** Record `V0_2_0_NODE_FLOOR=>=24.11.0` and the compatibility cost: Node 22 users must upgrade for v0.2.0.
- [ ] **Step 4:** State that the next development phase is isolated real OpenPencil Runtime smoke, then Layout persistence and production UI integration.
