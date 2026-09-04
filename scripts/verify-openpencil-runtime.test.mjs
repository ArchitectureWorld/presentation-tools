import test from 'node:test'
import assert from 'node:assert/strict'

import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  createIsolatedRuntimeEnv,
  evaluateSmokeStatus,
  validateRunEvidence,
} from './verify-openpencil-runtime.mjs'

const passingResult = {
  packageInstall: true,
  pluginLoad: true,
  dshWebStartup: true,
  capabilityProbe: true,
  createTransaction: true,
  realBindings: true,
  framePatch: true,
  selectionMapping: true,
  documentSave: true,
  documentReopen: true,
  managedEditor: true,
  browserCanvas: true,
  browserViewport: true,
  browserSelection: true,
  browserDirty: true,
  browserSaveReopen: true,
  browserConsoleErrors: 0,
  environmentCleanup: true,
  productionDataTouched: 'NO',
}

test('runtime smoke remains blocked when browser interaction evidence is incomplete', () => {
  assert.deepEqual(evaluateSmokeStatus({ ...passingResult, browserSelection: false }), {
    status: 'BLOCKED',
    blockedAt: 'browser-selection',
  })
})

test('runtime smoke passes only when all real runtime, browser and cleanup gates pass', () => {
  assert.deepEqual(evaluateSmokeStatus(passingResult), {
    status: 'PASS',
    blockedAt: null,
  })
})

test('runtime smoke rejects stale or mismatched browser evidence', () => {
  const evidence = {
    runId: 'run-current',
    recordedAt: '2026-09-04T08:00:00.000Z',
    branch: 'feat/report-studio-v0.2.0-layout',
    sourceFingerprint: 'sha256:current',
  }
  const expected = {
    runId: 'run-current',
    branch: 'feat/report-studio-v0.2.0-layout',
    sourceFingerprint: 'sha256:current',
    now: Date.parse('2026-09-04T08:10:00.000Z'),
    maxAgeMs: 30 * 60 * 1000,
  }

  assert.equal(validateRunEvidence(evidence, expected), true)
  assert.throws(() => validateRunEvidence(evidence, { ...expected, runId: '' }), /run id/u)
  assert.throws(() => validateRunEvidence(evidence, { ...expected, runId: 'run-other' }), /run id/u)
  assert.throws(() => validateRunEvidence(evidence, { ...expected, sourceFingerprint: 'sha256:changed' }), /source fingerprint/u)
  assert.throws(() => validateRunEvidence(evidence, { ...expected, now: Date.parse('2026-09-04T09:00:00.000Z') }), /stale/u)
})

test('runtime verification redirects child process state into the isolated runtime root', () => {
  const runtimeRoot = join(tmpdir(), 'report-studio-openpencil-runtime-test')
  const env = createIsolatedRuntimeEnv(runtimeRoot, { PATH: 'test-path', USERPROFILE: 'C:\\Users\\production' })

  assert.equal(env.PATH, 'test-path')
  assert.equal(env.DSH_HOME, join(runtimeRoot, 'dsh-home'))
  assert.equal(env.USERPROFILE, join(runtimeRoot, 'user-profile'))
  assert.equal(env.APPDATA, join(runtimeRoot, 'user-profile', 'AppData', 'Roaming'))
  assert.equal(env.LOCALAPPDATA, join(runtimeRoot, 'user-profile', 'AppData', 'Local'))
  assert.equal(env.TEMP, join(runtimeRoot, 'temp'))
  assert.equal(env.TMP, join(runtimeRoot, 'temp'))
  assert.equal(env.npm_config_cache, join(runtimeRoot, 'cache', 'npm'))
})
