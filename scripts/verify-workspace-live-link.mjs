import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DSH_PLUGIN_VENDOR_ENTRIES } from './dsh-plugin-vendor-manifest.mjs'
import { verifyVendorTree } from './release-integrity.mjs'

export const CONTRACT_COMMIT = '974668d308728386ea005c9e77d58ebff9372f0a'
export const CONTRACT_VERSION = '0.1.0'
export const SCHEMA_SET_SHA256 = '5bd329fcc8503ff7a48b3430e41b38dd264ae486cee7372a39cbbcccc2de2ebc'

export const REQUIRED_WORKSPACE_GATES = Object.freeze([
  { number: 1, id: 'legal_workspace_auto_loads', testFile: 'packages/studio-dsh-plugin/runtime.test.mjs', evidence: 'native DSH runtime keys one Repository and Watcher by the current Session Workspace' },
  { number: 2, id: 'missing_project_is_empty', testFile: 'apps/studio-local/workspace-live-link.test.mjs', evidence: 'readWorkspaceSnapshot reports missing and Contract-invalid projects without a candidate' },
  { number: 3, id: 'invalid_contract_is_rejected', testFile: 'apps/studio-local/workspace-live-link.test.mjs', evidence: 'readWorkspaceSnapshot reports missing and Contract-invalid projects without a candidate' },
  { number: 4, id: 'outline_change_revalidates', testFile: 'apps/studio-local/workspace-live-link.test.mjs', evidence: 'Workspace watcher debounces consecutive managed-file events into one validated candidate' },
  { number: 5, id: 'consecutive_writes_debounce', testFile: 'apps/studio-local/workspace-live-link.test.mjs', evidence: 'Workspace watcher debounces consecutive managed-file events into one validated candidate' },
  { number: 6, id: 'atomic_replace_recovers', testFile: 'apps/studio-local/workspace-live-link.test.mjs', evidence: 'Workspace watcher observes a real Windows atomic replacement and publishes the stable project' },
  { number: 7, id: 'draft_create_update_delete_detected', testFile: 'apps/studio-local/workspace-live-link.test.mjs', evidence: 'Workspace watcher detects draft creation, modification and deletion' },
  { number: 8, id: 'asset_manifest_change_detected', testFile: 'apps/studio-local/workspace-live-link.test.mjs', evidence: 'Workspace watcher detects draft creation, modification and deletion plus asset-manifest changes' },
  { number: 9, id: 'active_page_is_preserved', testFile: 'apps/studio-local/repository.test.mjs', evidence: 'upstream publishing adopts revision zero then preserves operational state and repairs activePageId' },
  { number: 10, id: 'missing_active_page_falls_back', testFile: 'apps/studio-local/repository.test.mjs', evidence: 'upstream publishing adopts revision zero then preserves operational state and repairs activePageId' },
  { number: 11, id: 'clean_candidate_auto_applies', testFile: 'apps/studio-local/workspace-live-link-ui.test.mjs', evidence: 'clean upstream update applies automatically and restores page-strip scroll and active page' },
  { number: 12, id: 'dirty_candidate_never_overwrites', testFile: 'apps/studio-local/workspace-live-link-ui.test.mjs', evidence: 'dirty draft pins the four-action conflict banner and never auto-applies the candidate' },
  { number: 13, id: 'explicit_discard_can_reload', testFile: 'apps/studio-local/workspace-live-link-ui.test.mjs', evidence: 'save-then-reload and discard-then-apply are explicit conflict resolutions' },
  { number: 14, id: 'layouts_are_preserved', testFile: 'apps/studio-local/workspace-live-link.test.mjs', evidence: 'Workspace Live Link archives only Contract-managed source and asset files' },
  { number: 15, id: 'unrelated_files_are_preserved', testFile: 'apps/studio-local/workspace-live-link.test.mjs', evidence: 'Workspace Live Link archives only Contract-managed source and asset files' },
  { number: 16, id: 'invalid_intermediate_keeps_snapshot', testFile: 'apps/studio-local/workspace-live-link.test.mjs', evidence: 'Workspace watcher retains the last legal snapshot through invalid atomic writes and recovers' },
  { number: 17, id: 'next_valid_write_recovers', testFile: 'apps/studio-local/workspace-live-link.test.mjs', evidence: 'Workspace watcher retains the last legal snapshot through invalid atomic writes and recovers' },
  { number: 18, id: 'workspace_switch_closes_watcher', testFile: 'packages/studio-dsh-plugin/runtime.test.mjs', evidence: 'native DSH runtime keys one Repository and Watcher by the current Session Workspace' },
  { number: 19, id: 'sessions_share_one_workspace_runtime', testFile: 'packages/studio-dsh-plugin/runtime.test.mjs', evidence: 'native DSH runtime keys one Repository and Watcher by the current Session Workspace' },
  { number: 20, id: 'windows_linux_paths_are_consistent', testFile: 'apps/studio-local/workspace-live-link.test.mjs', evidence: 'resolveWorkspaceRoot accepts a real absolute directory and rejects a symlink root' },
  { number: 21, id: 'fixed_contract_coordinates_unchanged' },
  { number: 22, id: 'full_report_studio_regression_passes' },
])

const execFileAsync = promisify(execFile)
const read = (root, path) => readFile(join(root, ...path.split('/')), 'utf8')

function includesAll(source, tokens, label) {
  for (const token of tokens) assert.ok(source.includes(token), `${label} missing ${token}`)
}

async function verifyFixedContract(root) {
  await execFileAsync('git', ['cat-file', '-e', `${CONTRACT_COMMIT}^{commit}`], { cwd: root })
  const paths = [
    'contracts/presentation-standard-project/README.md',
    'contracts/presentation-standard-project/contract-manifest.json',
    'contracts/presentation-standard-project/STANDARD_VERSION',
    'contracts/presentation-standard-project/SCHEMASET.sha256',
    'contracts/presentation-standard-project/schemas/0.1.0',
    'contracts/presentation-standard-project/src/index.d.ts',
    'contracts/presentation-standard-project/src/ids.mjs',
    'contracts/presentation-standard-project/src/factory.mjs',
    'contracts/presentation-standard-project/src/ajv-validation.mjs',
    'contracts/presentation-standard-project/src/validator.mjs',
    'contracts/presentation-standard-project/fixtures/minimal',
    'contracts/presentation-standard-project/examples/unformatted-project',
  ]
  await execFileAsync('git', ['diff', '--exit-code', CONTRACT_COMMIT, '--', ...paths], { cwd: root })
}

export async function verifyWorkspaceConfiguration(rootInput) {
  const root = resolve(rootInput)
  assert.equal(REQUIRED_WORKSPACE_GATES.length, 22)
  assert.equal(new Set(REQUIRED_WORKSPACE_GATES.map(gate => gate.id)).size, 22)

  const [rootPackage, pluginPackage, contractManifest, standardVersion, schemaSet, host, runtime, browser, html, dshVerifier, readme, install, handoff] = await Promise.all([
    read(root, 'package.json').then(JSON.parse),
    read(root, 'packages/studio-dsh-plugin/package.json').then(JSON.parse),
    read(root, 'contracts/presentation-standard-project/contract-manifest.json').then(JSON.parse),
    read(root, 'contracts/presentation-standard-project/STANDARD_VERSION'),
    read(root, 'contracts/presentation-standard-project/SCHEMASET.sha256'),
    read(root, 'packages/studio-dsh-plugin/lib/index.js'),
    read(root, 'packages/studio-dsh-plugin/lib/runtime.js'),
    read(root, 'apps/studio-local/public/app.js'),
    read(root, 'apps/studio-local/public/index.html'),
    read(root, 'scripts/verify-dsh-plugin.mjs'),
    read(root, 'README.md'),
    read(root, 'DSH_INSTALL.md'),
    read(root, 'docs/handoff/PRESENTATION_WORKSPACE_LIVE_LINK_IMPLEMENTATION.md'),
  ])

  assert.equal(rootPackage.version, '0.1.1')
  assert.equal(pluginPackage.version, '0.1.1')
  assert.equal(contractManifest.standardVersion, CONTRACT_VERSION)
  assert.equal(contractManifest.schemaSetSha256, SCHEMA_SET_SHA256)
  assert.equal(standardVersion.trim(), CONTRACT_VERSION)
  assert.equal(schemaSet.trim().split(/\s+/u)[0], SCHEMA_SET_SHA256)
  assert.equal(rootPackage.scripts?.['verify:workspace'], 'node scripts/verify-workspace-live-link.mjs')
  assert.match(rootPackage.scripts?.['verify:all'] || '', /npm run verify:workspace/u)
  assert.ok(DSH_PLUGIN_VENDOR_ENTRIES.includes('apps/studio-local/workspace-live-link.mjs'))

  includesAll(host, ["name: 'studio_open_workspace_project'", "name: 'studio_reload_upstream'", '/report-studio/api/workspace/status', '/report-studio/api/workspace/reload', '/report-studio/api/workspace/apply'], 'DSH host')
  includesAll(runtime, ['sessions?.get(sessionId)', 'header?.cwd', 'createWorkspaceWatcher', 'applyWorkspaceCandidate'], 'DSH runtime')
  includesAll(browser, ['/api/workspace/status', '/api/workspace/reload', '/api/workspace/apply', 'workspaceHasDirtyEdits', 'refreshWorkspaceStatus'], 'browser runtime')
  includesAll(html, ['workspace-sync-toggle', 'workspace-sync-panel', 'workspace-conflict-banner', '重新读取 Workspace'], 'browser shell')
  assert.doesNotMatch(html, /<select[^>]+(?:model|reasoning|推理|模型)/iu)
  includesAll(dshVerifier, ['studio_open_workspace_project', 'studio_reload_upstream', '/api/workspace/status'], 'DSH verifier')

  for (const gate of REQUIRED_WORKSPACE_GATES.filter(item => item.testFile)) {
    const source = await read(root, gate.testFile)
    assert.ok(source.includes(gate.evidence), `gate ${gate.number} ${gate.id} lacks executable evidence in ${gate.testFile}`)
  }

  const documentationTokens = ['Workspace Live Link', 'studio_open_workspace_project', 'studio_reload_upstream', 'SessionHeader.cwd', '750 ms', 'layouts/', 'npm run verify:workspace', 'http://127.0.0.1:3080/']
  includesAll(readme, documentationTokens, 'README')
  includesAll(install, documentationTokens, 'DSH_INSTALL')
  includesAll(handoff, [
    'feat/report-studio-v0.1.1-hardening', 'Report Studio 0.1.1', 'Contract 0.1.0', CONTRACT_COMMIT,
    SCHEMA_SET_SHA256, 'SessionHeader.cwd', '750 ms', 'dirty', 'layouts/', 'Windows 人工测试结果',
    '已知边界', '回滚方式', '下一开发入口',
  ], 'Workspace Live Link Handoff')

  await verifyFixedContract(root)
  const vendor = await verifyVendorTree(root)
  return {
    productVersion: rootPackage.version,
    contractVersion: contractManifest.standardVersion,
    contractCommit: CONTRACT_COMMIT,
    schemaSetSha256: contractManifest.schemaSetSha256,
    gatesVerified: REQUIRED_WORKSPACE_GATES.length,
    vendorFileCount: vendor.fileCount,
  }
}

export async function runWorkspaceRegression(rootInput) {
  const root = resolve(rootInput)
  const npmCommand = process.platform === 'win32' ? process.execPath : 'npm'
  const args = process.platform === 'win32'
    ? [join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'), 'test']
    : ['test']
  const code = await new Promise((resolveCode, reject) => {
    const child = spawn(npmCommand, args, { cwd: root, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', value => resolveCode(value ?? 1))
  })
  assert.equal(code, 0, 'full Report Studio regression failed')
}

async function main() {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const result = await verifyWorkspaceConfiguration(root)
  await runWorkspaceRegression(root)
  console.log('PRESENTATION_WORKSPACE_LIVE_LINK_PASS')
  console.log(`gates=${result.gatesVerified}`)
  console.log(`product=${result.productVersion}`)
  console.log(`contract=${result.contractVersion}`)
  console.log(`contractCommit=${result.contractCommit}`)
  console.log(`schemaSetSha256=${result.schemaSetSha256}`)
  console.log(`vendorFiles=${result.vendorFileCount}`)
}

const invoked = process.argv[1] ? resolve(process.argv[1]) : ''
if (invoked === fileURLToPath(import.meta.url)) main().catch(error => {
  console.error(error?.stack || error)
  process.exitCode = 1
})
