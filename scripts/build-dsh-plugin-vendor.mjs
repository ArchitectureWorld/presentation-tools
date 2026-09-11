import { cp, mkdir, rm } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DSH_PLUGIN_VENDOR_ENTRIES } from './dsh-plugin-vendor-manifest.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const pluginRoot = join(root, 'packages', 'studio-dsh-plugin')
const vendorRoot = join(pluginRoot, 'vendor')
if (!vendorRoot.startsWith(`${pluginRoot}${sep}`)) throw new Error('Vendor target escaped plugin root')

await rm(vendorRoot, { recursive: true, force: true })
for (const entry of DSH_PLUGIN_VENDOR_ENTRIES) {
  const source = join(root, ...entry.split('/'))
  const target = join(vendorRoot, ...entry.split('/'))
  await mkdir(dirname(target), { recursive: true })
  await cp(source, target, { recursive: true, force: true })
}
console.log(`Report Studio DSH vendor sync PASS entries=${DSH_PLUGIN_VENDOR_ENTRIES.length}`)
