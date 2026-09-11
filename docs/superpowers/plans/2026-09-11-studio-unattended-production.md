# Studio Unattended Production Implementation Plan

> For agentic workers: execute inline with superpowers:executing-plans and test-driven-development.

**Goal:** Deliver the approved Presentation automation toolchain on the existing layout branch.
**Architecture:** Add small validated tool modules around the existing repository, design service,
real Chromium renderer and DSH registration. Keep model/strategy decisions outside Studio.
**Tech Stack:** Node >=24.11.0, native node:test, Playwright Chromium, existing LayoutStore/CAS.
**Spec:** `docs/superpowers/specs/2026-09-11-studio-unattended-production.md`.

## Global constraints
Same branch; no main merge or release; no Pre changes; no Standard Project schema mutation;
no second manual approval; no model/provider configuration in Studio; no inline binary state.

## Tasks and validation
- [x] A. Baseline: reproduce `scripts/migrate-standard-asset-references.test.mjs`; fix
  platform-neutral contained paths; add malformed/traversal tests; rerun exact failed test.
- [x] B. Structured intent: add `packages/studio-layout-core/design-intent.mjs` and tests.
  `validateDesignIntent({intent,pageId,sourceKeys})` preserves known reference identities,
  limits strings/arrays/numbers, rejects unknown authority and unsupported constraints.
  Integrate into `design-service`, `design-context`, native `design-tools` with legacy strings.
  Verify invalid inputs do not leave candidates or revisions.
- [x] C. QA: add `packages/studio-layout-core/layout-quality.mjs` pure checks and tests;
  extend real `layout-preview` DOM observation and checks version. Test colliding text,
  covered text, low contrast, safe margins, deliberate backgrounds, crops and density.
  Run real Chromium fixture tests before accepting results.
- [x] D. Protection: add `apps/studio-local/design-protection.mjs` with operational locks;
  integrate current-context checks and publication CAS, human layout API/editor and content
  edits. Test post-preview lock races, restart, foreign ids, idempotent toggles, and
  unchanged locked elements remaining verifiable.
- [x] E. Batch: add `apps/studio-local/design-batch.mjs` and native tools. Use persisted host
  run scope, one active publication page, max3 candidates/page, immutable progress receipts.
  Test next/resume/restart/cancel, failed page isolation, budget, scope and idempotency.
  Completion is derived from accepted real candidate evidence, never agent success flags.
- [x] F. Exports: strengthen `standard-project` freshness check; add frozen delivery export
  service with HTML/PDF/PPTX plus manifest. Require current preview/checks/asset hashes,
  bound bytes/pages/time, sanitize names and no-clobber publish. Test all formats,
  corruption, stale source, cancellation, reload and snapshot concurrency.
- [x] G1. Local integration: native DSH tools + browser status/exceptions/locks/export controls;
  sync vendor entries and package copies; add realistic multi-page acceptance fixtures.
  Run local root/layout tests and retain actual results, including environmental failures.
- [ ] G2. External integration: full-history `verify:all`, Linux/Windows CI, native DSH
  two-plugin/model acceptance. Local fixtures do not substitute for these gates.
- [x] H1. Local review: inspect diffs, fix reproduced findings, reconcile docs/status/version,
  archive source and an upstream-applicable patch with test evidence.
- [ ] H2. Remote publication: apply on the existing branch, verify real upstream history,
  publish commits without force or main merge, and confirm current CI. Remote tools were
  unavailable in this execution; this item must not be marked complete.

## Test cycle per task
Write a failing behavior test, run it and retain the red result, implement the narrow
behavior, rerun to green, then run its dependent suites. Baseline evidence is separate
from new regressions. Save verification output outside tracked source; commit a compact
truthful handoff with exact commands and outstanding live-provider requirements.

## Recovery and evidence

Previous uncommitted feature files did not survive; this execution rebuilt from the verified source
snapshot. The isolated local baseline is a synthetic Git commit, not upstream Git history. Use the
handoff and snapshot SHA for patch application; do not push this synthetic Git history into the repo.
The development bundle contains source, a patch and executed logs. Independent PDF/PPTX opening and
pixel comparisons supplement the 12-page technical fixture. They do not prove native PowerPoint
editing or live DSH model behavior.
