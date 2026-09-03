# Studio Layout Adapter

Replaceable browser/editor boundary for Report Studio `v0.2.0-alpha.1`.

The package currently validates a deliberately small lifecycle:

```text
mount(root, handlers)
render(viewModel)
readViewportState()
destroy()
```

It does not import OpenPencil, persist project data, call DSH, or own canonical layout state. Editors consume engine-neutral render plans and report user gestures back through the integration layer.

```bash
node --test packages/studio-layout-adapter/index.test.mjs
```
