import test from 'node:test'
import assert from 'node:assert/strict'
import { sourceRefKey } from '../studio-layout-contracts/index.mjs'
import {
  LayoutSourceContractError,
  buildLayoutSourceIndex,
} from './index.mjs'

function canonicalDraft() {
  return {
    draftDocumentId: 'draft_document_fixture',
    projectId: 'project_fixture',
    pageId: 'page_fixture',
    contentBlocks: [
      {
        contentBlockId: 'content_block_title',
        type: 'heading',
        role: 'page_title',
        order: 0,
        content: '从草案语义到可控排版',
        sourceRefs: [],
      },
      {
        contentBlockId: 'content_block_list',
        type: 'list',
        role: 'body',
        order: 1,
        listStyle: 'unordered',
        items: [
          { listItemId: 'list_item_a', content: '语义内容保持稳定身份', order: 0, sourceRefs: [] },
          { listItemId: 'list_item_b', content: '排版几何独立演进', order: 1, sourceRefs: [] },
        ],
        sourceRefs: [],
      },
      {
        contentBlockId: 'content_block_metrics',
        type: 'metric_group',
        role: 'key_message',
        order: 2,
        metrics: [
          { metricId: 'metric_a', label: '画布比例', value: '16:9', unit: null, note: '默认值', order: 0, sourceRefs: [] },
        ],
        sourceRefs: [],
      },
      {
        contentBlockId: 'content_block_table',
        type: 'table',
        role: 'body',
        order: 3,
        columns: [
          { tableColumnId: 'table_column_a', label: '能力', order: 0 },
        ],
        rows: [
          {
            tableRowId: 'table_row_a',
            label: '第一行',
            order: 0,
            cells: [
              { tableCellId: 'table_cell_a', tableColumnId: 'table_column_a', content: '稳定来源索引', sourceRefs: [] },
            ],
            sourceRefs: [],
          },
        ],
        sourceRefs: [],
      },
    ],
    scriptBlocks: [
      {
        scriptBlockId: 'script_block_intro',
        order: 0,
        content: '本页说明草案身份如何映射为排版来源。',
        estimatedDurationSeconds: 12,
        referencedContentBlockIds: ['content_block_title'],
        referencedAssetIds: ['asset_hero'],
        sourceRefs: [],
      },
    ],
    pageAssets: [
      {
        pageAssetId: 'page_asset_hero',
        assetId: 'asset_hero',
        role: 'primary',
        order: 0,
        caption: '空间关系图',
        sourceRefs: [],
      },
    ],
  }
}

function resolvedAssets() {
  return [
    {
      pageAssetId: 'page_asset_hero',
      assetId: 'asset_hero',
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

function expectCode(code) {
  return error => error instanceof LayoutSourceContractError && error.code === code
}

test('buildLayoutSourceIndex projects every supported stable source identity', () => {
  const index = buildLayoutSourceIndex(canonicalDraft(), resolvedAssets())

  assert.deepEqual(Object.keys(index).sort(), [
    'content-block:content_block_list',
    'content-block:content_block_metrics',
    'content-block:content_block_table',
    'content-block:content_block_title',
    'content-item:content_block_list:list-item:list_item_a',
    'content-item:content_block_list:list-item:list_item_b',
    'content-item:content_block_metrics:metric:metric_a',
    'content-item:content_block_table:table-cell:table_cell_a',
    'page-asset:page_asset_hero',
    'script-block:script_block_intro',
  ])

  assert.deepEqual(index[sourceRefKey({ kind: 'content-block', contentBlockId: 'content_block_title' })], {
    kind: 'text',
    sourceType: 'heading',
    role: 'page_title',
    order: 0,
    content: '从草案语义到可控排版',
    sourceRefs: [],
  })
  assert.equal(index[sourceRefKey({ kind: 'content-item', contentBlockId: 'content_block_list', itemKind: 'list-item', itemId: 'list_item_b' })].content, '排版几何独立演进')
  assert.equal(index[sourceRefKey({ kind: 'content-item', contentBlockId: 'content_block_metrics', itemKind: 'metric', itemId: 'metric_a' })].value, '16:9')
  assert.equal(index[sourceRefKey({ kind: 'content-item', contentBlockId: 'content_block_table', itemKind: 'table-cell', itemId: 'table_cell_a' })].tableRowId, 'table_row_a')
  assert.equal(index[sourceRefKey({ kind: 'script-block', scriptBlockId: 'script_block_intro' })].estimatedDurationSeconds, 12)
  assert.deepEqual(index[sourceRefKey({ kind: 'page-asset', pageAssetId: 'page_asset_hero' })].objectRef, resolvedAssets()[0].objectRef)
})

test('layout source projection excludes binary payloads and private runtime state', () => {
  const serialized = JSON.stringify(buildLayoutSourceIndex(canonicalDraft(), resolvedAssets()))
  for (const forbidden of ['dataUrl', 'dataBase64', 'FORBIDDEN', 'migration', 'ui']) {
    assert.equal(serialized.includes(forbidden), false, `source index leaked ${forbidden}`)
  }
})

test('legacy simplified pages fail explicitly instead of being guessed', () => {
  assert.throws(
    () => buildLayoutSourceIndex({
      id: 'page_legacy',
      heading: '旧标题',
      body: '旧正文',
      bullets: ['旧要点'],
      script: '旧讲解稿',
      assets: [],
    }, []),
    expectCode('layout_source_contract_unavailable'),
  )
})

test('duplicate stable identities are rejected before building an ambiguous index', () => {
  const draft = canonicalDraft()
  draft.contentBlocks[1].items.push({
    listItemId: 'list_item_a',
    content: '重复身份',
    order: 2,
    sourceRefs: [],
  })
  assert.throws(
    () => buildLayoutSourceIndex(draft, resolvedAssets()),
    expectCode('layout_source_duplicate_identity'),
  )
})

test('missing resolved PageAsset content is rejected', () => {
  assert.throws(
    () => buildLayoutSourceIndex(canonicalDraft(), []),
    expectCode('layout_source_reference_missing'),
  )
})

test('script references to missing content or assets are rejected', () => {
  const missingContent = canonicalDraft()
  missingContent.scriptBlocks[0].referencedContentBlockIds = ['content_block_missing']
  assert.throws(
    () => buildLayoutSourceIndex(missingContent, resolvedAssets()),
    expectCode('layout_source_reference_missing'),
  )

  const missingAsset = canonicalDraft()
  missingAsset.scriptBlocks[0].referencedAssetIds = ['asset_missing']
  assert.throws(
    () => buildLayoutSourceIndex(missingAsset, resolvedAssets()),
    expectCode('layout_source_reference_missing'),
  )
})

test('resolved assets require ObjectRef-backed bytes and matching identities', () => {
  const missingObject = resolvedAssets()
  delete missingObject[0].objectRef
  assert.throws(
    () => buildLayoutSourceIndex(canonicalDraft(), missingObject),
    expectCode('layout_source_object_ref_required'),
  )

  const mismatched = resolvedAssets()
  mismatched[0].assetId = 'asset_other'
  assert.throws(
    () => buildLayoutSourceIndex(canonicalDraft(), mismatched),
    expectCode('layout_source_reference_mismatch'),
  )
})
