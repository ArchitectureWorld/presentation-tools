# 2026-09-11 — unattended Presentation implementation handoff

## Authority

Target repository: ArchitectureWorld/presentation-tools.
Target branch: `feat/report-studio-v0.2.0-layout`.
Patch base: upstream `8c50ecda05b9aab2f2ebff499f85cdd868e3e1c9`.
Root remains `0.2.0-alpha.3`; DSH plugin remains `0.1.1`; Standard Project remains `0.1.0`.
This is not a versioned release and must not overwrite the published package under its existing version.
No Pre-design modification, no main merge, no new remote branch, no force push.

## Read in this order

1. `docs/superpowers/specs/2026-09-11-studio-unattended-production.md` — implemented behavior and limits.
2. `docs/superpowers/plans/2026-09-11-studio-unattended-production.md` — completed versus external tasks.
3. Bundle `TEST_REPORT.md`, `verification-results.json`, and `test-logs/` — exact executed commands/results.

## Implemented modules

- `design-intent.mjs`: bounded DesignIntent with actual source references, no authority.
- `layout-quality.mjs` / `layout-preview.mjs`: DOM observations, current-QA PNG, no network inputs.
- `design-protection.mjs`: human locks, source protection, prepare and publish race checks.
- `source-dependencies.mjs`: page-scoped asset dependencies; global rules/materials remain conservative.
- `design-batch.mjs`: durable next-action protocol; DSH remains orchestrator, three candidates/page.
- `delivery-snapshot.mjs` / `delivery-export.mjs`: current evidence, immutable checked-image delivery.
- `production-api.mjs` / `host-request.mjs`: scoped host actions and safe delivery file reads.
- Native DSH registrations, editor locks, batch summary/retry/cancel/export controls and vendor copies.
- Migration preflight and platform-neutral contained paths.

Review fixes include unrelated assets staling every page, a locked title blocking independent assets,
one unreadable page stopping its whole batch, transparent images falsely flagged as opaque blockers,
old cached QA accepted at apply, and symlink replacement of a delivery manifest.

## Applying the patch safely

Use a clean real checkout and preserve all user changes first. The source archive intentionally contains
no `.git` history, dependencies, credentials or fonts. The local verification Git commit is synthetic;
never replace the real branch with that local history. Use the accompanying patch instead.

```sh
git fetch origin
git switch feat/report-studio-v0.2.0-layout
git status --short
git rev-parse HEAD
# Expected clean tree and upstream patch base above. If newer commits exist, review their diff first.
git apply --check /path/to/report-studio-unattended.patch
git apply /path/to/report-studio-unattended.patch
npm ci
npm ci --prefix contracts/presentation-standard-project --ignore-scripts --no-audit --no-fund
npm run sync:vendor
npm run verify:all
```

Use Node 24.11.0 or newer, installed Chromium/Edge, the pinned Contract Python dependencies from CI,
and the pinned OpenPencil runtime documented in the repository. Do not lower gates to make an isolated
environment pass. Review staged changes, run current CI and commit/push the existing branch only after
successful real-checkout verification; do not force push or merge main.

## Automated design route

In a native DSH Session with Pre-design loaded, open Report Studio and start a scoped direct design task.
It persists a batch and sends the initial DSH prompt. `studio_next_design_batch` returns the exact next
page/action/idempotency key. Prepare → actual preview → Pre critique → direct apply → next.
A restart resumes the same candidate/preview. Exceptions do not mark completion. Retry preserves the
three-candidate budget. Cancellation revokes the original grant. Expired grants require a fresh explicit
host authorization, not a model-created extension. No extra per-page approval was added.

## Delivery limitations

HTML/PDF/PPTX are **checked image-based pages**. `source.json` preserves the editable canonical/layout
representation separately. PPTX is not object-editable; PDF text is not searchable. UI and tool outputs
explicitly report `editableObjects:false`. Native-object export is a separate remaining enhancement.
The 12-page fixture proves deterministic tool execution and recovery, not professional design quality.

## Required real-environment gates

- Full original Git history for frozen historical Contract checks.
- Unrestricted authorized local browser testing of the app's loopback URLs; do not bypass administrator policy.
- Windows CI (local execution was Linux only).
- Real DSH + Pre + image-capable model task, cancellation/resume, real user locks and final delivery.
- Installed plugin artifact smoke from the current checked source, not an older published tarball.

Current tool access did not permit a remote push. Apply/publish from a real checkout and retain these
remaining gates in the handoff until their actual logs exist.
