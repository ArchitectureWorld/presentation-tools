# Report Studio v0.1.1 本地部署说明

> **历史文档。** 本文件记录 v0.1.1 当时针对 DSH `0.1.1-rc.2` 的部署事实，不是 `feat/report-studio-v0.2.0-layout` 的当前安装依据。当前分支统一以仓库根目录 `DSH_INSTALL.md` 和 `docs/review/2026-09-15-dsh-0.1.5-rc.1-compatibility-review.md` 为准，目标 DSH 为 `0.1.5-rc.1`。不要把下面的历史版本号复制到新环境。

正式部署方式是 `@architectureworld/report-studio-dsh@0.1.1` DSH 原生插件。**以下测试基线仅指当时 v0.1.1 验收：** Node.js 22+、DSH `0.1.1-rc.2`、Profile `web`。

## 获取与验证（历史）

```bash
git clone https://github.com/ArchitectureWorld/presentation-tools.git
cd presentation-tools
git checkout feat/report-studio-v0.1.1-hardening
git pull --ff-only
npm ci --prefix contracts/presentation-standard-project --ignore-scripts --no-audit --no-fund
npm run verify:all
```

## 安装（历史）

更新前停止 DSH，并备份 `$DSH_HOME/profiles/web` 与 `$DSH_HOME/report-studio-v0.1.0`。随后执行：

```bash
dsh plugin --profile web remove @architectureworld/report-studio-dsh
npm pack ./packages/studio-dsh-plugin --pack-destination ./dist
dsh plugin --profile web add ./dist/architectureworld-report-studio-dsh-0.1.1.tgz
dsh --profile web --dump-config
dsh --profile web --no-open
```

兼容数据根继续使用 `report-studio-v0.1.0` 名称，以便发现旧 Session 的 `state.json`。检测到旧数据后必须在 UI 中点击“备份并升级”；系统完成逐字节备份、稳定 ID 映射、校验后才原子发布新 Head。旧文件不会被覆盖。

## 正式入口与交互（历史 v0.1.1）

正式使用只从 `http://127.0.0.1:3080/` 进入：先选择或创建 DSH Session，再点击会话顶部的 `Report Studio` 标签。模型、推理等级、Session 与消息输入由 DSH 底部原生控制栏统一管理；Report Studio 只负责编辑、批注、评审提交和当时的 Proposal 确认。

`/report-studio/?sessionId=...` 是 DSH iframe 和备用独立窗口使用的内部地址。独立页面会提示返回 DSH 主界面，且不会复制或伪造模型选择器。端口 `4173` 仅供源码调试，不是部署入口。

## 安全边界（历史基线）

当时 DSH `0.1.1-rc.2` 没有向插件 HTTP 路由暴露可信 Session 身份或 iframe capability hook，因此 v0.1.1 只支持 `securityMode=local-single-user-only`。这一安全结论在当前分支仍被保留，但当前实现与依赖版本请读取根目录 `DSH_INSTALL.md`。

## 产品链路（历史）

```text
标准项目目录 0.1.0
↕ Studio Adapter
Canonical Snapshot / Revision CAS
↕
大纲与草案 UI ─→ ReviewSubmission ─→ 当前 DSH Session
                                      └→ Proposal ─→ 用户确认 ─→ 新 Revision
```

当前 v0.2.0 开发线已经改为受控工具直接修改，不再把该 Proposal 确认链路作为当前产品行为。

## 历史验证与回滚

```bash
npm run verify:all
npm run smoke:dsh
```

本文件保留历史行为仅用于追溯。**当前 DSH 0.1.5-rc.1 的 Session V3 升级必须先冷备份完整 `DSH_HOME`，不能按本历史文档只恢复 Web Profile。** 当前完整命令和验收边界见仓库根目录 [DSH_INSTALL.md](../../DSH_INSTALL.md)。
