# Presentation Tools

面向专业汇报生产流程的工具与原型仓库。

## 当前交付

| 工具 | 当前版本 | 状态 | 入口 |
|---|---:|---|---|
| Report Studio 三阶段交互原型 | `0.8.1` | 可运行前端交互原型；使用 Mock Adapter，尚未接入真实 DSH Agent/Project State | [`tools/report-studio/`](tools/report-studio/) |

Report Studio 用于验证“**大纲 → 草案 → 排版**”三阶段工作台、页面级批注、批次级 Agent 提交、素材管理、草案文字人工编辑，以及项目级悬浮 Agent 会话。

## 快速体验

直接下载并打开：

```text
tools/report-studio/dist/report-studio-prototype-v0.8.1.html
```

该文件为完全自包含的单文件原型，不依赖外部 CDN 或在线服务。

## 仓库结构

```text
presentation-tools/
├─ README.md
├─ .github/workflows/report-studio-ci.yml
├─ docs/
│  ├─ acceptance/report-studio-v0.8.1-verification.md
│  └─ handoff/2026-09-02-report-studio-v0.8.1-handoff.md
└─ tools/report-studio/
   ├─ VERSION
   ├─ release-manifest.json
   ├─ README.md
   ├─ CHANGELOG.md
   ├─ RELEASE-NOTES-v0.8.1.md
   ├─ prototype/
   ├─ src/
   ├─ scripts/
   ├─ tests/
   ├─ integration/
   └─ dist/
```

## 版本规则

Report Studio 当前唯一发布版本为 `0.8.1`。以下文件必须保持一致：

1. `tools/report-studio/VERSION`
2. `tools/report-studio/package.json`
3. `tools/report-studio/release-manifest.json`
4. 单文件 HTML 中的 `report-studio-build` 元数据
5. 发布文件名、Release Notes 与 Handoff 文档

执行以下命令可自动校验版本和发布文件校验值：

```bash
cd tools/report-studio
npm run verify:release
```

## 重要边界

当前成果是用于产品与交互验证的可运行原型，不是正式 DSH 插件交付。正式实施必须继续复用 DSH 的 Session、Project State、Command、Revision、Storage 与 Agent Harness，不应另建第二套独立 Agent 系统。
