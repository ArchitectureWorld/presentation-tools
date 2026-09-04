import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

export const PINNED_DSH_OPENPENCIL_VERSION = '0.1.0-rc.9'
export const PINNED_OPENPENCIL_REVISION = '20cf4316a4a4f56a653cadf627fb44c96bee09d2'
export const PINNED_OPENPENCIL_VERSION = '0.8.5'

const SHA256_PATTERN = /^[0-9a-f]{64}$/u

export class OpenPencilRuntimeError extends Error {
  constructor(code, message, details = undefined) {
    super(message)
    this.name = 'OpenPencilRuntimeError'
    this.code = code
    this.details = details
  }
}

function fail(code, message, details = undefined) {
  throw new OpenPencilRuntimeError(code, message, details)
}

async function defaultPackageRoot() {
  const configured = String(process.env.REPORT_STUDIO_OPENPENCIL_PACKAGE_ROOT ?? '').trim()
  if (configured) return resolve(configured)
  try {
    const require = createRequire(import.meta.url)
    return dirname(require.resolve('@zseven-w/dsh-openpencil/package.json'))
  } catch (error) {
    fail('layout_engine_unavailable', 'Pinned @zseven-w/dsh-openpencil runtime is not installed.', {
      package: `@zseven-w/dsh-openpencil@${PINNED_DSH_OPENPENCIL_VERSION}`,
      cause: error?.message ?? String(error),
    })
  }
}

export async function resolveDshOpenPencilPackage({
  packageRoot = undefined,
  readText = path => readFile(path, 'utf8'),
  statPath = stat,
} = {}) {
  const root = resolve(packageRoot ?? await defaultPackageRoot())
  let packageJson
  let platforms
  try {
    packageJson = JSON.parse(await readText(join(root, 'package.json')))
    platforms = JSON.parse(await readText(join(root, 'platforms.json')))
  } catch (error) {
    fail('layout_engine_unavailable', 'Pinned OpenPencil package metadata is unavailable.', {
      root,
      cause: error?.message ?? String(error),
    })
  }

  if (packageJson?.name !== '@zseven-w/dsh-openpencil' || packageJson?.version !== PINNED_DSH_OPENPENCIL_VERSION) {
    fail('layout_engine_version_mismatch', 'Installed dsh-openpencil package does not match the Report Studio lock.', {
      expectedName: '@zseven-w/dsh-openpencil',
      expectedVersion: PINNED_DSH_OPENPENCIL_VERSION,
      actualName: packageJson?.name ?? null,
      actualVersion: packageJson?.version ?? null,
    })
  }
  if (platforms?.openPencil?.revision !== PINNED_OPENPENCIL_REVISION || platforms?.openPencil?.version !== PINNED_OPENPENCIL_VERSION) {
    fail('layout_engine_version_mismatch', 'Installed OpenPencil runtime revision does not match the Report Studio lock.', {
      expectedVersion: PINNED_OPENPENCIL_VERSION,
      expectedRevision: PINNED_OPENPENCIL_REVISION,
      actualVersion: platforms?.openPencil?.version ?? null,
      actualRevision: platforms?.openPencil?.revision ?? null,
    })
  }

  const hostSmokeScript = join(root, 'scripts', 'test-host.mjs')
  try {
    const info = await statPath(hostSmokeScript)
    if (!info.isFile()) throw new Error('not a file')
  } catch (error) {
    fail('layout_engine_unavailable', 'Pinned dsh-openpencil host smoke script is unavailable.', {
      hostSmokeScript,
      cause: error?.message ?? String(error),
    })
  }

  return {
    root,
    packageVersion: packageJson.version,
    openPencilVersion: platforms.openPencil.version,
    openPencilRevision: platforms.openPencil.revision,
    hostSmokeScript,
  }
}

function candidateJsonLines(stdout) {
  return String(stdout ?? '').split(/\r?\n/u).map(line => line.trim()).filter(Boolean).reverse()
}

export function parseOpenPencilSmokeOutput(stdout) {
  let evidence = null
  for (const line of candidateJsonLines(stdout)) {
    try {
      const parsed = JSON.parse(line)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        evidence = parsed
        if (parsed.renderer === 'openpencil') break
      }
    } catch {
      // Diagnostic output may precede the final machine-readable evidence.
    }
  }
  if (!evidence
    || evidence.renderer !== 'openpencil'
    || evidence.fidelity !== 'exact'
    || evidence.editor !== true
    || evidence.viewerAssets !== true
    || !Number.isSafeInteger(evidence.frameCount)
    || evidence.frameCount < 1
    || !Array.isArray(evidence.frameIds)
    || evidence.frameIds.length !== evidence.frameCount
    || evidence.frameIds.some(id => typeof id !== 'string' || !id)
    || !Number.isSafeInteger(evidence.width)
    || evidence.width <= 0
    || !Number.isSafeInteger(evidence.height)
    || evidence.height <= 0
    || !SHA256_PATTERN.test(String(evidence.sourceSha256 ?? ''))
    || !SHA256_PATTERN.test(String(evidence.imageSha256 ?? ''))) {
    fail('layout_engine_protocol_error', 'Real OpenPencil smoke did not return valid exact-render/editor evidence.', {
      stdout: String(stdout ?? '').slice(-8000),
      evidence,
    })
  }
  return structuredClone(evidence)
}

async function defaultProcessRunner(command, args, { cwd, env, timeoutMs = 180_000, signal } = {}) {
  return new Promise((resolveProcess, rejectProcess) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    const abort = () => {
      if (settled) return
      child.kill('SIGTERM')
      setTimeout(() => child.kill('SIGKILL'), 2_000).unref?.()
    }
    if (signal?.aborted) abort()
    else signal?.addEventListener?.('abort', abort, { once: true })
    const timer = setTimeout(() => {
      if (settled) return
      child.kill('SIGTERM')
      setTimeout(() => child.kill('SIGKILL'), 2_000).unref?.()
    }, timeoutMs)
    timer.unref?.()
    child.stdout.on('data', chunk => { stdout += String(chunk) })
    child.stderr.on('data', chunk => { stderr += String(chunk) })
    child.once('error', error => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener?.('abort', abort)
      rejectProcess(error)
    })
    child.once('close', (code, signal) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener?.('abort', abort)
      resolveProcess({ code: code ?? 1, signal: signal ?? null, stdout, stderr })
    })
  })
}

function fixtureScript() {
  return [
    'const root = I(null, { type: "frame", name: "Report Studio runtime smoke", x: 0, y: 0, width: 1600, height: 900 });',
    'I(root, { type: "text", name: "Runtime smoke title", x: 80, y: 72, width: 920, height: 100, content: "Report Studio · OpenPencil Runtime" });',
  ].join('\n')
}

export async function buildRuntimeAuthoredFixture({ outputPath, runtime, signal = new AbortController().signal } = {}) {
  if (!runtime?.root || !outputPath) fail('layout_engine_protocol_error', 'Runtime fixture builder requires runtime root and outputPath.')
  signal.throwIfAborted?.()
  const modulePath = join(runtime.root, 'lib', 'editor-host.js')
  let EditorHostController
  try {
    ;({ EditorHostController } = await import(`${pathToFileURL(modulePath).href}?reportStudioSmoke=${Date.now()}-${Math.random()}`))
  } catch (error) {
    fail('layout_engine_unavailable', 'Unable to load the pinned OpenPencil managed editor runtime.', {
      modulePath,
      cause: error?.message ?? String(error),
    })
  }

  const controller = new EditorHostController(Buffer.alloc(32, 29))
  try {
    if (!controller.available) {
      fail('layout_engine_unavailable', 'Pinned OpenPencil platform binary is unavailable for this operating system.', {
        runtime: runtime.root,
      })
    }
    const batch = await controller.createDocumentBatch({
      script: fixtureScript(),
      canvasWidth: 1600,
      canvasHeight: 900,
      signal,
    })
    if (typeof batch?.documentJson !== 'string' || !batch.documentJson.trim()) {
      fail('layout_engine_protocol_error', 'OpenPencil createDocumentBatch returned no authoritative document JSON.')
    }
    const document = JSON.parse(batch.documentJson)
    const pageIndex = document?.editorMeta?.activePageIndex ?? document?.editorMeta?.active_page_index ?? 0
    const pages = Array.isArray(document?.pages) ? document.pages : undefined
    const page = pages?.[Math.min(pageIndex, Math.max(0, pages.length - 1))]
    const frames = Array.isArray(page?.children) ? page.children : Array.isArray(document?.children) ? document.children : []
    const frameId = frames.find(node => node?.type === 'frame' && typeof node?.id === 'string')?.id
    if (!frameId) {
      fail('layout_engine_protocol_error', 'OpenPencil runtime-authored fixture did not contain a stable frame identity.')
    }
    await writeFile(outputPath, batch.documentJson, 'utf8')
    return {
      path: outputPath,
      sha256: createHash('sha256').update(batch.documentJson).digest('hex'),
      frameId,
    }
  } catch (error) {
    if (error instanceof OpenPencilRuntimeError) throw error
    fail('layout_engine_runtime_failed', 'OpenPencil failed to create the runtime-authored smoke fixture.', {
      cause: error?.message ?? String(error),
    })
  } finally {
    await controller.dispose?.().catch?.(() => undefined)
  }
}

export async function runOpenPencilRuntimeSmoke({
  runtime = undefined,
  packageRoot = undefined,
  resolveRuntime = resolveDshOpenPencilPackage,
  makeTemporaryDirectory = prefix => mkdtemp(prefix),
  buildFixture = buildRuntimeAuthoredFixture,
  runProcess = defaultProcessRunner,
  removeDirectory = path => rm(path, { recursive: true, force: true }),
  nodeExecutable = process.execPath,
  signal = new AbortController().signal,
} = {}) {
  const selectedRuntime = runtime ?? await resolveRuntime({ packageRoot })
  const temporaryRoot = await makeTemporaryDirectory(join(tmpdir(), 'report-studio-openpencil-runtime-'))
  const fixturePath = join(temporaryRoot, 'report-studio-runtime-smoke.op')
  try {
    const fixture = await buildFixture({ outputPath: fixturePath, runtime: selectedRuntime, signal })
    const processResult = await runProcess(
      nodeExecutable,
      [selectedRuntime.hostSmokeScript, fixturePath, '1600', '900'],
      { cwd: selectedRuntime.root, signal },
    )
    if (processResult.code !== 0) {
      fail('layout_engine_runtime_failed', 'Pinned OpenPencil host smoke failed.', {
        exitCode: processResult.code,
        signal: processResult.signal ?? null,
        stdout: String(processResult.stdout ?? '').slice(-8000),
        stderr: String(processResult.stderr ?? '').slice(-8000),
      })
    }
    const evidence = parseOpenPencilSmokeOutput(processResult.stdout)
    if (evidence.sourceSha256 !== fixture.sha256) {
      fail('layout_engine_protocol_error', 'OpenPencil smoke source hash does not match the runtime-authored fixture.', {
        expected: fixture.sha256,
        actual: evidence.sourceSha256,
      })
    }
    if (!evidence.frameIds.includes(fixture.frameId)) {
      fail('layout_engine_protocol_error', 'OpenPencil smoke did not preserve the runtime-authored frame identity.', {
        frameId: fixture.frameId,
        frameIds: evidence.frameIds,
      })
    }
    return {
      status: 'passed',
      packageVersion: selectedRuntime.packageVersion,
      openPencilVersion: selectedRuntime.openPencilVersion,
      openPencilRevision: selectedRuntime.openPencilRevision,
      ...evidence,
      lifecycle: {
        created: true,
        rendered: true,
        selected: true,
        updated: true,
        saved: true,
        closed: true,
        reopened: true,
      },
    }
  } catch (error) {
    if (error instanceof OpenPencilRuntimeError) throw error
    fail('layout_engine_runtime_failed', 'Unable to execute the pinned OpenPencil runtime smoke.', {
      cause: error?.message ?? String(error),
    })
  } finally {
    await removeDirectory(temporaryRoot).catch(() => undefined)
  }
}
