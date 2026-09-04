
export type StandardVersion = '0.1.0'
export type DateTimeString = string
export type Sha256 = string
export type RelativePath = string
export type SourceRevision = number | string
export type ContentNature = 'fact' | 'user_statement' | 'professional_judgement' | 'assumption' | 'recommendation' | 'decision' | 'missing'
export type ProjectId = `project_${string}`
export type ProjectRulesId = `project_rules_${string}`
export type OutlineDocumentId = `outline_${string}`
export type OutlineNodeId = `outline_node_${string}`
export type PageId = `page_${string}`
export type DraftDocumentId = `draft_page_${string}`
export type ContentBlockId = `content_block_${string}`
export type ListItemId = `list_item_${string}`
export type MetricId = `metric_${string}`
export type TableRowId = `table_row_${string}`
export type TableColumnId = `table_column_${string}`
export type TableCellId = `table_cell_${string}`
export type ScriptBlockId = `script_block_${string}`
export type PageAssetId = `page_asset_${string}`
export type SourceMaterialId = `source_material_${string}`
export type AssetId = `asset_${string}`

export interface SourceRef { provider: string; sourceProjectId: string; sourceRevision: SourceRevision; objectIds: string[]; evidenceIds: string[]; sourceSnapshotSha256?: Sha256 }
export interface CreatedBy { provider: string; sourceProjectId: string | null; actorId: string | null }
export interface ProjectManifest { $schema: string; documentType: 'ProjectManifest'; standardVersion: StandardVersion; projectId: ProjectId; name: string; projectSlug: string; defaultCanvasPreset: '16:9'|'4:3'|'A4-landscape'|'A4-portrait'; projectRulesId: ProjectRulesId; createdAt: DateTimeString; createdBy: CreatedBy }
export interface ProjectRulesDocument { $schema: string; documentType: 'ProjectRulesDocument'; standardVersion: StandardVersion; projectRulesId: ProjectRulesId; projectId: ProjectId; audiences: string[]; purposes: string[]; language: string; writingRules: string[]; terminology: Record<string,string>; truthConstraints: string[]; visualIntent: string[]; prohibitedContent?: string[] }
export interface OutlineNode { outlineNodeId: OutlineNodeId; parentOutlineNodeId: OutlineNodeId|null; kind: 'chapter'|'section'; title: string; summary: string; order: number; sourceRefs?: SourceRef[] }
export interface OutlineDocument { $schema: string; documentType: 'OutlineDocument'; standardVersion: StandardVersion; outlineDocumentId: OutlineDocumentId; projectId: ProjectId; nodes: OutlineNode[] }
export interface PageRecord { pageId: PageId; outlineNodeId: OutlineNodeId|null; order: number; titleBlockId: ContentBlockId|null; draftPath: RelativePath|null; sourceRefs?: SourceRef[] }
export interface PageManifest { $schema: string; documentType: 'PageManifest'; standardVersion: StandardVersion; projectId: ProjectId; pages: PageRecord[] }

export interface ContentBlockBase { contentBlockId: ContentBlockId; order: number; sourceRefs?: SourceRef[] }
export interface HeadingContentBlock extends ContentBlockBase { type: 'heading'; role: 'page_title'|'subtitle'|'section_title'; content: string }
export interface TextContentBlock extends ContentBlockBase { type: 'text'; role: 'key_message'|'body'|'caption'|'source_note'; content: string; contentNature?: ContentNature }
export interface ListItem { listItemId: ListItemId; order?: number; content: string; contentNature?: ContentNature; sourceRefs?: SourceRef[] }
export interface ListContentBlock extends ContentBlockBase { type: 'list'; role: 'key_message'|'body'; listStyle: 'ordered'|'unordered'; items: ListItem[] }
export interface MetricRecord { metricId: MetricId; order?: number; label: string; value: string|number|boolean|null; unit: string|null; note: string|null; contentNature?: ContentNature; sourceRefs?: SourceRef[] }
export interface MetricGroupContentBlock extends ContentBlockBase { type: 'metric_group'; role: 'key_message'|'body'; metrics: MetricRecord[] }
export interface TableColumn { tableColumnId: TableColumnId; order: number; label: string }
export interface TableCell { tableCellId: TableCellId; tableColumnId: TableColumnId; content: string|number|boolean|null; contentNature?: ContentNature; sourceRefs?: SourceRef[] }
export interface TableRow { tableRowId: TableRowId; order: number; label?: string; cells: TableCell[]; sourceRefs?: SourceRef[] }
export interface TableContentBlock extends ContentBlockBase { type: 'table'; role: 'body'; columns: TableColumn[]; rows: TableRow[] }
export type DraftContentBlock = HeadingContentBlock|TextContentBlock|ListContentBlock|MetricGroupContentBlock|TableContentBlock
export interface ScriptBlock { scriptBlockId: ScriptBlockId; order: number; content: string; estimatedDurationSeconds?: number|null; referencedContentBlockIds?: ContentBlockId[]; referencedAssetIds?: AssetId[]; sourceRefs?: SourceRef[] }
export interface PageAssetReference { pageAssetId: PageAssetId; assetId: AssetId; role: 'primary'|'supporting'|'background'|'reference'; order: number; caption?: string; sourceRefs?: SourceRef[] }
export interface DraftPageDocument { $schema: string; documentType: 'DraftPageDocument'; standardVersion: StandardVersion; draftDocumentId: DraftDocumentId; projectId: ProjectId; pageId: PageId; contentBlocks: DraftContentBlock[]; scriptBlocks: ScriptBlock[]; pageAssets: PageAssetReference[] }

export type SourceMaterialCategory = 'document'|'drawing'|'image'|'video'|'data'|'model'|'other'
export interface SourceMaterialRecord { sourceMaterialId: SourceMaterialId; originalFileName: string; alternateOriginalFileNames?: string[]; category: SourceMaterialCategory; relativePath: RelativePath; mimeType: string; sizeBytes: number; sha256: Sha256; importedAt: DateTimeString; status: 'available'|'archived'|'missing'|'quarantined' }
export interface SourceMaterialManifest { $schema: string; documentType: 'SourceMaterialManifest'; standardVersion: StandardVersion; projectId: ProjectId; materials: SourceMaterialRecord[] }
export interface AssetMetadata { widthPx?: number; heightPx?: number; durationMs?: number; pageCount?: number; rowCount?: number; columnCount?: number }
export interface SourceToolReference { name: string; version: string }
export interface AssetOrigin { type: 'source_material'|'derived_source_material'|'generated_by_plugin'|'generated_by_tool'|'human_added'; sourceMaterialIds: SourceMaterialId[]; parentAssetIds: AssetId[]; method: string; sourceTool: SourceToolReference|null }
export interface AssetRecord { assetId: AssetId; displayName: string; mediaType: 'image'|'video'|'audio'|'document'|'data'|'model'|'other'; category: 'image'|'video'|'chart'|'diagram'|'audio'|'other'; semanticRole: string; relativePath: RelativePath; mimeType: string; sizeBytes: number; sha256: Sha256; metadata: AssetMetadata; adoptionStatus: 'adopted'|'retired'; origin: AssetOrigin; sourceRefs?: SourceRef[]; createdAt: DateTimeString; adoptedAt: DateTimeString; retiredAt?: DateTimeString|null }
export interface AssetManifest { $schema: string; documentType: 'AssetManifest'; standardVersion: StandardVersion; projectId: ProjectId; assets: AssetRecord[] }
export type CanonicalDocument = ProjectManifest|ProjectRulesDocument|OutlineDocument|PageManifest|DraftPageDocument|SourceMaterialManifest|AssetManifest
export type DocumentType = CanonicalDocument['documentType']
export type StableIdKind = 'project'|'projectRules'|'outlineDocument'|'outlineNode'|'page'|'draftDocument'|'contentBlock'|'listItem'|'metric'|'tableRow'|'tableColumn'|'tableCell'|'scriptBlock'|'pageAsset'|'sourceMaterial'|'asset'
export interface ValidationIssue { code: string; severity: 'error'|'warning'; filePath: string; instancePath: string; message: string; details?: unknown }
export interface ProjectValidationResult { valid: boolean; standardVersion: StandardVersion; projectId: ProjectId|null; errors: ValidationIssue[]; warnings: ValidationIssue[]; checkedDocuments: number; checkedManagedFiles: number; schemaValidation: 'executed'|'semantic-only'|'requested' }
export interface ProjectDirectoryPlan { standardVersion: StandardVersion; projectId: ProjectId; directoryName: string; directories: string[]; documents: Record<string,CanonicalDocument> }
export const STANDARD_NAME: 'Presentation Standard Project Directory'
export const STANDARD_VERSION: StandardVersion
export const PACKAGE_NAME: '@architectureworld/presentation-contracts'
export const SCHEMA_BASE_URI: string
export const SCHEMA_IDS: Readonly<Record<DocumentType,string>>
export const ERROR_CODES: Readonly<Record<string,string>>
export function createUuidV7(options?: { now?: number; randomBytes?: (size:number)=>Uint8Array }): string
export function createStableId(kind: StableIdKind, options?: { now?: number; randomBytes?: (size:number)=>Uint8Array }): string
export function isStableId(kind: StableIdKind, value: unknown): boolean
export function normalizeProjectRelativePath(value: string): RelativePath
export function createMinimalProjectDocuments(input: { projectId?: ProjectId; projectSlug: string; name: string; language?: string; defaultCanvasPreset?: ProjectManifest['defaultCanvasPreset']; createdAt?: string; createdBy?: CreatedBy; ids?: { projectRulesId?: ProjectRulesId; outlineDocumentId?: OutlineDocumentId } }): Record<string,CanonicalDocument>
export function createProjectDirectoryPlan(input: Parameters<typeof createMinimalProjectDocuments>[0]): ProjectDirectoryPlan
export function loadSchemas(root?: string): Promise<Record<string,unknown>[]>
export function computeSchemaSetHash(root?: string): Promise<Sha256>
export function verifySchemaSetHash(root?: string): Promise<{valid:boolean;expectedSha256:Sha256;actualSha256:Sha256}>
export function validateDocumentWithAjv(documentType: DocumentType, document: CanonicalDocument, options?: { schemaRoot?: string }): Promise<{valid:boolean;errors:unknown[]}>
export function validateProjectDirectory(projectRoot: string, options?: {allowGitKeep?:boolean;documentValidator?:Function|null}): Promise<ProjectValidationResult>
export function validateProjectDirectoryWithAjv(projectRoot: string, options?: {allowGitKeep?:boolean;schemaRoot?:string}): Promise<ProjectValidationResult>
