import test from 'node:test'
import assert from 'node:assert/strict'
import {projectAssetCatalog, serveReferencedAsset} from './asset-service.mjs'

test('project asset catalog deduplicates page bindings and fails closed on inconsistent manifest refs',async()=>{
  const ref={sha256:'a'.repeat(64),sizeBytes:42,mimeType:'image/png'}
  const record={assetId:'registered',displayName:'diagram',relativePath:'assets/images/diagram.png',...ref,metadata:{widthPx:1,heightPx:1},sourceRefs:[]}
  const state={project:{extensionPayload:{standardArchive:{documents:{'assets/manifest.json':{assets:[record]}},files:[{relativePath:record.relativePath,objectRef:structuredClone(ref),...ref}]}}},pages:[{assets:[{id:'registered',objectRef:structuredClone(ref),...ref},{id:'legacy',objectRef:structuredClone(ref),...ref}],pageAssets:[{assetId:'legacy',objectRef:structuredClone(ref),...ref}]}]}
  assert.deepEqual(projectAssetCatalog(state).map(row=>row.id),['registered','legacy'])
  const pageFallback=structuredClone(state);pageFallback.project.extensionPayload.standardArchive.files=[]
  assert.deepEqual(projectAssetCatalog(pageFallback)[0].objectRef,ref)
  for(const damage of [
    archive=>{archive.documents['assets/manifest.json'].assets[0].sha256='b'.repeat(64)},
    archive=>{archive.documents['assets/manifest.json'].assets[0].sizeBytes=43},
    archive=>{archive.documents['assets/manifest.json'].assets[0].mimeType='image/jpeg'},
    archive=>{archive.files[0].sha256='c'.repeat(64)},
    archive=>{archive.files[0].objectRef=null},
    archive=>{archive.files.push(structuredClone(archive.files[0]))},
    archive=>{archive.documents['assets/manifest.json'].assets.push(structuredClone(record))},
  ]){
    const broken=structuredClone(state);damage(broken.project.extensionPayload.standardArchive)
    assert.equal(projectAssetCatalog(broken)[0].objectRef,null,'bad manifest must not silently use page fallback')
    await assert.rejects(serveReferencedAsset({repository:{getState:()=>broken,openBlob:()=>{throw new Error('must not open')}},assetId:'registered',response:{}}),/素材/)
  }
})
