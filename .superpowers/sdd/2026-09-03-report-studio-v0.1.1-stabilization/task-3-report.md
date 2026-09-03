# Task 3 Report — Binary ObjectStore and Asset Ingestion

## RED

- `node --test --test-name-pattern="content-addressed blobs" apps/studio-local/repository.test.mjs` failed because `repository.putBlob` did not exist.
- `node --test --test-name-pattern="controlled asset ingestion" apps/studio-local/server.test.mjs` failed with `404 not_found` before the ingestion route existed.
- `node --test --test-name-pattern="standard fixture imports" packages/studio-standard-adapter/index.test.mjs` failed because no Blob was written and the Canonical archive still contained Base64.
- `node --test --test-name-pattern="legacy page Data URLs" apps/studio-local/repository.test.mjs` failed because `repository.migrateLegacyAssets` did not exist.

## GREEN

- Repository writes stream bytes to same-volume staging, syncs/closes, hashes and atomically publishes `*.blob`; a 20 MiB regression proves byte/hash round-trip and duplicate reuse.
- Standard Adapter archives non-JSON managed files as `{ relativePath, objectRef, sizeBytes, mimeType, sha256 }`; no `dataBase64` or Data URL enters the imported Canonical snapshot. Standard import/export receives Repository `putBlob`/`openBlob` only through `standard-project.mjs`.
- Browser upload posts bytes to controlled ingestion, which accepts only PNG/JPEG signatures under 20 MiB, persists ObjectRefs, and serves content only when the asset is referenced by the current project.
- Explicit `migrateLegacyAssets()` leaves legacy state readable until invoked, then replaces valid legacy Data URLs with ObjectRefs in a new content revision.
- Agent projection intentionally contains project summary plus the selected page only, with binary/archive/migration fields omitted.

## Verification

- Focused RED/GREEN commands above completed as recorded.
- `npm test` before commit: 67/68 pass; the sole failure is the release-integrity test that intentionally compares regenerated vendor bytes against the pre-task `HEAD`.
- `npm run sync:vendor` completed from authoritative source; the post-commit full rerun is required because release-integrity binds the package to current `HEAD`.

## Scope and concerns

- No frozen Contract Schema, IDs or Schema hash were modified.
- No Task 4 content-block identity work was performed. Export uses the new `openBlob` interface solely to preserve existing restoration behavior; no Task 5 staging/export publication was introduced.

## Fix round 1 — review remediation

### RED evidence

- `npm test -- apps/studio-local/repository.test.mjs apps/studio-local/server.test.mjs packages/studio-dsh-plugin/host.test.mjs packages/studio-dsh-plugin/runtime.test.mjs` produced 7 expected failures before the repair: missing `verifyBlob`, accepted new inline Data URLs, absent image dimensions/validation, absent DSH asset routes, and unprojected DSH context.
- The later focused adapter regression changed a newly-created SVG PageAsset from `dataUrl` to `objectRef`; the old export path could not materialize that object reference.

### GREEN evidence

- `npm run sync:vendor` → `Report Studio DSH vendor sync PASS entries=12`.
- `node --test apps/studio-local/repository.test.mjs apps/studio-local/server.test.mjs packages/studio-dsh-plugin/host.test.mjs packages/studio-dsh-plugin/runtime.test.mjs packages/studio-standard-adapter/index.test.mjs` → 30 passed, 0 failed.

### Closed findings

- A shared `asset-service.mjs` now drives standalone and `/report-studio` DSH ingestion/content routes. DSH routes bind the repository to `sessionId`; a host regression proves upload, same-session preview, and cross-session 404. Browser preview URLs include the DSH mount prefix and session query.
- DSH `studio_get_context` now uses the vendored `projectAgentContext`: project summary, active selected page, submission and annotations only; it excludes archive data, all pages and outline. The runtime regression injects an archive sentinel and proves it is absent from serialized tool output.
- Ingestion validates PNG/JPEG structure and trustworthy non-zero dimensions, rejects truncated/zero/oversized/mime-mismatched inputs, records dimensions in PageAsset metadata, and retains the 20 MiB byte limit.
- Repository publication rejects newly introduced `dataUrl`/`dataBase64` asset fields. Legacy state remains readable and is deliberately marked only in the legacy regression; explicit migration removes it. Standard export accepts ObjectRefs, not newly-created inline Data URLs.
- Blob writes loop through partial writes, fsync/close, re-hash and stat the staging file before rename, and expose `verifyBlob`; both same-size corruption and injected partial-write regressions pass. `openBlob` verifies before reads.
- The 20 MiB regression uses 80 chunks, creates two revisions reusing one ObjectRef, checks one blob file and asserts both serialized Canonical snapshots stay below 100 KiB with no binary fields.
- Ingest validates page/revision before Blob persistence and records a JSONL orphan record if publication subsequently loses its revision race. Archive restoration now streams Blob bytes to the export target; Task 5 atomic staging/publication remains deliberately out of scope.

### Changed files and concerns

- Changed authoritative files: `apps/studio-local/{asset-service.mjs,repository.mjs,server.mjs,agent-context.mjs,public/app.js}`, `packages/studio-dsh-plugin/lib/{index.js,runtime.js}`, `packages/studio-standard-adapter/index.mjs`, and the DSH vendor manifest plus paired regressions/vendor output.
- Frozen Contract files, Schema Set hash and stable ID rules remain untouched (`git diff -- contracts/presentation-standard-project` was empty).
- Task 5 still owns atomic export staging and publication. This fix removes the known archive `Buffer.concat` path but does not claim a Task 5 export protocol.
