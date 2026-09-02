
import { REQUIRED_DIRECTORIES, SCHEMA_IDS, STANDARD_VERSION } from './constants.mjs'
import { ERROR_CODES, PresentationContractError } from './errors.mjs'
import { createStableId, isStableId } from './ids.mjs'

export function createMinimalProjectDocuments(input = {}) {
  const {
    projectId = createStableId('project'), projectSlug, name,
    language = 'und', defaultCanvasPreset = '16:9',
    createdAt = new Date().toISOString(),
    createdBy = { provider: 'presentation-tools', sourceProjectId: null, actorId: null },
    ids = {},
  } = input
  if (!projectSlug || !name) throw new PresentationContractError(ERROR_CODES.INPUT_INVALID, 'projectSlug and name are required')
  if (!isStableId('project', projectId)) throw new PresentationContractError(ERROR_CODES.INPUT_INVALID, 'projectId must use the project_<UUIDv7> format')
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(projectSlug)) throw new PresentationContractError(ERROR_CODES.INPUT_INVALID, 'projectSlug must contain lowercase ASCII letters, digits, and internal hyphens only')
  const projectRulesId = ids.projectRulesId ?? createStableId('projectRules')
  const outlineDocumentId = ids.outlineDocumentId ?? createStableId('outlineDocument')
  if (!isStableId('projectRules', projectRulesId) || !isStableId('outlineDocument', outlineDocumentId)) {
    throw new PresentationContractError(ERROR_CODES.INPUT_INVALID, 'Injected document IDs do not match the stable ID contract')
  }
  return {
    'project.json': {
      $schema: SCHEMA_IDS.ProjectManifest, documentType: 'ProjectManifest', standardVersion: STANDARD_VERSION,
      projectId, name, projectSlug, defaultCanvasPreset, projectRulesId, createdAt,
      createdBy: { provider: createdBy.provider, sourceProjectId: createdBy.sourceProjectId ?? null, actorId: createdBy.actorId ?? null },
    },
    'rules.json': {
      $schema: SCHEMA_IDS.ProjectRulesDocument, documentType: 'ProjectRulesDocument', standardVersion: STANDARD_VERSION,
      projectRulesId, projectId, audiences: [], purposes: [], language, writingRules: [], terminology: {},
      truthConstraints: [], visualIntent: [], prohibitedContent: [],
    },
    'outline.json': {
      $schema: SCHEMA_IDS.OutlineDocument, documentType: 'OutlineDocument', standardVersion: STANDARD_VERSION,
      outlineDocumentId, projectId, nodes: [],
    },
    'pages/manifest.json': {
      $schema: SCHEMA_IDS.PageManifest, documentType: 'PageManifest', standardVersion: STANDARD_VERSION, projectId, pages: [],
    },
    'source-materials/manifest.json': {
      $schema: SCHEMA_IDS.SourceMaterialManifest, documentType: 'SourceMaterialManifest', standardVersion: STANDARD_VERSION, projectId, materials: [],
    },
    'assets/manifest.json': {
      $schema: SCHEMA_IDS.AssetManifest, documentType: 'AssetManifest', standardVersion: STANDARD_VERSION, projectId, assets: [],
    },
  }
}

export function createProjectDirectoryPlan(input = {}) {
  const documents = createMinimalProjectDocuments(input)
  const projectId = documents['project.json'].projectId
  const projectSlug = documents['project.json'].projectSlug
  return {
    standardVersion: STANDARD_VERSION,
    projectId,
    directoryName: `${projectId}-${projectSlug}`,
    directories: [...REQUIRED_DIRECTORIES],
    documents,
  }
}
