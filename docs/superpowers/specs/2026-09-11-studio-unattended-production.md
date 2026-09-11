# Report Studio unattended production — implementation specification

Date: 2026-09-11. Target: `feat/report-studio-v0.2.0-layout`.
Source snapshot: `8c50ecda05b9aab2f2ebff499f85cdd868e3e1c9`.
Product version remains `0.2.0-alpha.3`; plugin remains `0.1.1`. This is development work, not a release.

## Ownership and authority

Pre-design supplies professional methods, narrative, source selection, design intent and visual critique.
DSH supplies sessions, model routing and the tool loop. Studio does not introduce a model configuration,
strategy engine, autonomous agent scheduler or additional per-page approval.

Host user initiation creates an existing scoped direct-edit grant. Studio persists one batch per grant;
Agent parameters cannot enlarge the grant, reset the candidate budget or change manual locks.
Session identity comes from native DSH execution context. Browser writes require the existing local
single-user deployment boundary and same-origin JSON POST. This is not multi-user authentication.

## Contract and quality

`validateDesignIntent({intent,pageId,sourceKeys})` accepts a bounded legacy string or a versioned object:
`schemaVersion`, `pageId`, `coreJudgment`, `evidence`, `readingOrder`, `hierarchy`, `visualRole`,
optional `preferredSkeleton`, and `constraints`. Source keys must exist. No permission fields are accepted.
The skeleton is upstream metadata, not a Studio template-selection rule. Schema validation does not
prove that a statement is true or professionally adequate.

`layout-dom-checks-v3` measures real DOM text ranges, bounds, overflow, image decode, opacity, text
collision and provable opaque shape obstruction. Safe areas, small gaps, near-alignment, crop,
upscaling, density and measurable contrast produce structured warnings. Image alpha, rotated content
and image/text composition require visual critique, not fabricated aesthetic scores. A frame crossing
another frame is not proof that text is hidden. Warnings are preserved; they are not human-approval steps.

Real Chromium previews use the shared editor renderer with verified asset bytes in an isolated in-memory
page and blocked external requests. A PNG receipt binds candidate, source, canvas, renderer and check
version. Existing valid receipts can be reused after reopen; old check versions require re-rendering.
Only a successful real preview and matching current state permit direct application.

## Human protection

`designProtections` is operational metadata, not a Standard Project schema extension. Each page has a
protection revision, optional page lock, and element locks with live source-key dependencies.
Human lock updates use project and protection CAS; edits can save and lock atomically. Agent and
upstream content writes are checked centrally in the repository. Layout preparation and publication
both recheck locks, including locks created after preview. Locked elements cannot be removed.
A lock is not proof that the layout passed QA. A changed locked page still requires a current preview
before export. Unrelated asset catalog additions do not change the locked element or stale every page.

## Batch protocol

`createDesignBatchService` implements `begin`, `next/status`, `exception`, `retry`, and `cancel`.
One persisted batch uses one host grant, maximum 100 pages and three distinct candidate attempts per
page. One active publication page returns a deterministic next action and idempotency key. DSH executes
that action. Existing in-flight candidates are resumed, not recreated. Browser reload is not a new task.
Cancellation persists and revokes its run. Grant expiry yields `blocked_external`; it is never extended
by model input. Protected pages are counted as skipped, not completed. An unreadable page becomes a
per-page exception while the rest of the batch remains runnable. Retry does not reset the budget.

Completion is reconstructed from applied layouts and matching current-source, current-QA PNG receipts.
Agent success messages cannot mark completion. Status records and exception summaries are bounded and
persist outside the canonical content. New assets unrelated to a page do not invalidate its source hash;
project-wide rules and common source-material manifests conservatively remain dependencies.

## Delivery

`captureCheckedDelivery` freezes one canonical revision, requires matching applied current-QA previews,
verifies asset and PNG bytes and dimensions, enforces page/byte limits and refuses stale revisions.
`createDeliveryExportService.export({formats,signal})` produces selected HTML, PDF and PPTX plus
`manifest.json` and `source.json`. All three audience-facing formats use exactly the checked PNG pages.

**Delivery mode is `verified-preview-images`; `editableObjects` is false.** PPTX contains one full-page
image per slide. PDF text is also rasterized; it is not searchable or accessible native text. Studio
canonical/layout JSON is supplied separately; it is not a newly implemented automatic source re-import
format. Native object-level PPTX export and searchable PDF are not claimed by this increment.

PPTX uses a small OPC/XML scaffold originally generated with PptxGenJS 4.0.0 and a bounded stored-ZIP
writer. No library, font files or browser binaries are embedded in the plugin for this export. PDF uses
the existing Playwright/Chromium dependency. Outputs publish through unique no-clobber directories;
publication is serialized against content CAS. Failure before publication removes staging files.
File serving validates IDs, paths, symlinks and manifest hashes. Existing finished exports are immutable
historical deliveries, not silently updated when a project changes.

## Integration

Native tools: `studio_begin_design_batch`, `studio_next_design_batch`,
`studio_report_design_exception`, `studio_export_delivery`, plus the existing context/candidate/preview/
submit tools. Preview reads reuse exact valid evidence. No Agent unlock tool is exposed.

Host UI/API: start a direct batch, status, resume, cancel, retry one exception, manual locks and delivery
links. All strategy instructions stay with Pre/DSH. The standalone server remains a manual/tool fallback,
not a replacement for native DSH automation.

## Acceptance and non-claims

Unit and integration tests cover malformed input, source references, publication races, locks, restart,
budget, failure isolation, preview reuse, stale output, corrupt bytes, API boundaries and image formats.
`npm run verify:unattended` runs 12 deterministic technical pages using actual Chromium, reopens after
page six, verifies candidate/preview reuse and exports all formats. It is not a live model run or a
professional report-quality benchmark. Test logs distinguish environment blocks from assertions.

Release still requires the full-history repository, Linux/Windows CI, the pinned native runtime, and a
live DSH session with Pre-design and an image-capable model. No main merge, release or remote push is
implied by local tests or a downloadable patch.
