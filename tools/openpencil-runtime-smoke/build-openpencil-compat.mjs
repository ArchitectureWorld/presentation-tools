#!/usr/bin/env node
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createOpenPencilCompatibilityManifest } from './runtime-installer.mjs'

const [, , sourceArg, outputArg, targetDshVersion = '0.1.2-rc.1'] = process.argv
if (!sourceArg || !outputArg) {
  console.error('Usage: node build-openpencil-compat.mjs <source-package-dir> <output-package-dir> [target-dsh-version]')
  process.exit(2)
}

const source = resolve(sourceArg)
const output = resolve(outputArg)
if (output === source) throw new Error('Output package must be separate from source package')
await mkdir(output, { recursive: true })
await cp(source, output, { recursive: true, force: true })
const manifestPath = join(output, 'package.json')
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
const patched = createOpenPencilCompatibilityManifest(manifest, { targetDshVersion })
patched.reportStudioCompatibility = {
  targetDshVersion,
  sourcePackageVersion: manifest.version,
  generatedBy: 'tools/openpencil-runtime-smoke/build-openpencil-compat.mjs',
}
await writeFile(manifestPath, `${JSON.stringify(patched, null, 2)}\n`, 'utf8')
console.log(`OPENPENCIL_COMPAT_PACKAGE_READY=${output}`)
console.log(`source-version=${manifest.version}`)
console.log(`compat-version=${patched.version}`)
console.log(`target-dsh=${targetDshVersion}`)
