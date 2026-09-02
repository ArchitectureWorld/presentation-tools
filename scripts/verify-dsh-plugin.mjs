import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8')
const packageJson = JSON.parse(await read('packages/studio-dsh-plugin/package.json'))
assert.equal(packageJson.name, '@architectureworld/report-studio-dsh')
assert.equal(packageJson.version, '0.1.0')
assert.equal(packageJson.dsh?.bundle?.patch, './cordis.patch.yml')
assert.equal(packageJson.dsh?.client?.platform, 'web')
assert.equal(packageJson.exports?.['./client'], './lib/client.js')
assert.equal(packageJson.dependencies?.['@deepseek-ai/dsh-tools'], '0.1.1-rc.2')
const patch = await read('packages/studio-dsh-plugin/cordis.patch.yml')
assert.match(patch, /id: report-studio-dsh/)
assert.match(patch, /@architectureworld\/report-studio-dsh/)
const host = await read('packages/studio-dsh-plugin/lib/index.js')
for (const token of [
  "inject = ['tools', 'webServer', 'systemPrompt']",
  "path: '/report-studio'",
  "name: 'studio_get_context'",
  "name: 'studio_apply_commands'",
  "agentMode: 'dsh-native'",
]) assert.ok(host.includes(token), `missing host integration token: ${token}`)
const client = await read('packages/studio-dsh-plugin/lib/client.js')
for (const token of [
  "id: '@architectureworld/report-studio-dsh'",
  "name: 'conversation.view'",
  "name: 'conversation.session.header.actions'",
  "session.prompt([{ type: 'text', text }], 'queue')",
  "/report-studio/?sessionId=${encodeURIComponent(sessionId)}",
]) assert.ok(client.includes(token), `missing client integration token: ${token}`)
const browser = await read('apps/studio-local/public/dsh-native-runtime.js')
for (const token of [
  "window.location.pathname.startsWith('/report-studio')",
  "type: 'report-studio.prompt'",
  'report-studio.prompt-result',
  "apiPath('/api/state')",
]) assert.ok(browser.includes(token), `missing browser native bridge token: ${token}`)
const html = await read('apps/studio-local/public/index.html')
assert.match(html, /href="\.\/styles\.css"/)
assert.match(html, /src="\.\/app\.js"/)
console.log('Report Studio native DSH plugin verification PASS')
console.log('plugin=@architectureworld/report-studio-dsh@0.1.0')
console.log('baseline=@deepseek-ai/dsh@0.1.1-rc.2')
console.log('route=/report-studio')
console.log('tools=studio_get_context,studio_apply_commands')
