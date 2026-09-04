# Studio Layout Integration

Builds the engine-neutral source projection consumed by Report Studio v0.2.0 layout documents.

The public boundary is snapshot-aware:

```js
const projection = buildLayoutSourceProjection({
  snapshot,
  pageId,
  projectRevision,
  sourceStateHash,
  resolvedPageAssets,
})
```

`projection.projectId` always comes from `CanonicalSnapshot.project.projectId`. Callers cannot override it, and Canonical Page records do not duplicate it. This preserves the existing Presentation Standard Project Directory 0.1.0 identity supplied by pre-design without any Schema change.

`buildLayoutSourceIndex(input)` is a convenience wrapper returning `projection.sources`. The former draft-only signature is rejected rather than guessing a project identity.

The package requires stabilized Canonical Page identities and ObjectRef-backed PageAssets. It excludes binary bytes, Data URLs, migration records and UI state.

```bash
node --test packages/studio-layout-integration/index.test.mjs
```
