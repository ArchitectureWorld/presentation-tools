---
document_id: presentation-standard-project-directory-v0.1.0-verification
status: passed
verified_at: 2026-09-03
standard_version: 0.1.0
content_commit: 974668d308728386ea005c9e77d58ebff9372f0a
schema_set_sha256: 5bd329fcc8503ff7a48b3430e41b38dd264ae486cee7372a39cbbcccc2de2ebc
verification_run: 33693062070
---

# Presentation Standard Project Directory V0.1.0 验收记录

## 验收对象

```text
Standard: Presentation Standard Project Directory
Version: 0.1.0
Contract package: @architectureworld/presentation-contracts@0.1.0
Contract root: contracts/presentation-standard-project/
Content commit: 974668d308728386ea005c9e77d58ebff9372f0a
```

## 验证结果

| 检查项 | 实际结果 | 状态 |
|---|---:|---|
| JSON Schema Draft 2020-12 | 8个 Schema | PASS |
| 主 Schema | 7个 | PASS |
| Fixture/示例文档 | 14份 | PASS |
| Contract Node tests | 8/8 | PASS |
| 最小项目 | 6个文档、0个正式文件 | PASS |
| 完整示例 | 8个文档、2个正式文件 | PASS |
| npm pack | 68个文件 | PASS |
| 独立 consumer 安装与导入 | 成功 | PASS |
| Schema Set SHA-256 | `5bd329fcc8503ff7a48b3430e41b38dd264ae486cee7372a39cbbcccc2de2ebc` | PASS |
| UUIDv7 稳定 ID | 通过 | PASS |
| `sourceRefs` 数字/字符串 Revision | 通过 | PASS |
| 可选来源快照 Hash | 通过 | PASS |
| `contentNature` | 通过 | PASS |
| 讲解稿内容块/素材引用 | 通过 | PASS |
| Unicode NFC 与大小写折叠碰撞 | 通过 | PASS |
| MIME、扩展名、`sizeBytes`、SHA-256 | 通过 | PASS |
| Draft 禁止视觉/布局字段 | 通过 | PASS |
| Revision、`syncOrigin`、自动刷新治理字段退出 Contract | 通过 | PASS |
| Report Studio 自动化测试 | 23/23 | PASS |
| Report Studio 领域验证 | 通过 | PASS |
| 响应式浏览器验证 | 6组视口 | PASS |
| DSH 原生插件验证 | 通过 | PASS |
| 产品实现路径变更 | 0 | PASS |

## 最小项目合法状态

以下空状态已经通过 Schema 和项目目录验证器：

```text
outline.json.nodes = []
pages/manifest.json.pages = []
source-materials/manifest.json.materials = []
assets/manifest.json.assets = []
pages/drafts/ = empty
layouts/ = empty
```

没有通过虚构章节、空白页面或伪素材满足 Schema。

## 验证命令

```bash
python3 -m pip install jsonschema==4.26.0 referencing==0.37.0
npm ci --prefix contracts/presentation-standard-project --ignore-scripts --no-audit --no-fund
npm test --prefix contracts/presentation-standard-project
npm run verify --prefix contracts/presentation-standard-project
npm run verify:all
```

## 最终结果

```text
PRESENTATION_STANDARD_PROJECT_V0_1_0_PASS
PRESENTATION_STANDARD_PROJECT_V0_1_0_DELIVERY_PASS
```
