import assert from 'node:assert/strict'
import {
  addDetachedLayoutElement,
  addLiveLayoutElement,
  createLayoutPage,
  createLayoutRenderPlan,
  markLayoutDraftAdvanced,
  reconcileLayoutSources,
} from '../packages/studio-layout-core/index.mjs'
import { sourceRefKey } from '../packages/studio-layout-contracts/index.mjs'

const titleRef = { kind: 'content-block', contentBlockId: 'content_block_title_001' }
let layout = createLayoutPage({ projectId: 'project_001', pageId: 'page_001', baseDraftRevision: 18 })
layout = addLiveLayoutElement(layout, {
  type: 'text',
  sourceRef: titleRef,
  frame: { x: 96, y: 72, width: 720, height: 96, rotation: 0 },
  style: { fontSize: 52, fontWeight: 700 },
  zIndex: 10,
})
layout = addDetachedLayoutElement(layout, {
  type: 'shape',
  localPayload: { shape: 'line', strokeWidth: 2 },
  frame: { x: 96, y: 190, width: 520, height: 2, rotation: 0 },
  style: { opacity: 0.4 },
  zIndex: 2,
})

const geometry = structuredClone(layout.elements.map(element => element.frame))
layout = markLayoutDraftAdvanced(layout, 19)
assert.equal(layout.syncState, 'stale')
layout = reconcileLayoutSources(layout, {
  [sourceRefKey(titleRef)]: { kind: 'text', text: '排版基础已经建立' },
}, 19)
assert.equal(layout.syncState, 'synced')
assert.deepEqual(layout.elements.map(element => element.frame), geometry)
const plan = createLayoutRenderPlan(layout, {
  [sourceRefKey(titleRef)]: { kind: 'text', text: '排版基础已经建立' },
})
assert.equal(plan.elements.find(element => element.type === 'text').payload.text, '排版基础已经建立')
assert.deepEqual(plan.elements.find(element => element.type === 'shape').payload, { shape: 'line', strokeWidth: 2 })

console.log('REPORT_STUDIO_LAYOUT_V0_2_0_FOUNDATION_PASS')
console.log(`layoutPageId=${layout.layoutPageId}`)
console.log(`elements=${layout.elements.length}`)
console.log(`draftRevision=${layout.lastSyncedDraftRevision}`)
