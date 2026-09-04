import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  OpenPencilRuntimeError,
  PINNED_DSH_OPENPENCIL_VERSION,
  PINNED_OPENPENCIL_REVISION,
  parseOpenPencilSmokeOutput,
  resolveDshOpenPencilPackage,
  runOpenPencilRuntimeSmoke,
} from './runtime.mjs'

const digest = value => String(value).repeat(64).slice(0, 64)

function descriptor(root = '/runtime') {
  return {
    root,
    packageVersion: PINNED_DSH_OPENPENCIL_VERSION,
    openPencilVersion: '0.8.5',
    openPencilRevision: PINNED_OPENPENCIL_REVISION,
    hostSmokeScript: join(root, 'scripts', 'test-host.mjs'),
  }
}

test('resolveDshOpenPencilPackage accepts only the pinned package and OpenPencil revision', async () => {
  const files = new Map([
    ['/runtime/package.json', JSON.stringify({ name: '@zseven-w/dsh-openpencil', version: PINNED_DSH_OPENPENCIL_VERSION })],
    ['/runtime/platforms.json', JSON.stringify({ openPencil: { version: '0.8.5', revision: PINNED_OPENPENCIL_REVISION } })],
  ])
  const result = await resolveDshOpenPencilPackage({
    packageRoot: '/runtime',
    readText: async path => {
      if (!files.has(path)) throw Object.assign(new Error('missing'), { code: 'ENOENT' })
      return files.get(path)
    },
    statPath: async path => ({ isFile: () => path.endsWith('test-host.mjs') }),
  })
  assert.deepEqual(result, descriptor('/runtime'))
})

test('resolveDshOpenPencilPackage rejects version drift', async () => {
  await assert.rejects(
    resolveDshOpenPencilPackage({
      packageRoot: '/runtime',
      readText: async path => path.endsWith('package.json')
        ? JSON.stringify({ name: '@zseven-w/dsh-openpencil', version: '0.1.0-rc.10' })
        : JSON.stringify({ openPencil: { version: '0.8.5', revision: PINNED_OPENPENCIL_REVISION } }),
      statPath: async () => ({ isFile: () => true }),
    }),
    error => error instanceof OpenPencilRuntimeError && error.code === 'layout_engine_version_mismatch',
  )
})

test('parseOpenPencilSmokeOutput validates exact renderer, real editor and stable hashes', () => {
  const evidence = parseOpenPencilSmokeOutput(`noise before evidence\n${JSON.stringify({
    renderer: 'openpencil',
    fidelity: 'exact',
    width: 1600,
    height: 900,
    bytes: 1234,
    frameCount: 1,
    frameIds: ['frame-runtime-smoke'],
    sourceSha256: digest('a'),
    imageSha256: digest('b'),
    viewerAssets: true,
    editor: true,
  })}\n`)
  assert.equal(evidence.frameIds[0], 'frame-runtime-smoke')
  assert.equal(evidence.editor, true)
})

test('parseOpenPencilSmokeOutput rejects a semantic adapter result masquerading as real smoke', () => {
  assert.throws(
    () => parseOpenPencilSmokeOutput(JSON.stringify({ renderer: 'adapter', fidelity: 'semantic', frameCount: 1, viewerAssets: true, editor: true })),
    error => error.code === 'layout_engine_protocol_error',
  )
})

test('runOpenPencilRuntimeSmoke creates a runtime-authored fixture and executes the pinned host smoke', async () => {
  const calls = []
  let cleaned = false
  const result = await runOpenPencilRuntimeSmoke({
    runtime: descriptor('/runtime'),
    makeTemporaryDirectory: async () => '/tmp/layout-runtime-smoke',
    buildFixture: async ({ outputPath, runtime, signal }) => {
      calls.push({ kind: 'fixture', outputPath, runtime, aborted: signal.aborted })
      return { path: outputPath, sha256: digest('c'), frameId: 'frame-runtime-smoke' }
    },
    runProcess: async (command, args, options) => {
      calls.push({ kind: 'process', command, args, cwd: options.cwd })
      return {
        code: 0,
        stdout: JSON.stringify({
          renderer: 'openpencil', fidelity: 'exact', width: 1600, height: 900, bytes: 2048,
          frameCount: 1, frameIds: ['frame-runtime-smoke'], sourceSha256: digest('c'), imageSha256: digest('d'),
          viewerAssets: true, editor: true,
        }),
        stderr: '',
      }
    },
    removeDirectory: async path => { assert.equal(path, '/tmp/layout-runtime-smoke'); cleaned = true },
    nodeExecutable: '/node24',
  })

  assert.equal(result.status, 'passed')
  assert.equal(result.packageVersion, PINNED_DSH_OPENPENCIL_VERSION)
  assert.equal(result.openPencilRevision, PINNED_OPENPENCIL_REVISION)
  assert.equal(result.lifecycle.created, true)
  assert.equal(result.lifecycle.selected, true)
  assert.equal(result.lifecycle.updated, true)
  assert.equal(result.lifecycle.saved, true)
  assert.equal(result.lifecycle.reopened, true)
  assert.deepEqual(calls[1], {
    kind: 'process',
    command: '/node24',
    args: ['/runtime/scripts/test-host.mjs', '/tmp/layout-runtime-smoke/report-studio-runtime-smoke.op', '1600', '900'],
    cwd: '/runtime',
  })
  assert.equal(cleaned, true)
})

test('runOpenPencilRuntimeSmoke preserves diagnostic output when the real host fails', async () => {
  await assert.rejects(
    runOpenPencilRuntimeSmoke({
      runtime: descriptor('/runtime'),
      makeTemporaryDirectory: async () => '/tmp/layout-runtime-fail',
      buildFixture: async ({ outputPath }) => ({ path: outputPath, sha256: digest('e'), frameId: 'frame-runtime-smoke' }),
      runProcess: async () => ({ code: 1, stdout: 'partial', stderr: 'binary failed' }),
      removeDirectory: async () => {},
    }),
    error => error.code === 'layout_engine_runtime_failed'
      && error.details.exitCode === 1
      && error.details.stderr === 'binary failed',
  )
})
