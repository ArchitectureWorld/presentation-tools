
export const STANDARD_NAME = 'Presentation Standard Project Directory'
export const STANDARD_VERSION = '0.1.0'
export const PACKAGE_NAME = '@architectureworld/presentation-contracts'
export const SCHEMA_BASE_URI = `https://contracts.architecture.world/presentation-standard-project/${STANDARD_VERSION}`
export const COMMON_SCHEMA_ID = `${SCHEMA_BASE_URI}/common.schema.json`

export const SCHEMA_IDS = Object.freeze({
  ProjectManifest: `${SCHEMA_BASE_URI}/project-manifest.schema.json`,
  ProjectRulesDocument: `${SCHEMA_BASE_URI}/project-rules-document.schema.json`,
  OutlineDocument: `${SCHEMA_BASE_URI}/outline-document.schema.json`,
  PageManifest: `${SCHEMA_BASE_URI}/page-manifest.schema.json`,
  DraftPageDocument: `${SCHEMA_BASE_URI}/draft-page-document.schema.json`,
  SourceMaterialManifest: `${SCHEMA_BASE_URI}/source-material-manifest.schema.json`,
  AssetManifest: `${SCHEMA_BASE_URI}/asset-manifest.schema.json`,
})

export const ID_PREFIXES = Object.freeze({
  project: 'project',
  projectRules: 'project_rules',
  outlineDocument: 'outline',
  outlineNode: 'outline_node',
  page: 'page',
  draftDocument: 'draft_page',
  contentBlock: 'content_block',
  listItem: 'list_item',
  metric: 'metric',
  tableRow: 'table_row',
  tableColumn: 'table_column',
  tableCell: 'table_cell',
  scriptBlock: 'script_block',
  pageAsset: 'page_asset',
  sourceMaterial: 'source_material',
  asset: 'asset',
})

export const REQUIRED_FILES = Object.freeze([
  'project.json', 'rules.json', 'outline.json', 'pages/manifest.json',
  'source-materials/manifest.json', 'assets/manifest.json',
])

export const REQUIRED_DIRECTORIES = Object.freeze([
  'pages', 'pages/drafts',
  'source-materials', 'source-materials/documents', 'source-materials/drawings',
  'source-materials/images', 'source-materials/videos', 'source-materials/data',
  'source-materials/models', 'source-materials/other',
  'assets', 'assets/images', 'assets/videos', 'assets/charts',
  'assets/diagrams', 'assets/audio', 'assets/other', 'layouts',
])

export const SOURCE_CATEGORY_DIRECTORIES = Object.freeze({
  document: 'source-materials/documents', drawing: 'source-materials/drawings',
  image: 'source-materials/images', video: 'source-materials/videos',
  data: 'source-materials/data', model: 'source-materials/models', other: 'source-materials/other',
})

export const ASSET_CATEGORY_DIRECTORIES = Object.freeze({
  image: 'assets/images', video: 'assets/videos', chart: 'assets/charts',
  diagram: 'assets/diagrams', audio: 'assets/audio', other: 'assets/other',
})
