# Report Studio v0.1.1 Production Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a deployable Report Studio 0.1.1 whose legacy data migration, Revision CAS, DSH review flow, and Presentation Standard Project Directory 0.1.0 adapter form one verified product path.

**Architecture:** Keep the Standard Project Contract neutral and introduce Studio-owned runtime contracts, a content-addressed local repository, and a dedicated standard adapter. The local HTTP server and native DSH plugin both call the same Repository transaction API; UI requests carry `baseRevision`, while ReviewSubmission context is read from its frozen Revision.

**Tech Stack:** Node.js 22 ESM, built-in `node:test`, local JSON/content-addressed object storage, Presentation Standard Project Directory 0.1.0 validator, vanilla browser UI, DSH 0.1.1-rc.2.

**Spec:** `docs/superpowers/specs/2026-09-03-report-studio-v0.1.1-production-hardening-design.md`

## Global Constraints

- Product version is `0.1.1`; Presentation Standard Project Directory remains `0.1.0`.
- Legacy `state.json` is never overwritten or deleted during migration.
- One Node.js process may write one data directory; cross-process shared writing is rejected.
- Canonical Snapshot excludes annotations, submissions, proposals, DSH sessions, and workspace view.
- Standard export excludes Studio runtime governance records and never writes outside `<data-dir>/exports/`.
- DSH is the only Agent runtime; Report Studio does not call an LLM directly.
- Layout, pagination, and finished PPTX/PDF/HTML export remain deferred to `0.2.0`.

---

### Task 1: Runtime contracts, typed UUIDv7, and domain invariants

**Files:**
- Create: `packages/studio-contracts/index.mjs`
- Create: `packages/studio-contracts/index.test.mjs`
- Modify: `packages/studio-core/index.mjs`
- Modify: `packages/studio-core/index.test.mjs`

**Interfaces:**
- Produces: `createStudioId(kind, options?)`, `StudioError`, `ERROR_CODES`, `assertCanonicalSnapshot(snapshot)`, `canonicalFromState(state)`, `projectStateFromParts(parts)`.
- Produces: content actions that accept `{ baseRevision }` and cascade-delete all descendant-linked pages.

- [ ] **Step 1: Write failing ID, snapshot, and cascade tests**

```js
assert.match(createStudioId('page'), /^page_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
assert.throws(() => assertCanonicalSnapshot({ project: {}, outline: [], pages: [{ id: 'page_bad', outlineNodeId: 'missing' }] }), /invalid_reference/)
assert.equal(result.state.pages.length, 0)
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `node --test packages/studio-contracts/index.test.mjs packages/studio-core/index.test.mjs`  
Expected: FAIL because the new contract exports and descendant cascade do not exist.

- [ ] **Step 3: Implement stable errors, UUIDv7 generation, canonical extraction, and invariants**

```js
export class StudioError extends Error {
  constructor(code, message, details = undefined, statusCode = 400) {
    super(message); Object.assign(this, { code, details, statusCode })
  }
}
export const ERROR_CODES = Object.freeze({
  STALE_REVISION: 'stale_revision', INVALID_REFERENCE: 'invalid_reference',
  MIGRATION_REQUIRED: 'migration_required', DISPATCH_FAILED: 'dispatch_failed',
})
```

- [ ] **Step 4: Replace truncated UUIDv4 creation and fix subtree deletion**

Collect the selected outline node plus descendants into a `Set`, remove the whole subtree, remove every page whose `outlineNodeId` belongs to that set, and repair `activePageId`.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `node --test packages/studio-contracts/index.test.mjs packages/studio-core/index.test.mjs`  
Expected: PASS.

- [ ] **Step 6: Commit Task 1**

```bash
git add packages/studio-contracts packages/studio-core
git commit -m "feat: add studio runtime contracts and stable ids"
```

### Task 2: Content-addressed repository and Revision CAS

**Files:**
- Create: `apps/studio-local/repository.test.mjs`
- Rewrite: `apps/studio-local/repository.mjs`
- Modify: `apps/studio-local/server.test.mjs`

**Interfaces:**
- Produces: `repository.status()`, `getState()`, `getSnapshotAt(revision)`, `transactContent({ baseRevision, source, detail, idempotencyKey }, mutator)`, `transactOperational(mutator)`, `replaceForTest(next)`.
- Persists: `control.json`, `objects/sha256/<hash>.json` and an exclusive lock file.

- [ ] **Step 1: Write failing CAS, reload, lock, and crash-orphan tests**

```js
const base = repository.getState().project.currentRevision
await repository.transactContent({ baseRevision: base, source: 'human' }, mutateA)
await assert.rejects(
  repository.transactContent({ baseRevision: base, source: 'human' }, mutateB),
  error => error.code === 'stale_revision',
)
assert.equal((await createRepository(dir)).getState().outline[0].title, 'A')
```

- [ ] **Step 2: Run repository tests and verify RED**

Run: `node --test apps/studio-local/repository.test.mjs`  
Expected: FAIL because the transactional repository API does not exist.

- [ ] **Step 3: Implement canonical JSON hashing and immutable object writes**

Write objects to a same-directory temporary file, fsync/close, rename to `objects/sha256/<hash>.json`, and verify an existing object has the expected bytes before reuse.

- [ ] **Step 4: Implement serialized transactions and final Head CAS**

```js
async function transactContent(input, mutator) {
  return enqueue(async () => {
    const control = await readControlFresh()
    assertRevision(control.projectHead.currentRevision, input.baseRevision)
    const candidate = await mutator(await loadHeadSnapshot(control))
    const snapshotRef = await objectStore.put({ kind: 'CanonicalSnapshot', value: candidate })
    const revisionRef = await objectStore.put(createRevisionRecord(control, snapshotRef, input))
    return publishHeadWithCas(control, revisionRef)
  })
}
```

- [ ] **Step 5: Verify two concurrent requests have one winner**

Run: `node --test apps/studio-local/repository.test.mjs apps/studio-local/server.test.mjs`  
Expected: PASS with one fulfilled request and one `stale_revision` rejection.

- [ ] **Step 6: Commit Task 2**

```bash
git add apps/studio-local/repository.mjs apps/studio-local/repository.test.mjs apps/studio-local/server.test.mjs
git commit -m "feat: add revisioned repository with atomic cas"
```

### Task 3: A1.1 supervised legacy migration

**Files:**
- Create: `apps/studio-local/migration.mjs`
- Create: `apps/studio-local/migration.test.mjs`
- Modify: `apps/studio-local/repository.mjs`
- Modify: `apps/studio-local/server.mjs`
- Modify: `apps/studio-local/server.test.mjs`

**Interfaces:**
- Produces: `inspectLegacyState(dataDir)`, `migrateLegacyState(dataDir)`, `repository.migrationStatus()`, `repository.applyMigration()`.
- Adds API: `GET /api/migration/status`, `POST /api/migration/apply`.

- [ ] **Step 1: Write failing success, rollback, idempotency, and API Gate tests**

```js
assert.equal((await repository.migrationStatus()).status, 'migration_required')
await assert.rejects(repository.transactOperational(value => value), error => error.code === 'migration_required')
const migrated = await repository.applyMigration()
assert.equal(migrated.status, 'ready')
assert.equal(JSON.parse(await readFile(backupPath, 'utf8')).project.id, legacy.project.id)
```

- [ ] **Step 2: Run migration tests and verify RED**

Run: `node --test apps/studio-local/migration.test.mjs apps/studio-local/server.test.mjs`  
Expected: FAIL because migration inspection and endpoints do not exist.

- [ ] **Step 3: Implement deterministic ID-map creation and reference rewriting**

Write `migration-map.json` before candidate control publication. Reuse existing entries on retry; preserve old IDs and Revision metadata under migration audit fields.

- [ ] **Step 4: Implement backup-first candidate migration and post-write reload validation**

Copy `state.json` byte-for-byte into `backups/<timestamp>/state.v0.1.0.json`; only publish `control.json` after objects and candidate control reload successfully.

- [ ] **Step 5: Add migration Gate responses**

`/api/health` remains 200 with `migrationStatus`; mutation endpoints return HTTP 428 and `{ error: { code: 'migration_required', ... } }` until migration completes.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run: `node --test apps/studio-local/migration.test.mjs apps/studio-local/repository.test.mjs apps/studio-local/server.test.mjs`  
Expected: PASS.

- [ ] **Step 7: Commit Task 3**

```bash
git add apps/studio-local/migration.mjs apps/studio-local/migration.test.mjs apps/studio-local/repository.mjs apps/studio-local/server.mjs apps/studio-local/server.test.mjs
git commit -m "feat: add supervised lossless legacy migration"
```

### Task 4: Presentation Standard Project adapter

**Files:**
- Create: `packages/studio-standard-adapter/index.mjs`
- Create: `packages/studio-standard-adapter/index.test.mjs`
- Create: `apps/studio-local/standard-project.mjs`
- Modify: `apps/studio-local/server.mjs`
- Modify: `apps/studio-local/server.test.mjs`

**Interfaces:**
- Produces: `readStandardProject(projectRoot)`, `standardToCanonical(documents)`, `canonicalToStandard(snapshot, preserved)`, `writeStandardProject({ snapshot, targetRoot })`.
- Adds API: `GET /api/standard/status`, `POST /api/standard/import`, `POST /api/standard/export`.

- [ ] **Step 1: Write failing fixture import and round-trip tests**

```js
const imported = await readStandardProject(fixtureRoot)
assert.equal(imported.snapshot.project.id, imported.documents['project.json'].projectId)
const exported = await writeStandardProject({ snapshot: imported.snapshot, preserved: imported.preserved, targetRoot })
assert.equal((await validateProjectDirectory(exported.projectRoot, { documentValidator })).valid, true)
```

- [ ] **Step 2: Run adapter tests and verify RED**

Run: `node --test packages/studio-standard-adapter/index.test.mjs`  
Expected: FAIL because adapter modules do not exist.

- [ ] **Step 3: Implement Contract-validated read and canonical mapping**

Preserve unsupported standard fields in an opaque `extensionPayload`; flatten standard outline parent references into the Studio tree and keep every stable ID unchanged.

- [ ] **Step 4: Implement safe export below `<data-dir>/exports/`**

Generate all required directories and manifests, materialize data-URL assets as files with SHA-256 and `sizeBytes`, and reject any target escaping the export root.

- [ ] **Step 5: Add import/export API transactions**

Import creates a new migration-style root Revision after validation. Export freezes the current Revision before writing and reports `{ projectRoot, revision, validation }`.

- [ ] **Step 6: Run adapter, Contract, and API tests**

Run: `node --test packages/studio-standard-adapter/index.test.mjs apps/studio-local/server.test.mjs contracts/presentation-standard-project/tests/contracts.test.mjs`  
Expected: PASS.

- [ ] **Step 7: Commit Task 4**

```bash
git add packages/studio-standard-adapter apps/studio-local/standard-project.mjs apps/studio-local/server.mjs apps/studio-local/server.test.mjs
git commit -m "feat: connect studio to standard project contract"
```

### Task 5: Frozen DSH context, retry, and idempotent Proposal creation

**Files:**
- Modify: `packages/studio-core/index.mjs`
- Modify: `packages/studio-core/index.test.mjs`
- Modify: `packages/studio-dsh-plugin/lib/runtime.js`
- Modify: `packages/studio-dsh-plugin/lib/index.js`
- Modify: `packages/studio-dsh-plugin/runtime.test.mjs`
- Modify: `packages/studio-dsh-plugin/host.test.mjs`
- Modify: `apps/studio-local/server.mjs`
- Modify: `apps/studio-local/agent-bridge.mjs`

**Interfaces:**
- Changes: `studio_get_context({ submissionId })`.
- Produces: `repository.getSnapshotAt(baseRevision)`, `markSubmissionDispatch`, `retrySubmission`, idempotent `createProposalFromAgent`.
- Adds API: `POST /api/review/:submissionId/retry`.

- [ ] **Step 1: Write failing frozen-context, stale, retry, and idempotency tests**

```js
const context = await runtime.getContext(sessionId, submission.id)
assert.equal(context.project.title, titleAtSubmission)
await assert.rejects(runtime.getContext(sessionId, submission.id), error => error.code === 'stale_review_submission')
assert.equal(first.proposalId, repeated.proposalId)
assert.equal((await runtime.getState(sessionId)).proposals.length, 1)
```

- [ ] **Step 2: Run DSH/core tests and verify RED**

Run: `node --test packages/studio-core/index.test.mjs packages/studio-dsh-plugin/runtime.test.mjs packages/studio-dsh-plugin/host.test.mjs`  
Expected: FAIL because context is current-state based and Proposal creation is not idempotent.

- [ ] **Step 3: Implement Submission state machine and deterministic idempotency key**

Submission creation sets `pending_dispatch`; successful prompt handoff sets `dispatched`; failures set `dispatch_failed` with reason; retry reuses the Submission ID and idempotency key.

- [ ] **Step 4: Require `submissionId` for context and load its frozen Snapshot**

Return `stale_review_submission` before exposing content when Head differs from `baseRevision`.

- [ ] **Step 5: Make Proposal creation atomic and idempotent**

Execute lookup, validation, Proposal creation, and Submission transition in one operational Repository transaction. Repeated calls return the existing Proposal.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run: `node --test packages/studio-core/index.test.mjs packages/studio-dsh-plugin/runtime.test.mjs packages/studio-dsh-plugin/host.test.mjs apps/studio-local/server.test.mjs`  
Expected: PASS.

- [ ] **Step 7: Commit Task 5**

```bash
git add packages/studio-core packages/studio-dsh-plugin apps/studio-local/server.mjs apps/studio-local/agent-bridge.mjs
git commit -m "feat: harden dsh review delivery and context"
```

### Task 6: UI migration, CAS, retry, and standard-project controls

**Files:**
- Modify: `apps/studio-local/public/index.html`
- Modify: `apps/studio-local/public/app.js`
- Modify: `apps/studio-local/public/styles.css`
- Modify: `apps/studio-local/public/dsh-native-runtime.js`
- Modify: `apps/studio-local/ui.contract.test.mjs`
- Modify: `apps/studio-local/responsive-ui.test.mjs`
- Modify: `apps/studio-local/dsh-native-ui.test.mjs`

**Interfaces:**
- UI sends `{ ...action, baseRevision: state.project.currentRevision }` for content mutations.
- UI exposes migration confirmation, retry, standard import/export, structured conflict messages, and deferred Layout state.

- [ ] **Step 1: Add failing UI contract assertions**

```js
assert.match(app, /baseRevision:\s*state\.project\.currentRevision/)
assert.match(html, /id="migration-gate"/)
assert.match(app, /\/api\/standard\/export/)
assert.match(app, /data-retry-submission/)
```

- [ ] **Step 2: Run UI tests and verify RED**

Run: `node --test apps/studio-local/ui.contract.test.mjs apps/studio-local/responsive-ui.test.mjs apps/studio-local/dsh-native-ui.test.mjs`  
Expected: FAIL because the new states and controls are absent.

- [ ] **Step 3: Implement migration Gate and structured error rendering**

Load health and migration status first. Keep editor controls disabled until status is `ready`; POST confirmation only after the user presses “备份并升级”.

- [ ] **Step 4: Implement CAS-aware writes, retry, import, and export interactions**

On `stale_revision`, refresh state and preserve a clear user-facing conflict message. Never automatically replay a structural command.

- [ ] **Step 5: Mark Layout as a `0.2.0` capability and update deletion copy**

Remove any path that silently switches from Layout back to Outline; render a disabled deferred-stage explanation instead.

- [ ] **Step 6: Run UI tests and six responsive viewports**

Run: `node --test apps/studio-local/*.test.mjs && npm run verify:ui`  
Expected: PASS.

- [ ] **Step 7: Commit Task 6**

```bash
git add apps/studio-local/public apps/studio-local/*.test.mjs
git commit -m "feat: expose production migration and conflict states"
```

### Task 7: Cross-platform Contract verification, release metadata, and documentation

**Files:**
- Modify: `package.json`
- Rename: `scripts/verify-v0.1.0.mjs` → `scripts/verify-v0.1.1.mjs`
- Create: `scripts/verify-e2e-v0.1.1.mjs`
- Modify: `scripts/verify-dsh-plugin.mjs`
- Modify: `contracts/presentation-standard-project/scripts/verify-all.mjs`
- Create: `.gitattributes`
- Modify: `README.md`
- Modify: `DSH_INSTALL.md`
- Modify: `docs/deployment/report-studio-v0.1.0-local-deployment.md`
- Modify: `packages/studio-dsh-plugin/package.json`
- Modify: `packages/studio-dsh-plugin/README.md`

**Interfaces:**
- Adds scripts: `verify:contracts`, `verify:e2e`; updates `verify:all` to run both.
- Documents exact Node, DSH, migration, standard import/export, backup, and rollback paths.

- [ ] **Step 1: Add failing release metadata and E2E checks**

```js
assert.equal(health.version, 'v0.1.1')
assert.equal(pluginPackage.version, '0.1.1')
assert.equal(exportValidation.valid, true)
assert.equal(recovered.project.currentRevision, accepted.revision.number)
```

- [ ] **Step 2: Normalize tracked Contract fixtures to LF and remove `python3` assumptions**

Use `.gitattributes` for Contract-managed text and choose Python via `python`, `python3`, or `py -3` probing in the verifier. Hashes must be computed from repository bytes, not newline-transformed reads.

- [ ] **Step 3: Update version metadata and scripts**

```json
{
  "verify:contracts": "npm --prefix contracts/presentation-standard-project run verify",
  "verify:e2e": "node scripts/verify-e2e-v0.1.1.mjs"
}
```

- [ ] **Step 4: Replace stale branch instructions and describe A1.1 deployment**

Deployment docs must use the current branch/ref, show backup paths, state the single-process restriction, and distinguish automated verification from real-model host acceptance.

- [ ] **Step 5: Run metadata, Contract, and E2E verification**

Run: `npm run verify:contracts && npm run verify:e2e && npm run verify:dsh`  
Expected: PASS.

- [ ] **Step 6: Commit Task 7**

```bash
git add package.json scripts contracts/presentation-standard-project/scripts/verify-all.mjs .gitattributes README.md DSH_INSTALL.md docs/deployment packages/studio-dsh-plugin
git commit -m "release: prepare report studio v0.1.1 deployment"
```

### Task 8: Full product verification and deployable artifact

**Files:**
- Create: `docs/acceptance/report-studio-v0.1.1-verification.md`
- Create: `dist/architectureworld-report-studio-dsh-0.1.1.tgz`

**Interfaces:**
- Produces a local npm package tarball and an evidence-backed acceptance record.

- [ ] **Step 1: Run the complete automated gate**

Run: `npm run verify:all`  
Expected: all unit, integration, UI, DSH, Contract, migration, concurrency, and E2E checks PASS.

- [ ] **Step 2: Pack the native DSH plugin**

Run: `npm pack ./packages/studio-dsh-plugin --pack-destination ./dist`  
Expected: `architectureworld-report-studio-dsh-0.1.1.tgz` with only declared package files.

- [ ] **Step 3: Perform isolated DSH install and route smoke**

Run: `npm run smoke:dsh`  
Expected: isolated install, DSH Web startup, `/report-studio/api/health`, and static UI route PASS.

- [ ] **Step 4: Perform local server workflow smoke**

Run: `node scripts/verify-e2e-v0.1.1.mjs`  
Expected: migration → edit → Submission → Proposal → accept → restart → standard export → Contract validation PASS.

- [ ] **Step 5: Record exact commands, versions, hashes, and remaining host acceptance boundary**

The acceptance record must separately label static checks, automated tests, DSH host smoke, browser responsive verification, and the still-unverified real-model generation quality.

- [ ] **Step 6: Commit Task 8**

```bash
git add docs/acceptance/report-studio-v0.1.1-verification.md dist
git commit -m "test: verify deployable report studio v0.1.1"
```
