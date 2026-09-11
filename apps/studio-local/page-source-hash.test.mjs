import test from 'node:test'
import assert from 'node:assert/strict'
import {fixture,applyCandidate} from '../../test-support/design-fixture.mjs'
import {createDesignProtectionService} from './design-protection.mjs'
import {createStudioId} from '../../packages/studio-contracts/index.mjs'
const appendUnlinkedAsset=state=>{const archive=state.project.extensionPayload.standardArchive,asset=structuredClone(archive.documents['assets/manifest.json'].assets[0]);asset.assetId=createStudioId('asset');asset.relativePath='assets/charts/unrelated.svg';archive.documents['assets/manifest.json'].assets.push(asset);const old=archive.files.find(f=>f.relativePath.endsWith('.svg'));archive.files.push({...structuredClone(old),relativePath:asset.relativePath});return state}
test('adding an unrelated registered visual does not invalidate already-designed pages',async t=>{
 const fx=await fixture();t.after(()=>fx.close());const first=await fx.service.context({sessionId:fx.sessionId,pageId:fx.pageId})
 await fx.repository.transactContent({baseRevision:0,source:'human'},appendUnlinkedAsset)
 const after=await fx.service.context({sessionId:fx.sessionId,pageId:fx.pageId});assert.equal(after.sourceStateHash,first.sourceStateHash)
})
test('a locked element does not stop independent asset catalog growth elsewhere',async t=>{
 const fx=await fixture();t.after(()=>fx.close());const run=await fx.start({allowApply:true}),input=await fx.input(run);await applyCandidate(fx,await fx.service.prepare(input))
 await createDesignProtectionService({repository:fx.repository,layoutService:fx.layoutService}).update({pageId:fx.pageId,baseRevision:fx.repository.getState().project.currentRevision,expectedProtectionRevision:0,elementId:input.layout.elements[0].layoutElementId,locked:true})
 await fx.repository.transactContent({baseRevision:fx.repository.getState().project.currentRevision,source:'host-design'},appendUnlinkedAsset)
 assert.equal(fx.repository.getState().project.extensionPayload.standardArchive.documents['assets/manifest.json'].assets.length,2)
})
