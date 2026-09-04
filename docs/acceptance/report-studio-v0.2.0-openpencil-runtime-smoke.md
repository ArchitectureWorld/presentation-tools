---
document_id: report-studio-v0.2.0-openpencil-runtime-smoke
status: passed
product_version: 0.2.0-alpha.2
branch: feat/report-studio-v0.2.0-layout
starting_sha: 49e0c10c920c573e372989bb1f71bd1984e38c3f
tested_at: 2026-09-04
---

# Report Studio v0.2.0 OpenPencil Real Runtime 烟测

## 结论

本轮在仓库外一次性实例中完成 DSH `0.1.2-rc.1` 与本地兼容包 `@zseven-w/dsh-openpencil@0.1.0-compat.1` 的真实启动和功能烟测。没有降级 DSH，没有安装到正式 Profile，也没有读取或修改正式 Session、项目、配置和凭据。

```text
REAL_PACKAGE_INSTALL=PASS
PLATFORM_BINARY_LOAD=PASS
DSH_WEB_STARTUP=PASS
BATCH_DESIGN_CAPABILITY_PROBED=PASS
CREATE_TRANSACTION_ACCEPTED=PASS
REAL_RESULT_BINDINGS_VALID=PASS
FRAME_PATCH_ACCEPTED=PASS
SELECTION_REVERSE_MAPPING=PASS
DOCUMENT_SAVE=PASS
DOCUMENT_REOPEN=PASS
MANAGED_EDITOR_BROWSER=PASS
TEMPORARY_ENVIRONMENT_CLEANED=PASS
PRODUCTION_DATA_TOUCHED=NO
OPENPENCIL_RUNTIME_SMOKE=PASS
```

## 固定版本

```text
@deepseek-ai/dsh@0.1.2-rc.1
@deepseek-ai/dsh-code-runtime@0.1.2-rc.1
@zseven-w/dsh-openpencil@0.1.0-compat.1
@zseven-w/dsh-openpencil-win32-x64@0.1.0-rc.9
Node: v25.4.0
Platform: win32-x64
Network: 127.0.0.1 only
```

兼容包位于仓库外临时构建目录，只修改 DSH peer 版本线和兼容声明，原生 Windows x64 Runtime 仍使用 `0.1.0-rc.9` 平台包。

## 兼容修复

真实 QuickJS 不接受 Adapter 原来的未声明赋值；创建脚本已改为声明式顺序绑定：

```js
const b0=I(...)
const b1=I(...)
```

真实 `batch_design` 回执使用调用顺序绑定 `b0/b1/...`，不会返回 Adapter 自定义的 `rs_page/rs_el_*`。Adapter 与 `LayoutEngineBinding` 已兼容真实顺序绑定，同时继续保留 `layoutElementId` 作为 Report Studio 稳定身份。

## 真实 Runtime 结果

- 原生 `op-host-web-server.exe` 与 Wasm 编辑器启动成功；
- 创建 1 个根节点和 5 个元素节点，共 6 个真实 OpenPencil 节点；
- `b0...b5` 与真实节点 ID 一一对应；
- Frame Patch 真实执行并持久化；
- 临时 `.op` 保存成功，使用 successor capability 关闭并重开；
- 重开后节点 ID 保持稳定；
- 空 Selection 返回明确空结果，不猜测；
- 浏览器选择 `n6` 后映射为 `layout_element_runtime_title`。

OpenPencil finalize 会进行自身布局归一化。本轮观察到根高度被调整为 `939`，文本高度策略变为 `fit_content`。因此验收结论是“身份、内容、目标 Frame Patch 和保存/重开合同成立”，不是“所有初始几何字节完全不变”。

## 浏览器烟测

```text
Canvas backing size: 2524 x 1052
Canvas CSS size: 1262 x 526
Canvas/WASM non-blank: PASS
Zoom: 38% -> 46%
Fit view: 46% -> 38%
Pan: PASS
Dirty transition: PASS
Save count: 2
Reopen count: 1
Console errors: 0
```

控制台只有一条隔离环境预期 warning：协作事件流不可用后回退到 polling。它没有阻断编辑、选择、保存或重开。

脱敏浏览器证据见 `docs/acceptance/evidence/report-studio-v0.2.0-openpencil-browser-smoke.json`。

## 自动验证

```text
Layout/OpenPencil tests: 61 passed / 0 failed
Existing Report Studio tests: 51 passed / 0 failed
REPORT_STUDIO_LAYOUT_V0_2_0_FOUNDATION_PASS
REPORT_STUDIO_OPENPENCIL_ADAPTER_V0_2_0_PASS
REPORT_STUDIO_OPENPENCIL_RUNTIME_SMOKE_PASS
```

统一命令：

```powershell
$env:OPENPENCIL_RUNTIME_ROOT='<isolated-runtime-root>'
npm run verify:openpencil-runtime
```

## 正式环境边界

```text
PRODUCTION_DSH_HOME_TOUCHED=NO
PRODUCTION_PROFILE_TOUCHED=NO
PRODUCTION_PROJECT_TOUCHED=NO
PRODUCTION_CREDENTIALS_READ=NO
PRODUCTION_DATA_TOUCHED=NO
```

独立 DSH、浏览器 Host 和原生 OpenPencil daemon 已停止，测试端口已释放。该结果证明兼容 fork 可以在目标 DSH 版本线上运行，但不等于已批准安装到正式 Profile 或合并到主分支。
