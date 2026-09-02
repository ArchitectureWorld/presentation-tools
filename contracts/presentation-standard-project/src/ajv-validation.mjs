
import { SCHEMA_IDS } from './constants.mjs'
import { ERROR_CODES } from './errors.mjs'
import { loadSchemas } from './schemas.mjs'
import { validateProjectDirectory } from './validator.mjs'

export async function createAjvDocumentValidator(root) {
  let Ajv2020, addFormats
  try {
    ;({ default: Ajv2020 } = await import('ajv/dist/2020.js'))
    ;({ default: addFormats } = await import('ajv-formats'))
  } catch (error) {
    const wrapped = new Error('Ajv 8 and ajv-formats are required for JSON Schema validation')
    wrapped.code = ERROR_CODES.SCHEMA_VALIDATOR_UNAVAILABLE
    wrapped.cause = error
    throw wrapped
  }
  const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true, validateFormats: true })
  addFormats(ajv)
  for (const schema of await loadSchemas(root)) ajv.addSchema(schema)
  const validators = new Map(Object.entries(SCHEMA_IDS).map(([type, id]) => [type, ajv.getSchema(id)]))
  return async (documentType, document) => {
    const validate = validators.get(documentType)
    if (!validate) return { valid: false, errors: [{ instancePath: '', message: `Unknown documentType ${documentType}` }] }
    const valid = validate(document)
    return { valid: Boolean(valid), errors: valid ? [] : structuredClone(validate.errors ?? []) }
  }
}

export async function validateDocumentWithAjv(documentType, document, options = {}) {
  const validator = await createAjvDocumentValidator(options.schemaRoot)
  return validator(documentType, document)
}

export async function validateProjectDirectoryWithAjv(projectRoot, options = {}) {
  const documentValidator = await createAjvDocumentValidator(options.schemaRoot)
  return validateProjectDirectory(projectRoot, { ...options, documentValidator })
}
