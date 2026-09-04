import test from 'node:test'
import assert from 'node:assert/strict'
import {
  RuntimeReleaseError,
  createOpenPencilCompatibilityManifest,
  selectHighestStableVersion,
  selectStableRuntimePair,
} from './runtime-installer.mjs'

test('blocks a release line when the registry has no stable version', () => {
  assert.throws(
    () => selectHighestStableVersion(['0.1.2-rc.1', '0.1.2-alpha.5'], '@deepseek-ai/dsh'),
    error => error instanceof RuntimeReleaseError
      && error.code === 'runtime_no_stable_release'
      && error.details.packageName === '@deepseek-ai/dsh',
  )
})

test('selects the highest stable version and ignores prereleases', () => {
  assert.equal(
    selectHighestStableVersion(['0.1.0', '0.2.0-rc.1', '0.1.2', '0.1.1'], '@zseven-w/dsh-openpencil'),
    '0.1.2',
  )
})

test('returns a pair only when both packages have stable releases', () => {
  assert.deepEqual(selectStableRuntimePair({
    dshVersions: ['0.1.0', '0.2.0-rc.1'],
    openPencilVersions: ['0.1.0-rc.9', '0.1.0'],
  }), {
    dsh: '0.1.0',
    openPencil: '0.1.0',
  })
})

test('creates a compatibility manifest pinned to the target DSH prerelease line', () => {
  const manifest = createOpenPencilCompatibilityManifest({
    name: '@zseven-w/dsh-openpencil',
    version: '0.1.0-rc.9',
    peerDependencies: {
      '@deepseek-ai/cordis': '^4.0.1',
      '@deepseek-ai/dsh-tools': '^0.1.0-rc.6',
      react: '^18.2.0',
    },
    optionalDependencies: {
      '@zseven-w/dsh-openpencil-win32-x64': '0.1.0-rc.9',
    },
    dsh: {
      client: {
        inject: [
          '@deepseek-ai/dsh-client-runtime',
          '@deepseek-ai/dsh-client-locale',
          '@deepseek-ai/dsh-client-ui-conversation',
        ],
      },
    },
  }, { targetDshVersion: '0.1.2-rc.1' })

  assert.equal(manifest.version, '0.1.0-compat.1')
  assert.equal(manifest.peerDependencies['@deepseek-ai/cordis'], '4.0.2')
  assert.equal(manifest.peerDependencies['@deepseek-ai/dsh-tools'], '0.1.2-rc.1')
  assert.equal(manifest.peerDependencies.react, '^18.2.0')
  assert.equal(manifest.optionalDependencies['@zseven-w/dsh-openpencil-win32-x64'], '0.1.0-rc.9')
  assert.deepEqual(manifest.dsh.client.inject, [
    '@deepseek-ai/dsh-client-locale',
    '@deepseek-ai/dsh-client-ui-conversation',
  ])
})
