# OpenPencil Runtime Smoke

这些脚本只用于仓库外的一次性 Runtime，不安装或修改正式 DSH Profile。

固定验证坐标：

```text
@deepseek-ai/dsh@0.1.2-rc.1
@zseven-w/dsh-openpencil@0.1.0-compat.1
@zseven-w/dsh-openpencil-win32-x64@0.1.0-rc.9
```

运行统一验证：

```powershell
$env:OPENPENCIL_RUNTIME_ROOT='<isolated-runtime-root>'
npm run verify:openpencil-runtime
```

单独启动浏览器 Host：

```powershell
$env:OPENPENCIL_RUNTIME_ROOT='<isolated-runtime-root>'
$env:OPENPENCIL_DOCUMENTS_DIR='<temporary-documents-dir>'
node tools/openpencil-runtime-smoke/browser-harness.mjs
```

Host 只监听动态 `127.0.0.1` 端口。终止进程时会关闭 managed editor、原生 OpenPencil daemon 和临时控制路由。
