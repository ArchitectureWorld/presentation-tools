---
document_id: report-studio-v0.2.0-openpencil-runtime-handoff
status: runtime-smoke-passed
product_version: 0.2.0-alpha.2
branch: feat/report-studio-v0.2.0-layout
starting_sha: 49e0c10c920c573e372989bb1f71bd1984e38c3f
updated_at: 2026-09-04
---

# OpenPencil Real Runtime 烟测 Handoff

## 已验证状态

Report Studio Adapter 到真实 OpenPencil Runtime 的独立链路已通过：

```text
Render Plan
  -> Adapter QuickJS transaction
  -> dsh-openpencil compatibility fork
  -> native batch_design
  -> LayoutEngineBinding
  -> Frame Patch
  -> managed editor browser
  -> Selection mapping
  -> Save / Close / Reopen
```

固定坐标：

```text
@deepseek-ai/dsh@0.1.2-rc.1
@deepseek-ai/dsh-code-runtime@0.1.2-rc.1
@zseven-w/dsh-openpencil@0.1.0-compat.1
@zseven-w/dsh-openpencil-win32-x64@0.1.0-rc.9
```

## 关键修复

1. Adapter 输出由未声明赋值改为 QuickJS 可执行的 `const b0/b1/...`。
2. Binding 读取真实 Runtime 的顺序绑定，而不是假设 Runtime 会回传 `rs_el_*`。
3. `LayoutEngineBinding` 同时接受旧的 `rs_el_<16 hex>` 和真实的 `b1/b2/...`，保持已有合同兼容。
4. 新增真实 Runtime lifecycle harness、浏览器 Host harness、统一 fail-closed 验证器和脱敏证据。
5. Windows 中文仓库路径测试改用 `fileURLToPath()`，主体门禁恢复为全绿。

## 验证结果

```text
Layout/OpenPencil: 61/61
Existing Report Studio: 51/51
Runtime verifier: PASS
Browser console errors: 0
Production data touched: NO
```

浏览器烟测确认 Canvas/WASM 非空、缩放、平移、适配视图、真实节点选择、dirty、保存和 successor 重开。节点 `n6` 在重开前后保持稳定，并反向映射为 `layout_element_runtime_title`。

## 已知边界

- OpenPencil finalize 会归一化部分布局属性，例如根高度和文本 `fit_content`；不能把验收描述为初始几何字节完全不变。
- 隔离环境没有协作事件流，因此出现一条回退 polling warning；无 console error。
- 兼容包目前是仓库外构建的本地 fork，不是上游正式发布版本。
- 尚未安装到正式 DSH Profile，尚未合并主分支。

## 后续执行顺序

1. 审查当前分支提交和脱敏证据；
2. 决定兼容 fork 的长期发布位置与版本治理；
3. 获得正式环境安装批准后，再单独执行 Profile 备份、安装和宿主验收；
4. 在正式验收前继续禁止触碰生产 Session、项目和凭据。

## 安全裁决

```text
SAFE_TO_CONTINUE_BRANCH_DEVELOPMENT=YES
SAFE_TO_REUSE_ISOLATED_RUNTIME_HARNESS=YES
SAFE_TO_INSTALL_IN_PRODUCTION_PROFILE=NOT_YET_APPROVED
SAFE_TO_MERGE_INTO_MAIN=NOT_YET_APPROVED
PRODUCTION_DATA_TOUCHED=NO
```
