#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { assertRuntimeHarnessIsolation } from '../tools/openpencil-runtime-smoke/runtime-harness.mjs'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const EXPECTED_DSH = '0.1.2-rc.1'
const EXPECTED_PLUGIN = '0.1.0-compat.1'
const EXPECTED_PLATFORM = '0.1.0-rc.9'
const EVIDENCE_MAX_AGE_MS = 30 * 60 * 1000
const SOURCE_FINGERPRINT_PATHS = [
  'package.json',
  'apps/studio-local/server.test.mjs',
  'packages/studio-layout-engine-binding',
  'packages/studio-layout-openpencil',
  'packages/studio-layout-openpencil-runtime',
  'scripts/verify-openpencil-runtime.mjs',
  'scripts/verify-openpencil-runtime.test.mjs',
  'tools/openpencil-runtime-smoke',
]

const gates = [
  ['packageInstall', 'package-install'],
  ['pluginLoad', 'plugin-load'],
  ['dshWebStartup', 'dsh-web-startup'],
  ['capabilityProbe', 'capability-probe'],
  ['createTransaction', 'create-transaction'],
  ['realBindings', 'real-bindings'],
  ['framePatch', 'frame-patch'],
  ['selectionMapping', 'selection-mapping'],
  ['documentSave', 'document-save'],
  ['documentReopen', 'document-reopen'],
  ['managedEditor', 'managed-editor'],
  ['browserCanvas', 'browser-canvas'],
  ['browserViewport', 'browser-viewport'],
  ['browserSelection', 'browser-selection'],
  ['browserDirty', 'browser-dirty'],
  ['browserSaveReopen', 'browser-save-reopen'],
  ['environmentCleanup', 'environment-cleanup'],
]

export function evaluateSmokeStatus(result) {
  for (const [key, label] of gates) {
    if (result[key] !== true) return { status: 'BLOCKED', blockedAt: label }
  }
  if (result.browserConsoleErrors !== 0) return { status: 'BLOCKED', blockedAt: 'browser-console-errors' }
  if (result.productionDataTouched !== 'NO') return { status: 'BLOCKED', blockedAt: 'production-boundary' }
  return { status: 'PASS', blockedAt: null }
}

function filesUnder(path, root = path) {
  if (!existsSync(path)) return []
  const entries = readdirSync(path, { withFileTypes: true })
  return entries.flatMap(entry => {
    const child = join(path, entry.name)
    if (entry.isDirectory()) return filesUnder(child, root)
    return entry.isFile() ? [child] : []
  })
}

export function computeSourceFingerprint() {
  const hash = createHash('sha256')
  for (const sourcePath of SOURCE_FINGERPRINT_PATHS) {
    const absolute = join(repoRoot, sourcePath)
    const files = existsSync(absolute) && readdirSafe(absolute)
      ? filesUnder(absolute)
      : existsSync(absolute) ? [absolute] : []
    for (const file of files.sort()) {
      hash.update(relative(repoRoot, file).replaceAll('\\', '/'))
      hash.update('\0')
      hash.update(readFileSync(file))
      hash.update('\0')
    }
  }
  return `sha256:${hash.digest('hex')}`
}

function readdirSafe(path) {
  try {
    readdirSync(path)
    return true
  } catch {
    return false
  }
}

function currentBranch() {
  const branch = spawnSync('git', ['branch', '--show-current'], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
  return branch.status === 0 ? branch.stdout.trim() : ''
}

export function validateRunEvidence(evidence, {
  runId,
  branch,
  sourceFingerprint,
  now = Date.now(),
  maxAgeMs = EVIDENCE_MAX_AGE_MS,
}) {
  if (typeof runId !== 'string' || runId.length === 0) throw new Error('OpenPencil smoke run id is required')
  if (!evidence || evidence.runId !== runId) throw new Error('OpenPencil browser evidence run id does not match')
  if (evidence.branch !== branch) throw new Error('OpenPencil browser evidence branch does not match')
  if (evidence.sourceFingerprint !== sourceFingerprint) throw new Error('OpenPencil browser evidence source fingerprint does not match')
  const recordedAt = Date.parse(evidence.recordedAt)
  if (!Number.isFinite(recordedAt)) throw new Error('OpenPencil browser evidence recorded time is invalid')
  const age = now - recordedAt
  if (age < 0 || age > maxAgeMs) throw new Error('OpenPencil browser evidence is stale')
  return true
}

export function createIsolatedRuntimeEnv(runtimeRoot, baseEnv = process.env) {
  const root = assertRuntimeHarnessIsolation(runtimeRoot, join(runtimeRoot, 'documents'))
  const paths = {
    userProfile: join(root.runtimeRoot, 'user-profile'),
    userProfileRoaming: join(root.runtimeRoot, 'user-profile', 'AppData', 'Roaming'),
    userProfileLocal: join(root.runtimeRoot, 'user-profile', 'AppData', 'Local'),
    appData: join(root.runtimeRoot, 'config', 'roaming'),
    localAppData: join(root.runtimeRoot, 'config', 'local'),
    temp: join(root.runtimeRoot, 'temp'),
    npmCache: join(root.runtimeRoot, 'cache', 'npm'),
  }
  Object.values(paths).forEach(path => mkdirSync(path, { recursive: true }))
  return {
    ...baseEnv,
    DSH_HOME: join(root.runtimeRoot, 'dsh-home'),
    USERPROFILE: paths.userProfile,
    APPDATA: paths.userProfileRoaming,
    LOCALAPPDATA: paths.userProfileLocal,
    TEMP: paths.temp,
    TMP: paths.temp,
    npm_config_cache: paths.npmCache,
    OPENPENCIL_RUNTIME_ROOT: root.runtimeRoot,
    OPENPENCIL_SYSTEM_TEMP_ROOT: process.env.OPENPENCIL_SYSTEM_TEMP_ROOT ?? tmpdir(),
    OPENPENCIL_PRODUCTION_DSH_HOME: process.env.OPENPENCIL_PRODUCTION_DSH_HOME ?? join(homedir(), '.dsh'),
  }
}

function manifest(path) {
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined
}

function processCount(imageName) {
  if (process.platform !== 'win32') return 0
  const tasklist = spawnSync('tasklist.exe', ['/FI', `IMAGENAME eq ${imageName}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8' })
  if (tasklist.status !== 0) return -1
  return tasklist.stdout.split(/\r?\n/u).filter(line => line.toLowerCase().includes(imageName.toLowerCase())).length
}

function browserEvidence() {
  const path = join(repoRoot, 'docs', 'acceptance', 'evidence', 'report-studio-v0.2.0-openpencil-browser-smoke.json')
  return manifest(path)
}

function runtimeManifests(runtimeRoot) {
  if (!runtimeRoot) return {}
  const nodeModules = join(runtimeRoot, 'node_modules')
  return {
    dsh: manifest(join(nodeModules, '@deepseek-ai', 'dsh', 'package.json')),
    plugin: manifest(join(nodeModules, '@zseven-w', 'dsh-openpencil', 'package.json')),
    platform: manifest(join(nodeModules, '@zseven-w', 'dsh-openpencil-win32-x64', 'package.json')),
  }
}

function runRuntimeTests(runtimeRoot) {
  if (!runtimeRoot) return { passed: false, stdout: '', stderr: 'OPENPENCIL_RUNTIME_ROOT is required' }
  const testFiles = [
    'packages/studio-layout-engine-binding/index.test.mjs',
    'packages/studio-layout-openpencil/index.test.mjs',
    'packages/studio-layout-openpencil-runtime/index.test.mjs',
    'tools/openpencil-runtime-smoke/runtime-harness.test.mjs',
    'tools/openpencil-runtime-smoke/browser-harness.test.mjs',
  ]
  const before = processCount('op-host-web-server.exe')
  let env
  try {
    env = createIsolatedRuntimeEnv(runtimeRoot)
  } catch (error) {
    return { passed: false, stdout: '', stderr: error instanceof Error ? error.message : String(error), childCleanup: false }
  }
  const test = spawnSync(process.execPath, ['--test', ...testFiles], {
    cwd: repoRoot,
    env,
    encoding: 'utf8',
    timeout: 180_000,
  })
  const after = processCount('op-host-web-server.exe')
  return {
    passed: test.status === 0 && !test.error,
    stdout: test.stdout,
    stderr: test.error?.message ?? test.stderr,
    childCleanup: before >= 0 && before === after,
  }
}

export function runVerification({
  runtimeRoot = process.env.OPENPENCIL_RUNTIME_ROOT,
  runId = process.env.OPENPENCIL_SMOKE_RUN_ID,
  now = Date.now(),
} = {}) {
  const installed = runtimeManifests(runtimeRoot)
  const evidence = browserEvidence()
  const tests = runRuntimeTests(runtimeRoot)
  const branch = currentBranch()
  const sourceFingerprint = computeSourceFingerprint()
  let evidenceValidationError = null
  try {
    validateRunEvidence(evidence, { runId, branch, sourceFingerprint, now })
  } catch (error) {
    evidenceValidationError = error instanceof Error ? error.message : String(error)
  }
  const evidenceValid = evidenceValidationError === null
  const packageInstall = installed.dsh?.version === EXPECTED_DSH
    && installed.plugin?.version === EXPECTED_PLUGIN
    && installed.platform?.version === EXPECTED_PLATFORM
  const browserVersionMatch = evidenceValid
    && evidence?.dsh === EXPECTED_DSH
    && evidence?.dshOpenPencil === EXPECTED_PLUGIN
    && evidence?.platformPackage === EXPECTED_PLATFORM
  const browser = evidence?.browser ?? {}
  const cleanup = evidence?.cleanup ?? {}

  const result = {
    platform: `${process.platform}-${process.arch}`,
    node: process.version,
    dsh: EXPECTED_DSH,
    dshOpenPencil: EXPECTED_PLUGIN,
    platformPackage: EXPECTED_PLATFORM,
    evidenceValid,
    packageInstall,
    pluginLoad: packageInstall,
    dshWebStartup: browserVersionMatch && evidence?.dshWebStartup === true,
    capabilityProbe: tests.passed,
    createTransaction: tests.passed,
    realBindings: tests.passed,
    framePatch: tests.passed,
    selectionMapping: tests.passed && browserVersionMatch && browser.selectionMapped === true,
    documentSave: tests.passed,
    documentReopen: tests.passed,
    managedEditor: tests.passed,
    browserCanvas: browserVersionMatch && browser.canvasVisible === true && browser.canvasNonBlank === true,
    browserViewport: browserVersionMatch && browser.zoom === true && browser.pan === true && browser.fitView === true,
    browserSelection: browserVersionMatch && browser.selectionMapped === true && browser.reopenNodeIdentityStable === true,
    browserDirty: browserVersionMatch && browser.dirtyTransition === true,
    browserSaveReopen: browserVersionMatch && browser.saveCount >= 1 && browser.reopenCount >= 1,
    browserConsoleErrors: Array.isArray(browser.consoleErrors) ? browser.consoleErrors.length : -1,
    environmentCleanup: tests.childCleanup === true
      && cleanup.browserHarnessStopped === true
      && cleanup.browserPortsReleased === true
      && cleanup.isolatedDshStopped === true
      && cleanup.isolatedDshPortReleased === true,
    productionDataTouched: evidence?.productionDataTouched === 'NO' ? 'NO' : 'UNKNOWN',
  }
  return { result, status: evaluateSmokeStatus(result), tests, evidenceValidationError, sourceFingerprint, branch, runId }
}

function printVerification(verification) {
  const marker = verification.status.status === 'PASS'
    ? 'REPORT_STUDIO_OPENPENCIL_RUNTIME_SMOKE_PASS'
    : 'REPORT_STUDIO_OPENPENCIL_RUNTIME_SMOKE_BLOCKED'
  console.log(marker)
  if (verification.status.blockedAt) console.log(`blocked-at=${verification.status.blockedAt}`)
  if (verification.evidenceValidationError) console.log(`evidence-error=${verification.evidenceValidationError}`)
  for (const [key, value] of Object.entries(verification.result)) {
    const label = key.replace(/[A-Z]/gu, character => `-${character.toLowerCase()}`)
    console.log(`${label}=${value}`)
  }
  if (!verification.tests.passed) {
    const diagnostic = verification.tests.stderr || verification.tests.stdout
    if (diagnostic) console.error(diagnostic.trim())
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const verification = runVerification()
  printVerification(verification)
  if (verification.status.status !== 'PASS') process.exitCode = 1
}
