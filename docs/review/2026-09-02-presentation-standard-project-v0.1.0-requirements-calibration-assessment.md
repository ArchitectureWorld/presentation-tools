
# Presentation 标准项目格式 0.1.0 要求校准与开发评估

- Requirement: `Presentation_标准项目格式开发要求_FINAL_V2.0.0.md`
- Source branch reviewed: `architecture/presentation-standard-project-directory-v0.1.0` @ `f2db87c47e6779c64532a412c882c9d35ef3ac56`
- Main baseline: `40251a570281a9165e287dff3a7b0e45185a6953`
- Target Contract: `@architectureworld/presentation-contracts@0.1.0`

## 结论

旧支线不能按原样合并：其目录、Schema 骨架、UUIDv7、Ajv、Hash 与 Fixture 可复用，但 `1.0.0 / Directory v1` 命名、Canonical Revision、`syncOrigin`、自动刷新、写盘事务和恢复职责与 FINAL V2.0.0 冲突。

本次 clean integration 已执行定向收缩：标准只表达数据、来源和文件完整性；调用方负责执行与生命周期。七类 Schema、纯工厂、ID Factory、验证器、最小 Fixture、完整示例、npm package 和独立 consumer 验证均按 `0.1.0` 重建。Report Studio 产品内部 Revision 架构不被删除，但不再进入跨插件标准项目文件。

## 逐项裁决

| 范围 | 旧实现 | 0.1.0 裁决 |
|---|---|---|
| 标准名称与版本 | Directory v1 / 1.0.0 | 标准名不带 v1，Contract 为 0.1.0 |
| 目录 | 基本正确 | 保留 |
| 七类 Schema | 骨架正确、治理字段过多 | 保留骨架并收缩 |
| 稳定 ID | lowercase UUIDv7 | 保留 |
| `sourceRefs` | 状态机、自动刷新、Hash 强制 | 改为纯追溯；Snapshot Hash 可选 |
| Revision / `syncOrigin` | Canonical 必填 | 从标准 Contract 删除 |
| 初始化器 | staging/fsync/rename/recovery | 改为纯文档工厂和目录计划 |
| 草案 | 五类内容块 | 保留并增加 `contentNature` 与讲解稿引用 |
| Source/Asset | 基本分离 | 统一 `sizeBytes` 和五类来源 |
| 验证器 | 基础路径与文件校验 | 增加大小写/NFC碰撞、讲解稿引用和精确问题位置 |
| 消费方式 | 精确 npm 包 | 保留并验证全新 consumer 安装 |
| UI | 无需修改 | 零修改 |

## 开发判断

```text
REQUIREMENT_COMPLIANCE = PASS_AFTER_CORRECTION
MAIN_PRODUCT_CONFLICT = NONE
UI_CHANGE = NONE
TARGET_RELEASE = 0.1.0
```
