# Report Studio v0.1.1 本地部署说明

正式部署方式是 `@architectureworld/report-studio-dsh@0.1.1` DSH 原生插件。测试基线为 Node.js 22+、DSH `0.1.1-rc.2`、Profile `web`。

## 获取与验证

```bash
git clone https://github.com/ArchitectureWorld/presentation-tools.git
cd presentation-tools
git checkout main
git pull --ff-only
npm ci --prefix contracts/presentation-standard-project --ignore-scripts --no-audit --no-fund
npm run verify:all
```

## 安装

更新前停止 DSH，并备份 `$DSH_HOME/profiles/web` 与 `$DSH_HOME/report-studio-v0.1.0`。随后执行：

```bash
dsh plugin --profile web remove @architectureworld/report-studio-dsh
dsh plugin --profile web add ./packages/studio-dsh-plugin
dsh --profile web --dump-config
dsh --profile web --no-open
```

兼容数据根继续使用 `report-studio-v0.1.0` 名称，以便发现旧 Session 的 `state.json`。检测到旧数据后必须在 UI 中点击“备份并升级”；系统完成逐字节备份、稳定 ID 映射、校验后才原子发布新 Head。旧文件不会被覆盖。

## 产品链路

```text
标准项目目录 0.1.0
↕ Studio Adapter
Canonical Snapshot / Revision CAS
↕
大纲与草案 UI ─→ ReviewSubmission ─→ 当前 DSH Session
                                      └→ Proposal ─→ 用户确认 ─→ 新 Revision
```

标准文件与 UI、产品架构和底层通过 Adapter 完整衔接；运行态治理对象不会污染中立标准目录。排版、分页和 PPTX/PDF/HTML 成品导出延期到 `0.2.0`。

## 验证与回滚

```bash
npm run verify:all
npm run smoke:dsh
```

`verify:all` 包含迁移、CAS、标准导入/导出、DSH 提案、重启恢复、浏览器响应式和完整 E2E。`smoke:dsh` 在隔离 DSH Home 中安装并启动插件。

回滚前必须停止 DSH。恢复更新前的 Web Profile 备份；已迁移的数据文件移入隔离目录而不是删除，并保留原 `state.json` 与 `backups/`。完整命令和验收边界见仓库根目录 [DSH_INSTALL.md](../../DSH_INSTALL.md)。
