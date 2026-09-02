
# `architecture/presentation-standard-project-directory-v1` 支线评估与处置

## 结论

该支线不适合整支合并。它将 Report Studio monorepo、UI 原型、UUIDv4/Zod 第二套 Contract、Revision/CAS、自动同步和写盘恢复混合在同一支线中，超出标准项目格式范围。

提炼进入 0.1.0 的有效内容只有：

1. Unicode NFC 与大小写折叠碰撞检测；
2. `sizeBytes` 命名；
3. 数字或字符串 `sourceRevision`；
4. npm tarball 全新 consumer 安装验证；
5. 只读 Contract CI。

上述内容已经在本次 clean integration 中实现并验证。该支线没有需要继续独立维护的唯一 Contract 权威，完成验证后可删除。
