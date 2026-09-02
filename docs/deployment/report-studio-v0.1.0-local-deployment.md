# Report Studio v0.1.0 本地安装与部署说明

## 1. 当前可部署状态

`v0.1.0` 已提供可直接运行的本地程序，当前生产范围为：

```text
大纲
草案
本页素材（基础图片）
批注自动保存
ReviewRound / 多次 ReviewSubmission
Revision
本地持久化与重启恢复
Proposal 确认应用
可选外部 DSH Bridge
```

排版阶段属于 `v0.2.0`，当前 UI 只保留禁用入口。

当前程序**不依赖 pre-design，也不需要 pnpm/npm install**。运行时零第三方依赖，仅要求 Node.js 22+。

---

## 2. 环境要求

```text
Git      >= 2.40
Node.js  >= 22
浏览器   Chrome / Edge / Safari 现代版本
```

检查：

```bash
git --version
node --version
npm --version
```

`node --version` 必须为 `v22` 或更高。

---

## 3. 获取代码

当前开发分支：

```bash
git clone https://github.com/ArchitectureWorld/presentation-tools.git
cd presentation-tools
git checkout integration/report-studio-mvp-v0.1.0
```

确认：

```bash
git branch --show-current
node -p "require('./package.json').version"
```

预期：

```text
integration/report-studio-mvp-v0.1.0
0.1.0
```

PR 合并到 `main` 后直接使用 `main` 即可。

---

## 4. 一键启动

仓库根目录执行：

```bash
npm start
```

默认地址：

```text
http://127.0.0.1:4173
```

启动成功会输出：

```text
Report Studio v0.1.0 running at http://127.0.0.1:4173
Data: <path>/.report-studio-data/state.json
```

浏览器打开该地址即可使用。

### 开发模式

```bash
npm run dev
```

使用 Node `--watch` 自动重启服务。

---

## 5. 数据保存位置

默认：

```text
<仓库根目录>/.report-studio-data/state.json
```

可指定独立目录：

### macOS / Linux

```bash
REPORT_STUDIO_DATA_DIR=/absolute/path/report-studio-data npm start
```

### Windows PowerShell

```powershell
$env:REPORT_STUDIO_DATA_DIR="D:\report-studio-data"
npm start
```

所有正式大纲、草案、批注、ReviewRound、Submission、Proposal 和 Revision 均写入服务器端 JSON；浏览器 `localStorage` 不是业务事实源。

写入采用：

```text
同目录临时文件
→ 完整写入
→ rename 替换 state.json
```

因此进程重启后可直接恢复。

### 备份

关闭程序后复制整个数据目录即可：

```bash
cp -R .report-studio-data .report-studio-data.backup
```

Windows 可直接复制该目录。

---

## 6. 端口与监听地址

默认：

```text
HOST=127.0.0.1
PORT=4173
```

修改示例：

### macOS / Linux

```bash
HOST=0.0.0.0 PORT=4180 npm start
```

### Windows PowerShell

```powershell
$env:HOST="0.0.0.0"
$env:PORT="4180"
npm start
```

仅在可信局域网环境下使用 `0.0.0.0`。

---

## 7. 当前功能使用顺序

### 大纲

1. 修改顶部项目名称；
2. 点击 `+ 一级章节`；
3. 可继续添加子级；
4. 标题直接输入修改；
5. 使用 `↑ / ↓` 调整同层顺序；
6. 点击 `生成页` 进入该节点对应草案页；
7. 可对具体节点点击 `批注`。

所有大纲内容修改都会形成新的项目 Revision。

### 草案

当前支持：

```text
页面标题
正文
要点列表
讲解稿
本页图片素材
```

编辑后点击 `保存草案`。

### 批注

```text
添加批注
→ 自动保存，不增加内容 Revision
→ 提给Agent
→ 创建 ReviewRound + ReviewSubmission #1
```

如果一轮没有解决完：

```text
点击“继续本轮”
→ 添加新的补充批注
→ 再次“提给Agent”
→ 同一 ReviewRound 下创建 ReviewSubmission #2
```

历史 Submission 不会被第二次提交覆盖。

`标记完成` 由用户手动执行；Agent 返回不会自动把问题设为完成。

---

## 8. DSH Agent Bridge

### 8.1 当前原则

Report Studio 不内置第二套模型 Runtime。Agent 能力通过外部 DSH-compatible HTTP Bridge 接入。

未配置 Bridge 时：

- 大纲、草案、素材、批注、Submission、Revision 全部正常使用；
- Agent 悬浮窗明确显示 `DSH Bridge 未配置`；
- 不会伪造 Mock Agent 回复。

### 8.2 配置

环境变量：

```text
REPORT_STUDIO_AGENT_URL
REPORT_STUDIO_AGENT_TIMEOUT_MS    默认 60000
```

示例：

```bash
REPORT_STUDIO_AGENT_URL=http://127.0.0.1:5050/report-studio npm start
```

Windows PowerShell：

```powershell
$env:REPORT_STUDIO_AGENT_URL="http://127.0.0.1:5050/report-studio"
npm start
```

### 8.3 Bridge 请求合同

批注提交：

```json
{
  "kind": "report_studio.review_submission",
  "submission": {
    "id": "submission_xxx",
    "reviewRoundId": "round_xxx",
    "number": 1,
    "baseRevision": 5,
    "annotations": []
  },
  "context": {
    "projectId": "project_xxx",
    "projectTitle": "项目名称",
    "scopeKey": "draft:page_xxx"
  }
}
```

普通聊天：

```json
{
  "kind": "report_studio.chat",
  "text": "优化当前页标题",
  "context": {
    "projectId": "project_xxx",
    "currentRevision": 5,
    "stage": "draft",
    "pageId": "page_xxx"
  }
}
```

Bridge 必须返回：

```json
{
  "message": "已生成修改建议",
  "commands": [
    {
      "type": "outline.rename",
      "nodeId": "outline_xxx",
      "title": "新标题"
    }
  ],
  "sessionRef": "optional-dsh-session-ref"
}
```

当前可安全执行的 Agent Command 与人工内容操作共用受控领域入口。返回 commands 后 Studio 创建 Proposal，**必须由用户点击“确认应用”后才正式产生新 Revision**。

### 8.4 DSH 本机适配

由于不同 DSH 版本/本地 Profile 的具体 HTTP/插件桥接入口可能不同，部署 Agent 必须先执行：

```bash
dsh --version
```

然后用该机器实际 DSH Harness 实现一个满足上述 HTTP 合同的轻量 Adapter，并把 URL 填入 `REPORT_STUDIO_AGENT_URL`。

不得把猜测的 DSH CLI 命令写死到 Report Studio 核心。

---

## 9. 自动测试与验收

无需安装依赖。

执行：

```bash
npm test
npm run verify
```

当前实现已验证：

```text
13 automated tests PASS
Report Studio v0.1.0 verification PASS
revision=4
outline_nodes=1
draft_pages=1
review_submissions=2
```

`npm run verify` 会自动创建临时项目并执行：

```text
项目改名
→ 新建大纲
→ 生成草案页
→ 保存正文/要点/讲解稿
→ 添加批注
→ Submission #1
→ 同一 Round 补充批注
→ Submission #2
→ 停止服务
→ 重新读取数据
→ 检查完整恢复
```

---

## 10. 健康检查

启动后：

```bash
curl http://127.0.0.1:4173/api/health
```

预期类似：

```json
{
  "ok": true,
  "version": "v0.1.0",
  "dataPath": ".../.report-studio-data/state.json",
  "agentConfigured": false
}
```

查看当前项目状态：

```bash
curl http://127.0.0.1:4173/api/state
```

---

## 11. 常见故障

### `npm start` 报 Node 版本问题

升级到 Node 22+。

### 4173 端口被占用

```bash
PORT=4180 npm start
```

### 重启后项目不是原项目

确认启动时使用了相同的 `REPORT_STUDIO_DATA_DIR`。

### Agent 按钮提示 Bridge 未配置

这是正常状态，不影响人工工作流。配置 `REPORT_STUDIO_AGENT_URL` 后重启。

### Agent 已返回但内容没变化

这是正确行为：Agent 结果先形成 Proposal。必须在右侧批注轮次内点击 `确认应用`。

### Proposal 报 `stale_revision`

说明 Proposal 生成后项目内容又被人工修改。旧 Proposal 不允许覆盖新 Revision，需要重新提交当前轮次。

---

## 12. v0.1.0 / v0.2.0 边界

### v0.1.0 当前可用

```text
Outline
Draft
Basic Page Assets
Annotations
ReviewRound / ReviewSubmission
Proposal
Revision
Persistence / Recovery
External DSH Bridge Contract
```

### v0.2.0 后续

```text
正式排版画布
LayoutPageDocument
OpenPencil / Layout Adapter
sourceRef live / detached / orphaned
视觉样式和几何
草案 ↔ 排版同步
排版导出
```

当前部署不应等待 v0.2.0。
