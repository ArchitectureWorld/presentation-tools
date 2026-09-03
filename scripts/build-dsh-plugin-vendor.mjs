import { cp, mkdir, rm } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const pluginRoot = join(root, 'packages', 'studio-dsh-plugin')
const vendorRoot = join(pluginRoot, 'vendor')
if (!vendorRoot.startsWith(`${pluginRoot}${sep}`)) throw new Error('Vendor target escaped plugin root')

const entries = [
  'apps/studio-local/repository.mjs',
  'apps/studio-local/migration.mjs',
  'apps/studio-local/standard-project.mjs',
  'apps/studio-local/public',
  'packages/studio-core/index.mjs',
  'packages/studio-contracts/index.mjs',
  'packages/studio-standard-adapter/index.mjs',
  'contracts/presentation-standard-project/src',
  'contracts/presentation-standard-project/schemas/0.1.0',
]

await rm(vendorRoot, { recursive: true, force: true })
for (const entry of entries) {
  const source = join(root, ...entry.split('/'))
  const target = join(vendorRoot, ...entry.split('/'))
  await mkdir(dirname(target), { recursive: true })
  await cp(source, target, { recursive: true, force: true })
}
console.log(`Report Studio DSH vendor sync PASS entries=${entries.length}`)
