# Report Studio v0.8.1 验证记录

验证日期：2026-09-02  
验证对象：`tools/report-studio`  
版本：`0.8.1`

## 1. 验证环境

| 项目 | 版本 |
|---|---|
| Node.js | `v22.16.0` |
| npm | `10.9.2` |
| Chromium | `144.0.7559.96` |
| OS | Linux x86_64 |

项目最低要求为 Node.js `>=20`。

## 2. 执行命令

```bash
cd tools/report-studio
npm test
npm run build
cmp --silent report-studio-prototype.html dist/report-studio-prototype-v0.8.1.html
npm run verify:release
npm run verify:browser
```

## 3. 自动化测试

结果：

```text
57 tests
57 passed
0 failed
0 skipped
```

覆盖范围包括：

- 三阶段与页面作用域隔离；
- 单条批注暂存；
- 批次级“提给Agent”；
- 历史批次原位补充、编辑和再次提交；
- `roundId` 保留及多次 `submissionId`；
- 已完成/未完成统计；
- 批次折叠、独立滚动及滚动位置恢复；
- 上脚标定位与历史批次自动展开；
- 草案文字内容人工编辑；
- 未保存状态导航保护；
- 草案到排版的文字同步与几何保持；
- 素材增删与预览；
- Agent 悬浮入口与会话结构；
- Agent 图标资源单次嵌入；
- 单文件体积约束；
- 发布版本与 SHA-256 一致性。

## 4. 构建验证

```text
Built report-studio-prototype.html (212919 bytes)
```

临时构建文件与版本化发布文件逐字节一致：

```text
report-studio-prototype.html
dist/report-studio-prototype-v0.8.1.html
```

`cmp --silent` 返回成功。

## 5. 发布元数据验证

```text
Release metadata verified: v0.8.1
```

| 发布文件 | 大小 | SHA-256 |
|---|---:|---|
| `dist/report-studio-prototype-v0.8.1.html` | `212,919 bytes` | `94e8b74c4582274e4ff5238c5f8385961b345564a4214b7b9fe2563f950dc226` |

校验值同时记录于：

```text
tools/report-studio/dist/SHA256SUMS
```

## 6. Chromium 真实交互验证

结果：通过。

验证脚本使用 Chromium DevTools Protocol 加载自包含 HTML，并实际执行：

- 大纲、草案、排版切换；
- 页面切换；
- 单条批注添加；
- 当前批次提交；
- 历史批次补充和再次提交；
- Agent 模拟处理与返回；
- 已完成/未完成状态更新；
- 批注卡片内联编辑；
- 历史批次折叠与上脚标展开；
- 批注列表独立滚动；
- 顶部与底部固定；
- 作用域级滚动位置恢复；
- 草案文字编辑、保存和持久化；
- 排版文字同步且几何位置不变；
- 素材预览。

## 7. 结论

`v0.8.1` 可作为当前交互设计和前端实现的稳定基线。它证明了核心工作流在浏览器内可以运行，但不等同于正式 DSH 插件验收：真实 Agent、Project State、Command、Revision、Storage、素材服务和报告导出仍需后续集成。
