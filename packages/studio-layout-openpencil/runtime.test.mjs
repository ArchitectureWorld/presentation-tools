import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

import {
  OpenPencilRuntimeError,
  PINNED_DSH_OPENPENCIL_VERSION,
  PINNED_OPENPENCIL_REVISION,
  assertOpenPencilRuntimeEvidence,
  resolveDshOpenPencilPackage,
  runOpenPencilRuntimeSmoke,
} from './runtime.mjs'

const digest = value => String(value).repeat(64).slice(0, 64)
const runtimeRoot = resolve('runtime-fixture')

function descriptor(root = runtimeRoot) {
  return {
    root,
    packageVersion: PINNED_DSH_OPENPENCIL_VERSION,
    openPencilVersion: '0.8.5',
    openPencilRevision: PINNED_OPENPENCIL_REVISION,
    editorHostModule: join(root, 'lib', 'editor-host.js'),
    editorRecoveryModule: join(root, 'lib', 'editor-recovery.js'),
  }
}

function passedEvidence(overrides = {}) {
  return {
    status: 'passed',
    runtime: 'openpencil-managed',
    packageVersion: PINNED_DSH_OPENPENCIL_VERSION,
    openPencilVersion: '0.8.5',
    openPencilRevision: PINNED_OPENPENCIL_REVISION,
    width: 1600,
    height: 900,
    batchDesign: true,
    bindingCount: 2,
    managedEditor: true,
    selectionMapped: true,
    framePatch: true,
    saved: true,
    reopened: true,
    documentSha256: digest('a'),
    reopenedSha256: digest('a'),
    lifecycle: { created: true, selected: true, updated: true, saved: true, closed: true, reopened: true },
    ...overrides,
  }
}

test('resolveDshOpenPencilPackage accepts only the pinned package and managed runtime modules', async () => {
  const files = new Map([
    [join(runtimeRoot, 'package.json'), JSON.stringify({ name: '@zseven-w/dsh-openpencil', version: PINNED_DSH_OPENPENCIL_VERSION })],
    [join(runtimeRoot, 'platforms.json'), JSON.stringify({ openPencil: { version: '0.8.5', revision: PINNED_OPENPENCIL_REVISION } })],
  ])
  const result = await resolveDshOpenPencilPackage({
    packageRoot: runtimeRoot,
    readText: async path => {
      if (!files.has(path)) throw Object.assign(new Error('missing'), { code: 'ENOENT' })
      return files.get(path)
    },
    statPath: async path => ({ isFile: () => path.endsWith('editor-host.js') || path.endsWith('editor-recovery.js') }),
  })
  assert.deepEqual(result, descriptor())
})

test('resolveDshOpenPencilPackage rejects version drift', async () => {
  await assert.rejects(
    resolveDshOpenPencilPackage({
      packageRoot: runtimeRoot,
      readText: async path => path.endsWith('package.json')
        ? JSON.stringify({ name: '@zseven-w/dsh-openpencil', version: '0.1.0-rc.10' })
        : JSON.stringify({ openPencil: { version: '0.8.5', revision: PINNED_OPENPENCIL_REVISION } }),
      statPath: async () => ({ isFile: () => true }),
    }),
    error => error instanceof OpenPencilRuntimeError && error.code === 'layout_engine_version_mismatch',
  )
})

test('assertOpenPencilRuntimeEvidence requires real batch, editor, selection, patch, save and reopen evidence', () => {
  assert.deepEqual(assertOpenPencilRuntimeEvidence(passedEvidence()).status, 'passed')
  for (const field of ['batchDesign', 'managedEditor', 'selectionMapped', 'framePatch', 'saved', 'reopened']) {
    assert.throws(
      () => assertOpenPencilRuntimeEvidence(passedEvidence({ [field]: false })),
      error => error instanceof OpenPencilRuntimeError && error.code === 'layout_engine_protocol_error',
      field,
    )
  }
})

test('runOpenPencilRuntimeSmoke executes the managed lifecycle in an isolated DSH home and cleans it', async () => {
  let cleaned = false
  let observedDshHome = null
  const expectedTemporaryRoot = resolve('layout-runtime-smoke')
  const before = process.env.DSH_HOME
  process.env.DSH_HOME = '/production-dsh-home'
  try {
    const result = await runOpenPencilRuntimeSmoke({
      runtime: descriptor(),
      makeTemporaryDirectory: async () => expectedTemporaryRoot,
      executeLifecycle: async ({ runtime, temporaryRoot, signal }) => {
        assert.deepEqual(runtime, descriptor())
        assert.equal(temporaryRoot, expectedTemporaryRoot)
        assert.equal(signal.aborted, false)
        observedDshHome = process.env.DSH_HOME
        return passedEvidence({ packageVersion: 'ignored-by-lifecycle' })
      },
      removeDirectory: async path => {
        assert.equal(path, expectedTemporaryRoot)
        cleaned = true
      },
    })
    assert.equal(result.status, 'passed')
    assert.equal(result.packageVersion, PINNED_DSH_OPENPENCIL_VERSION)
    assert.equal(observedDshHome, join(expectedTemporaryRoot, 'dsh-home'))
    assert.equal(cleaned, true)
    assert.equal(process.env.DSH_HOME, '/production-dsh-home')
  } finally {
    if (before === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = before
  }
})

test('runOpenPencilRuntimeSmoke restores DSH_HOME and cleans the temporary directory after failure', async () => {
  let cleaned = false
  const expectedTemporaryRoot = resolve('layout-runtime-fail')
  const before = process.env.DSH_HOME
  delete process.env.DSH_HOME
  try {
    await assert.rejects(
      runOpenPencilRuntimeSmoke({
        runtime: descriptor(),
        makeTemporaryDirectory: async () => expectedTemporaryRoot,
        executeLifecycle: async () => { throw new OpenPencilRuntimeError('layout_engine_runtime_failed', 'managed daemon failed', { diagnostic: 'safe' }) },
        removeDirectory: async path => { assert.equal(path, expectedTemporaryRoot); cleaned = true },
      }),
      error => error.code === 'layout_engine_runtime_failed' && error.details.diagnostic === 'safe',
    )
    assert.equal(cleaned, true)
    assert.equal(process.env.DSH_HOME, undefined)
  } finally {
    if (before !== undefined) process.env.DSH_HOME = before
  }
})
