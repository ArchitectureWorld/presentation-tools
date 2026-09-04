import { fileURLToPath } from 'node:url'
import {
  resolveDshOpenPencilPackage,
  runOpenPencilRuntimeSmoke,
} from '../packages/studio-layout-openpencil/runtime.mjs'

export async function verifyLayoutOpenPencilRuntime({
  env = process.env,
  packageRoot = env.REPORT_STUDIO_OPENPENCIL_PACKAGE_ROOT,
  resolveRuntime = resolveDshOpenPencilPackage,
  runSmoke = runOpenPencilRuntimeSmoke,
} = {}) {
  const required = env.REQUIRE_REAL_OPENPENCIL === '1'
  let runtime
  try {
    runtime = await resolveRuntime({ packageRoot })
  } catch (error) {
    if (required) throw error
    return {
      status: 'skipped',
      required: false,
      code: error?.code ?? 'layout_engine_unavailable',
      message: error?.message ?? String(error),
    }
  }
  return runSmoke({ runtime })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const result = await verifyLayoutOpenPencilRuntime()
    console.log(JSON.stringify(result, null, 2))
  } catch (error) {
    console.error(JSON.stringify({
      status: 'failed',
      code: error?.code ?? 'layout_engine_runtime_failed',
      message: error?.message ?? String(error),
      details: error?.details ?? null,
    }, null, 2))
    process.exitCode = 1
  }
}
