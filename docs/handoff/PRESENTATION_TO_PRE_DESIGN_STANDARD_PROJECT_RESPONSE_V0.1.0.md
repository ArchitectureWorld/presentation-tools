---
document_id: presentation-to-pre-design-standard-project-response-v0.1.0
status: final
standard_version: 0.1.0
issued_at: 2026-09-03
provider: ArchitectureWorld/presentation-tools
consumer: ArchitectureWorld/pre-design
---

# Presentation Standard Project Directory V0.1.0 — 给 pre-design 的正式反馈

本文件是 `ArchitectureWorld/pre-design` 消费 Presentation 标准项目格式的正式坐标。Schema、类型、ID Factory、Fixture、示例和验证器必须来自同一个精确 Contract 版本，不得复制后分别修改。

| Field | Value |
|---|---|
| standardName | `Presentation Standard Project Directory` |
| standardVersion | `0.1.0` |
| architectureDocumentPath | `docs/architecture/report-studio-architecture.md` |
| contractsRoot | `contracts/presentation-standard-project` |
| schemaPaths | `contracts/presentation-standard-project/schemas/0.1.0/common.schema.json`; `project-manifest.schema.json`; `project-rules-document.schema.json`; `outline-document.schema.json`; `page-manifest.schema.json`; `draft-page-document.schema.json`; `source-material-manifest.schema.json`; `asset-manifest.schema.json` |
| typesEntry | `contracts/presentation-standard-project/src/index.d.ts` |
| idFactoryEntry | `contracts/presentation-standard-project/src/ids.mjs#createStableId` |
| minimalFixturePath | `contracts/presentation-standard-project/fixtures/minimal/project_01992a80-0000-7000-8000-000000000001-minimal-project` |
| fullExamplePath | `contracts/presentation-standard-project/examples/unformatted-project/project_01992a80-0000-7000-8000-000000000101-campus-renewal-brief` |
| documentValidatorEntry | `contracts/presentation-standard-project/src/ajv-validation.mjs#validateDocumentWithAjv` |
| projectValidatorEntry | `contracts/presentation-standard-project/src/ajv-validation.mjs#validateProjectDirectoryWithAjv` |
| validationCommand | `python3 -m pip install jsonschema==4.26.0 referencing==0.37.0 && npm ci --prefix contracts/presentation-standard-project --ignore-scripts --no-audit --no-fund && npm test --prefix contracts/presentation-standard-project && npm run verify --prefix contracts/presentation-standard-project` |
| consumerMethod | 主方式为精确版本 npm Contract 包 `@architectureworld/presentation-contracts@0.1.0`，消费仓提交 lockfile integrity，并在注册 Schema 前核对 `SCHEMASET.sha256`。首次不可变发布前，只允许按本文件 `commitSHA` 进行固定 Git 提交的只读集成验证；不得长期复制 Schema。 |
| packageOrArtifactVersion | `@architectureworld/presentation-contracts@0.1.0`；Release artifact 只能镜像同一 npm tarball及其 Hash，不形成第二权威。 |
| schemaSetSha256 | `5bd329fcc8503ff7a48b3430e41b38dd264ae486cee7372a39cbbcccc2de2ebc` |
| branch | `main` |
| commitSHA | `974668d308728386ea005c9e77d58ebff9372f0a` |
| verificationResults | JSON Schema `8/8 PASS`；主 Schema `7/7 PASS`；Contract tests `8/8 PASS`；最小项目 PASS；完整示例 PASS；npm pack `68` 文件 PASS；独立 consumer PASS；Report Studio tests `23/23 PASS`；响应式 UI 与 DSH 插件回归 PASS。 |
| remainingNonBlockingRisks | npm Registry 的首次不可变发布尚待执行；`pre-design` 的真实包接入尚待其独立集成分支完成；Windows/macOS 实体文件系统矩阵可在首次桌面端接入前补充。 |

## 消费边界

1. `pre-design` 可以创建、填写和验证标准项目目录，但不能定义第二套 Presentation Schema。
2. `pre-design` 的专业对象不进入 Presentation 核心模型；只通过通用 `sourceRefs` 追溯。
3. `sourceRefs` 不授予 Presentation 自动刷新、自动覆盖、内容所有权或删除权限。
4. 项目目录的实际写入、复制、回滚和恢复由调用方插件负责；Contract 包只提供纯目录计划、最小文档工厂、稳定 ID 和验证器。
5. `layouts/`、空大纲、空页面清单和空素材清单均合法，不得生成虚构占位内容。
6. `DraftPageDocument` 不包含字体、字号、颜色、几何坐标、模板、PPT 母版或 CSS。

## 固定验证标记

```text
PRESENTATION_STANDARD_PROJECT_V0_1_0_PASS
```
