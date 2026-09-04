import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8')
const packageJson = JSON.parse(await read('packages/studio-dsh-plugin/package.json'))
assert.equal(packageJson.name, '@architectureworld/report-studio-dsh')
assert.equal(packageJson.version, '0.1.1')
assert.equal(packageJson.dsh?.bundle?.patch, './cordis.patch.yml')
assert.equal(packageJson.dsh?.client?.platform, 'web')
assert.deepEqual(packageJson.dsh?.client?.inject, [
  '@deepseek-ai/dsh-client-runtime',
  '@deepseek-ai/dsh-client-ui-conversation',
])
assert.equal(packageJson.exports?.['./client'], './lib/client.js')
assert.deepEqual(packageJson.dependencies, { ajv: '8.17.1', 'ajv-formats': '3.0.1' })
assert.equal(packageJson.peerDependencies, undefined)

const patch = await read('packages/studio-dsh-plugin/cordis.patch.yml')
assert.match(patch, /id: report-studio-dsh/)
assert.match(patch, /@architectureworld\/report-studio-dsh/)

const host = await read('packages/studio-dsh-plugin/lib/index.js')
for (const token of [
  "inject = ['tools', 'webServer', 'systemPrompt', 'sessions']",
  "path: '/report-studio'",
  "name: 'studio_open_workspace_project'",
  "name: 'studio_reload_upstream'",
  "name: 'studio_get_context'",
  "name: 'studio_apply_commands'",
  "'/report-studio/api/workspace/status'",
  "'/report-studio/api/workspace/reload'",
  "'/report-studio/api/workspace/apply'",
  "agentMode: 'dsh-native'",
  "securityMode: SECURITY_MODE",
  "networkSharedSecurity: false",
  "schema: {}",
]) assert.ok(host.includes(token), `missing host integration token: ${token}`)
assert.ok(!host.includes("from '@deepseek-ai/dsh-tools'"), 'native host must not require an uninstalled linked-package dependency')
assert.match(host, /\.\.\/vendor\/apps\/studio-local\/standard-project\.mjs/)

const runtime = await read('packages/studio-dsh-plugin/lib/runtime.js')
assert.match(runtime, /\.\.\/vendor\/apps\/studio-local\/repository\.mjs/)
for (const token of [
  'sessions?.get(sessionId)',
  'session?.header?.cwd',
  'createWorkspaceWatcher',
  'applyWorkspaceCandidate',
]) assert.ok(runtime.includes(token), `missing Workspace runtime token: ${token}`)

const client = await read('packages/studio-dsh-plugin/lib/client.js')
for (const token of [
  "id: '@architectureworld/report-studio-dsh'",
  "name: 'conversation.view'",
  "name: 'conversation.session.header.actions'",
  "inject: () => ({ sessions })",
  "session.prompt([{ type: 'text', text }], 'queue')",
  "/report-studio/?sessionId=${encodeURIComponent(sessionId)}",
  "Report Studio · 独立打开",
  'window.confirm(',
]) assert.ok(client.includes(token), `missing client integration token: ${token}`)

const browser = await read('apps/studio-local/public/dsh-native-runtime.js')
for (const token of [
  "window.location.pathname.startsWith('/report-studio')",
  "type: 'report-studio.prompt'",
  'report-studio.prompt-result',
  "apiPath('/api/state')",
  "report-studio-dsh-embedded",
  "report-studio-standalone",
]) assert.ok(browser.includes(token), `missing browser native bridge token: ${token}`)

const studioBrowser = await read('apps/studio-local/public/app.js')
for (const token of [
  '/api/workspace/status',
  '/api/workspace/reload',
  '/api/workspace/apply',
  'workspaceHasDirtyEdits',
  'refreshWorkspaceStatus',
]) assert.ok(studioBrowser.includes(token), `missing Workspace browser token: ${token}`)

const smoke = await read('scripts/smoke-dsh-native.mjs')
assert.match(smoke, /REPORT_STUDIO_PLUGIN_PACKAGE/)
assert.match(smoke, /resolveRequiredPluginPackage/)
assert.doesNotMatch(smoke, /dist.+architectureworld-report-studio-dsh-0\.1\.1\.tgz/s)

const html = await read('apps/studio-local/public/index.html')
assert.match(html, /href="\.\/styles\.css"/)
assert.match(html, /src="\.\/dsh-native-runtime\.js"/)
assert.match(html, /src="\.\/app\.js"/)
assert.ok(html.indexOf('./dsh-native-runtime.js') < html.indexOf('./app.js'))
assert.match(html, /id="report-studio-standalone-notice"/)
assert.match(html, /当前为 Report Studio 独立工作台。模型、推理等级和 Agent 会话由 DSH 主界面管理。/)
assert.match(html, /id="report-studio-return-dsh" href="\/"/)
assert.match(html, /id="agent-fab"[^>]+aria-controls="agent-modal"[^>]+aria-expanded="false"/)
assert.doesNotMatch(html, /<select[^>]+(?:model|reasoning|推理|模型)/i)

const css = await read('apps/studio-local/public/styles.css')
assert.doesNotMatch(css, /\.report-studio-dsh-native\s+#agent-fab[\s\S]{0,160}display:\s*none\s*!important/)

console.log('Report Studio native DSH plugin verification PASS')
console.log('plugin=@architectureworld/report-studio-dsh@0.1.1')
console.log('baseline=@deepseek-ai/dsh@0.1.1-rc.2')
console.log('route=/report-studio')
console.log('tools=studio_open_workspace_project,studio_reload_upstream,studio_get_context,studio_apply_commands')
