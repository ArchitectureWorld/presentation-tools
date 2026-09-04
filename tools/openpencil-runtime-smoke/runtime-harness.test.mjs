import test from 'node:test'
import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'

import {
  RuntimeHarnessError,
  assertRuntimeHarnessIsolation,
  resolveInstalledRuntime,
  runRealLifecycleSmoke,
} from './runtime-harness.mjs'

test('rejects a runtime root without the real OpenPencil host implementation', () => {
  assert.throws(
    () => resolveInstalledRuntime(join(process.cwd(), 'missing-runtime')),
    error => error instanceof RuntimeHarnessError
      && error.code === 'openpencil_runtime_not_installed',
  )
})

test('resolves the installed compatibility plugin and native platform package', () => {
  const runtimeRoot = process.env.OPENPENCIL_RUNTIME_ROOT
  if (!runtimeRoot) return

  const installed = resolveInstalledRuntime(runtimeRoot)
  assert.equal(installed.pluginVersion, '0.1.0-compat.1')
  assert.equal(installed.platformPackageName, '@zseven-w/dsh-openpencil-win32-x64')
  assert.equal(installed.platformVersion, '0.1.0-rc.9')
  assert.match(installed.editorHostModule, /editor-host\.js$/u)
})

test('rejects runtime documents outside the isolated runtime root', () => {
  const runtimeRoot = resolve(tmpdir(), 'report-studio-openpencil-isolation-test')
  assert.throws(
    () => assertRuntimeHarnessIsolation(runtimeRoot, resolve(runtimeRoot, '..', 'outside-documents')),
    error => error?.code === 'runtime_non_isolated_home',
  )
})

test('real managed editor applies a frame patch, saves it and reopens the same nodes', async t => {
  const runtimeRoot = process.env.OPENPENCIL_RUNTIME_ROOT
  if (!runtimeRoot) {
    t.skip('OPENPENCIL_RUNTIME_ROOT is required for the real lifecycle smoke')
    return
  }

  const documentsDir = await mkdtemp(join(runtimeRoot, 'rs-openpencil-lifecycle-'))
  try {
    const result = await runRealLifecycleSmoke({ runtimeRoot, documentsDir })
    assert.equal(result.binding.nodeMap.length, 5)
    assert.equal(result.patchPersisted, true)
    assert.equal(result.reopenNodeIdentityStable, true)
    assert.deepEqual(result.emptySelection.layoutElementIds, [])
  } finally {
    await rm(documentsDir, { recursive: true, force: true })
  }
})
