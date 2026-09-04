import test from 'node:test'
import assert from 'node:assert/strict'
import { sourceRefKey } from '../studio-layout-contracts/index.mjs'
import {
  LayoutSourceContractError,
  buildLayoutSourceIndex,
  buildLayoutSourceProjection,
} from './index.mjs'

const IDS = Object.freeze({
  project: 'project_01992a80-0000-7000-8000-000000000001',
  projectRules: 'project_rules_01992a80-0000-7000-8000-000000000002',
  outlineDocument: 'outline_01992a80-0000-7000-8000-000000000003',
  outlineNode: 'outline_node_01992a80-0000-7000-8000-000000000004',
  page: 'page_01992a80-0000-7000-8000-000000000005',
  draft: 'draft_page_01992a80-0000-7000-8000-000000000006',
  title: 'content_block_01992a80-0000-7000-8000-000000000007',
  list: 'content_block_01992a80-0000-7000-8000-000000000008',
  listItemA: 'list_item_01992a80-0000-7000-8000-000000000009',
  listItemB: 'list_item_01992a80-0000-7000-8000-000000000010',
  metrics: 'content_block_01992a80-0000-7000-8000-000000000011',
  metric: 'metric_01992a80-0000-7000-8000-000000000012',
  table: 'content_block_01992a80-0000-7000-8000-000000000013',
  tableColumn: 'table_column_01992a80-0000-7000-8000-000000000014',
  tableRow: 'table_row_01992a80-0000-7000-8000-000000000015',
  tableCell: 'table_cell_01992a80-0000-7000-8000-000000000016',
  script: 'script_block_01992a80-0000-7000-8000-000000000017',
  pageAsset: 'page_asset_01992a80-0000-7000-8000-000000000018',
  asset: 'asset_01992a80-0000-7000-8000-000000000019',
})

function canonicalSnapshot() {
  return {
    project: {
      id: IDS.project,
      projectId: IDS.project,
      projectRulesId: IDS.projectRules,
      outlineDocumentId: IDS.outlineDocument,
      title: '排版接口收口项目',
      createdAt: '2026-09-04T00:00:00.000Z',
    },
    outline: [
      {
        id: IDS.outlineNode,
        outlineNodeId: IDS.outlineNode,
        parentOutlineNodeId: null,
        title: '第一章',
        order: 0,
        sourceRefs: [],
        opaqueExtension: null,
        children: [],
      },
    ],
    pages: [
      {
        id: IDS.page,
        pageId: IDS.page,
        outlineNodeId: IDS.outlineNode,
        draftDocumentId: IDS.draft,
        titleBlockId: IDS.title,
        order: 0,
        contentBlocks: [
          {
            contentBlockId: IDS.title,
            type: 'heading',
            role: 'page_title',
            order: 0,
            content: '从草案语义到可控排版',
            sourceRefs: [],
          },
          {
            contentBlockId: IDS.list,
            type: 'list',
            role: 'body',
            order: 1,
            listStyle: 'unordered',
            items: [
              { listItemId: IDS.listItemA, content: '语义内容保持稳定身份', order: 0, sourceRefs: [] },
              { listItemId: IDS.listItemB, content: '排版几何独立演进', order: 1, sourceRefs: [] },
            ],
            sourceRefs: [],
          },
          {
            contentBlockId: IDS.metrics,
            type: 'metric_group',
            role: 'key_message',
            order: 2,
            metrics: [
              { metricId: IDS.metric, label: '画布比例', value: '16:9', unit: null, note: '默认值', order: 0, sourceRefs: [] },
            ],
            sourceRefs: [],
          },
          {
            contentBlockId: IDS.table,
            type: 'table',
            role: 'body',
            order: 3,
            columns: [
              { tableColumnId: IDS.tableColumn, label: '能力', order: 0 },
            ],
            rows: [
              {
                tableRowId: IDS.tableRow,
                label: '第一行',
                order: 0,
                cells: [
                  { tableCellId: IDS.tableCell, tableColumnId: IDS.tableColumn, content: '稳定来源索引', sourceRefs: [] },
                ],
                sourceRefs: [],
              },
            ],
            sourceRefs: [],
          },
        ],
        scriptBlocks: [
          {
            scriptBlockId: IDS.script,
            order: 0,
            content: '本页说明草案身份如何映射为排版来源。',
            estimatedDurationSeconds: 12,
            referencedContentBlockIds: [IDS.title],
            referencedAssetIds: [IDS.asset],
            sourceRefs: [],
          },
        ],
        pageAssets: [
          {
            pageAssetId: IDS.pageAsset,
            assetId: IDS.asset,
            role: 'primary',
            order: 0,
            caption: '空间关系图',
            sourceRefs: [],
          },
        ],
      },
    ],
  }
}

function resolvedAssets() {
  return [
    {
      pageAssetId: IDS.pageAsset,
      assetId: IDS.asset,
      objectRef: {
        sha256: 'a'.repeat(64),
        sizeBytes: 2048,
        mimeType: 'image/png',
      },
      metadata: { widthPx: 1600, heightPx: 900 },
      dataUrl: 'data:image/png;base64,FORBIDDEN',
      dataBase64: 'FORBIDDEN',
      migration: { private: true },
      ui: { selected: true },
    },
  ]
}

function sourceInput(overrides = {}) {
  return {
    snapshot: canonicalSnapshot(),
    pageId: IDS.page,
    projectRevision: 42,
    sourceStateHash: 'b'.repeat(64),
    resolvedPageAssets: resolvedAssets(),
    ...overrides,
  }
}

function expectCode(code) {
  return error => error instanceof LayoutSourceContractError && error.code === code
}

test('snapshot-aware projection carries one Contract project identity into layout sources', () => {
  const input = sourceInput()
  const projection = buildLayoutSourceProjection(input)

  assert.equal(projection.projectId, IDS.project)
  assert.equal(projection.pageId, IDS.page)
  assert.equal(projection.draftDocumentId, IDS.draft)
  assert.equal(projection.projectRevision, 42)
  assert.equal(projection.sourceStateHash, 'b'.repeat(64))
  assert.equal(Object.hasOwn(input.snapshot.pages[0], 'projectId'), false, 'Canonical Page must not duplicate projectId')
  assert.deepEqual(buildLayoutSourceIndex(input), projection.sources)
})

test('buildLayoutSourceProjection projects every supported stable source identity', () => {
  const { sources } = buildLayoutSourceProjection(sourceInput())

  assert.deepEqual(Object.keys(sources).sort(), [
    `content-block:${IDS.list}`,
    `content-block:${IDS.metrics}`,
    `content-block:${IDS.table}`,
    `content-block:${IDS.title}`,
    `content-item:${IDS.list}:list-item:${IDS.listItemA}`,
    `content-item:${IDS.list}:list-item:${IDS.listItemB}`,
    `content-item:${IDS.metrics}:metric:${IDS.metric}`,
    `content-item:${IDS.table}:table-cell:${IDS.tableCell}`,
    `page-asset:${IDS.pageAsset}`,
    `script-block:${IDS.script}`,
  ])

  assert.deepEqual(sources[sourceRefKey({ kind: 'content-block', contentBlockId: IDS.title })], {
    kind: 'text',
    sourceType: 'heading',
    role: 'page_title',
    order: 0,
    content: '从草案语义到可控排版',
    sourceRefs: [],
  })
  assert.equal(sources[sourceRefKey({ kind: 'content-item', contentBlockId: IDS.list, itemKind: 'list-item', itemId: IDS.listItemB })].content, '排版几何独立演进')
  assert.equal(sources[sourceRefKey({ kind: 'content-item', contentBlockId: IDS.metrics, itemKind: 'metric', itemId: IDS.metric })].value, '16:9')
  assert.equal(sources[sourceRefKey({ kind: 'content-item', contentBlockId: IDS.table, itemKind: 'table-cell', itemId: IDS.tableCell })].tableRowId, IDS.tableRow)
  assert.equal(sources[sourceRefKey({ kind: 'script-block', scriptBlockId: IDS.script })].estimatedDurationSeconds, 12)
  assert.deepEqual(sources[sourceRefKey({ kind: 'page-asset', pageAssetId: IDS.pageAsset })].objectRef, resolvedAssets()[0].objectRef)
})

test('layout source projection excludes binary payloads and private runtime state', () => {
  const serialized = JSON.stringify(buildLayoutSourceProjection(sourceInput()))
  for (const forbidden of ['dataUrl', 'dataBase64', 'FORBIDDEN', 'migration', 'ui']) {
    assert.equal(serialized.includes(forbidden), false, `source projection leaked ${forbidden}`)
  }
})

test('caller cannot override the Contract project identity selected from Canonical Snapshot', () => {
  assert.throws(
    () => buildLayoutSourceProjection(sourceInput({ projectId: 'project_01992a80-0000-7000-8000-999999999999' })),
    expectCode('layout_source_project_id_override_forbidden'),
  )
})

test('draft-only legacy API input fails instead of guessing a project identity', () => {
  assert.throws(
    () => buildLayoutSourceIndex(canonicalSnapshot().pages[0], resolvedAssets()),
    expectCode('layout_source_snapshot_required'),
  )
})

test('missing page and invalid snapshot are rejected explicitly', () => {
  assert.throws(
    () => buildLayoutSourceProjection(sourceInput({ pageId: 'page_01992a80-0000-7000-8000-999999999999' })),
    expectCode('layout_source_page_missing'),
  )
  assert.throws(
    () => buildLayoutSourceProjection({ snapshot: { project: {}, pages: [] }, pageId: IDS.page, projectRevision: 0 }),
    expectCode('layout_source_invalid_snapshot'),
  )
})

test('duplicate stable identities are rejected before building an ambiguous index', () => {
  const input = sourceInput()
  input.snapshot.pages[0].contentBlocks[1].items.push({
    listItemId: IDS.listItemA,
    content: '重复身份',
    order: 2,
    sourceRefs: [],
  })
  assert.throws(
    () => buildLayoutSourceProjection(input),
    expectCode('layout_source_invalid_snapshot'),
  )
})

test('missing resolved PageAsset content is rejected', () => {
  assert.throws(
    () => buildLayoutSourceProjection(sourceInput({ resolvedPageAssets: [] })),
    expectCode('layout_source_reference_missing'),
  )
})

test('script references to missing content or assets are rejected by Canonical validation', () => {
  const missingContent = sourceInput()
  missingContent.snapshot.pages[0].scriptBlocks[0].referencedContentBlockIds = ['content_block_01992a80-0000-7000-8000-999999999999']
  assert.throws(
    () => buildLayoutSourceProjection(missingContent),
    expectCode('layout_source_invalid_snapshot'),
  )

  const missingAsset = sourceInput()
  missingAsset.snapshot.pages[0].scriptBlocks[0].referencedAssetIds = ['asset_01992a80-0000-7000-8000-999999999999']
  assert.throws(
    () => buildLayoutSourceProjection(missingAsset),
    expectCode('layout_source_invalid_snapshot'),
  )
})

test('resolved assets require ObjectRef-backed bytes and matching identities', () => {
  const missingObject = resolvedAssets()
  delete missingObject[0].objectRef
  assert.throws(
    () => buildLayoutSourceProjection(sourceInput({ resolvedPageAssets: missingObject })),
    expectCode('layout_source_object_ref_required'),
  )

  const mismatched = resolvedAssets()
  mismatched[0].assetId = 'asset_01992a80-0000-7000-8000-999999999999'
  assert.throws(
    () => buildLayoutSourceProjection(sourceInput({ resolvedPageAssets: mismatched })),
    expectCode('layout_source_reference_mismatch'),
  )
})
