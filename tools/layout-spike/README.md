# Report Studio Layout Spike

Isolated browser spike for the `v0.2.0-alpha.1` engine-neutral layout foundation.

## What it proves

- a replaceable adapter can consume a fixed render plan;
- the 1600×900 `studio_unit` canvas scales into the viewport;
- elements can be selected, dragged and resized;
- only changed frames are serialized;
- refreshing or resetting restores the fixed fixture;
- no production Repository, DSH route, Standard Adapter or project file is imported.

## Run

Serve the repository root, then open `/tools/layout-spike/`:

```bash
python -m http.server 8080
```

Automated smoke:

```bash
CHROMIUM_PATH=google-chrome node scripts/verify-layout-spike.mjs
```

This spike is deliberately non-persistent. Its output is a frame-only ChangeSet preview, not a production commit path.
