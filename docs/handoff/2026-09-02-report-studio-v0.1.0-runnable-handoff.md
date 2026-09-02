# Report Studio v0.1.0 可运行版 Handoff

## 当前状态

```text
Repository: ArchitectureWorld/presentation-tools
Branch: integration/report-studio-mvp-v0.1.0
Version: v0.1.0
Status: runnable-outline-draft-mvp
Layout: deferred-to-v0.2.0
```

## 直接启动

Node.js 22+，仓库根目录：

```bash
npm start
```

访问：`http://127.0.0.1:4173`

无需 `npm install`。

## 已实现

- 大纲新增一级/子级节点、改名、同层排序、删除；
- 稳定 outline ID；
- 大纲节点生成稳定草案页；
- 草案标题、正文、要点、讲解稿；
- 本页图片素材；
- 批注自动保存；
- Annotation lifecycle 与 resolution 分离；
- 同一 ReviewRound 多个不可变 ReviewSubmission；
- 内容 Revision；
- 服务器端 JSON 持久化与重启恢复；
- 可选外部 DSH-compatible Bridge；
- Agent commands 先形成 Proposal，用户确认后才写正式 Revision；
- stale revision 保护；
- 排版入口标记 v0.2.0，不阻塞当前使用。

## 验证

```bash
npm test
npm run verify
```

仓库 CI 在 commit `698a476aaf8afd93f9f74375e224bf3b3044e6f4` 上两次 `verify` Check 均通过。

本地打包产物重新解压后执行完整命令：

```text
13 automated tests PASS
Report Studio v0.1.0 verification PASS
revision=4
outline_nodes=1
draft_pages=1
review_submissions=2
```

## Agent / DSH

Studio 本身不运行第二套模型 Runtime。配置：

```text
REPORT_STUDIO_AGENT_URL
REPORT_STUDIO_AGENT_TIMEOUT_MS
```

Bridge 合同和部署细节见：

`docs/deployment/report-studio-v0.1.0-local-deployment.md`

未配置 Bridge 时人工大纲/草案工作流仍完整可用，且不会产生 Mock Agent 假回复。

## 正式数据

默认：

```text
.report-studio-data/state.json
```

可通过 `REPORT_STUDIO_DATA_DIR` 覆盖。浏览器 localStorage 不是事实源。

## 下一阶段

`v0.2.0` 再开发正式排版：LayoutPageDocument、布局引擎、sourceRef、视觉几何和草案↔排版同步。
