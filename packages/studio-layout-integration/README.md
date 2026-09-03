# Studio Layout Integration

Builds the engine-neutral source index consumed by Report Studio v0.2.0 layout documents.

The package requires stabilized DraftPage identities and ObjectRef-backed PageAssets. It deliberately rejects legacy simplified `{ heading, body, bullets, script, assets }` pages instead of guessing unstable identities.

```bash
node --test packages/studio-layout-integration/index.test.mjs
```

Output is a plain object keyed only by `sourceRefKey()`. It contains semantic text, list, metric, table-cell, script and asset metadata; binary bytes, Data URLs, migration records and UI state are excluded.
