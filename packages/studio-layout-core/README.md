# Studio Layout Core

Pure immutable domain operations for the Report Studio `v0.2.0-alpha.1` layout foundation.

The core creates layout pages, adds live or detached elements, edits frames, detaches elements, reconciles source identities and creates an engine-neutral render plan.

It does not persist data, render a browser UI, call DSH or depend on OpenPencil.

```bash
node --test packages/studio-layout-contracts/*.test.mjs packages/studio-layout-core/*.test.mjs
node scripts/verify-layout-v0.2.0.mjs
```
