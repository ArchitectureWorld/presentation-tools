# Studio Layout Contracts

Engine-neutral canonical layout contract for Report Studio `v0.2.0-alpha.1`.

This package owns typed layout IDs, source-reference keys and structural validation. It has no editor, browser, storage or DSH dependency.

```bash
node --test packages/studio-layout-contracts/index.test.mjs
```

Key rules:

- Canonical canvas coordinates use `studio_unit`.
- `live` elements contain `sourceRef` and never duplicate source payload.
- `detached` elements contain `localPayload` and no writable live source reference.
- Engine-private node IDs do not belong in this contract.
