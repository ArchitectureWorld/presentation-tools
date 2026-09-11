# Deployed Studio baseline recovery

## Purpose

This recovery commit restores the already deployed Review worker and ordinary-reversible auto-apply behavior. The source recovery started from baseline `c207647d046918ffe1bc56a3f37fc4ccfcb96f46`; while that work was in progress, commit `bcf461ca3f909492eca055ccf263550e3928862f` independently moved the Report Studio version badge to the top right. This recovery preserves that newer commit and does not introduce the next Report Design feature set.

The recovery source was a read-only 52-file installed-package backup. Package files under `vendor/` were mapped back to their authoritative repository source paths. Generated vendor files are not part of this recovery commit; some vendor synchronization output already landed with `bcf461c` and is intentionally preserved rather than rewritten.

## Restored source mapping

| Installed package path | Authoritative source path |
| --- | --- |
| `lib/index.js` | `packages/studio-dsh-plugin/lib/index.js` |
| `lib/isolated-worker.js` | `packages/studio-dsh-plugin/lib/isolated-worker.js` |
| `lib/runtime.js` | `packages/studio-dsh-plugin/lib/runtime.js` |
| `README.md` | `packages/studio-dsh-plugin/README.md` |
| `vendor/apps/studio-local/agent-bridge.mjs` | `apps/studio-local/agent-bridge.mjs` |
| `vendor/apps/studio-local/review-task-runner.mjs` | `apps/studio-local/review-task-runner.mjs` |
| `vendor/apps/studio-local/public/app.js` | `apps/studio-local/public/app.js` |
| `vendor/apps/studio-local/public/dsh-native-runtime.js` | `apps/studio-local/public/dsh-native-runtime.js` |
| `vendor/apps/studio-local/public/styles.css` | `apps/studio-local/public/styles.css` |
| `vendor/packages/studio-core/index.mjs` | `packages/studio-core/index.mjs` |

The first audit reported 17 raw SHA-256 differences: the ten rows above plus seven files whose bytes differed only by CRLF/LF conversion. `git diff --no-index --ignore-cr-at-eol` was empty for those seven files. A pre-`bcf461c` recovery pack subsequently proved all 52 Git-clean-filtered blobs equivalent to the installed backup. No layout implementation was reverted.

The final branch package is intentionally not byte-for-byte or semantically identical in two UI files: `public/index.html` and `public/styles.css` retain the `bcf461c` version-badge change. Those files belong to the concurrent user commit, not this recovery commit.

## Preserved behavior and boundaries

- Each Review task gets an isolated in-process worker context and task identity.
- The worker receives only selected model scalars and the two scoped Studio tools; it receives neither parent history nor credentials.
- Output is validated against the frozen Submission, project, scope, revision, writable IDs, allowed commands, risk levels, and annotation IDs.
- Timeout and cancellation abort the model request and allow a separate retry task.
- An `ordinary_reversible` Proposal is applied through the existing Repository/CAS acceptance path and its ReviewRun closes.
- Structural Proposals remain pending for explicit user confirmation.
- The isolation boundary is capability/context isolation, not an operating-system sandbox.

The package export map is unchanged. `lib/index.js` adds only an internal relative import of `./isolated-worker.js`; the worker continues to import contracts through `../vendor/...`, so the existing vendor build layout remains authoritative.

## Rebuild and verification

From the repository root:

```powershell
node --test --test-concurrency=1 apps/studio-local/dsh-native-ui.test.mjs apps/studio-local/review-task-runner.test.mjs packages/studio-dsh-plugin/host.test.mjs packages/studio-dsh-plugin/isolated-worker.test.mjs
npm test
```

For a package check, run `npm pack --pack-destination <safe-output-directory>` from `packages/studio-dsh-plugin`. Its `prepack` script rebuilds only this checkout's `packages/studio-dsh-plugin/vendor` from the 22-entry source manifest. Do not point the build at a formally installed package.

A historical recovery-only pack contains 52 files. Comparing every packed file from that pack with the read-only installed backup using the repository path's Git clean filter produced 52 equivalent blobs and zero semantic differences. Raw SHA-256 differed for 15 text files because the source checkout and installed backup used different CRLF/LF representations; `git diff --no-index --ignore-cr-at-eol` was empty for each of them.

For the final branch package, repeat the same 52-file comparison after committing the recovery. The expected semantic delta is limited to `vendor/apps/studio-local/public/index.html` and `vendor/apps/studio-local/public/styles.css`, both inherited from `bcf461c`; every other packed file must remain semantically equivalent to the installed backup.
