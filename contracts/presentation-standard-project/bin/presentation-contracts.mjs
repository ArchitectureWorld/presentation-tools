#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { createProjectDirectoryPlan, STANDARD_VERSION, validateDocumentWithAjv, validateProjectDirectoryWithAjv } from '../src/index.mjs'

const [command, ...args] = process.argv.slice(2)
function option(name) { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : null }

if (command === 'version') {
  console.log(STANDARD_VERSION)
} else if (command === 'plan') {
  const name = option('--name'); const projectSlug = option('--slug')
  if (!name || !projectSlug) throw new Error('plan requires --name and --slug')
  console.log(JSON.stringify(createProjectDirectoryPlan({ name, projectSlug, language: option('--language') ?? 'und' }), null, 2))
} else if (command === 'validate') {
  const projectRoot = args[0]
  if (!projectRoot) throw new Error('validate requires a project directory')
  const result = await validateProjectDirectoryWithAjv(projectRoot)
  console.log(JSON.stringify(result, null, 2)); if (!result.valid) process.exitCode = 1
} else if (command === 'validate-document') {
  const [documentType, file] = args
  if (!documentType || !file) throw new Error('validate-document requires a document type and JSON file')
  const document = JSON.parse(await readFile(file, 'utf8'))
  const result = await validateDocumentWithAjv(documentType, document)
  console.log(JSON.stringify(result, null, 2)); if (!result.valid) process.exitCode = 1
} else {
  console.error('Usage: presentation-contracts <version|plan|validate|validate-document>')
  process.exitCode = 2
}
