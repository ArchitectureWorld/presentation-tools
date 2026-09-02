
# Presentation Standard Project Directory

This package is the machine-readable, provider-neutral Presentation project-format authority owned by `ArchitectureWorld/presentation-tools`.

- Standard version: `0.1.0`
- Package: `@architectureworld/presentation-contracts@0.1.0`
- JSON Schema: Draft 2020-12
- Architecture authority: `docs/architecture/report-studio-architecture.md`

The Contract describes data, stable identities, references, files, and validation. It does not own Agent execution, workflow approval, Project Head, Revision/CAS, automatic refresh, conflict resolution, or caller-side write recovery.

## Directory

```text
<projectId>-<projectSlug>/
├─ project.json
├─ rules.json
├─ outline.json
├─ pages/
│  ├─ manifest.json
│  └─ drafts/
├─ source-materials/
│  ├─ manifest.json
│  ├─ documents/
│  ├─ drawings/
│  ├─ images/
│  ├─ videos/
│  ├─ data/
│  ├─ models/
│  └─ other/
├─ assets/
│  ├─ manifest.json
│  ├─ images/
│  ├─ videos/
│  ├─ charts/
│  ├─ diagrams/
│  ├─ audio/
│  └─ other/
└─ layouts/
```

`source-materials/` preserves the initially imported project basis. `assets/` contains only formally adopted, generated, or processed material. `layouts/` may be empty. All project-internal references are project-root-relative POSIX paths.

## API

```js
import {
  createStableId,
  createProjectDirectoryPlan,
  validateDocumentWithAjv,
  validateProjectDirectoryWithAjv,
} from '@architectureworld/presentation-contracts'
```

`createProjectDirectoryPlan()` is pure: it returns the directory list and six minimum legal documents without writing to disk. The calling DSH plugin owns actual file creation, source copying, rollback, and recovery.

## Verify

```bash
npm ci --prefix contracts/presentation-standard-project --ignore-scripts --no-audit --no-fund
npm test --prefix contracts/presentation-standard-project
npm run verify --prefix contracts/presentation-standard-project
```

A successful verification prints `PRESENTATION_STANDARD_PROJECT_V0_1_0_PASS`.
