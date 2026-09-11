/** Project-wide rules, excluding mutable inventories and other pages' source snapshots. */
export function projectRuleDependencies(project){
 const {extensionPayload,...identity}=project
 if(!extensionPayload)return identity
 const {standardArchive,...extensions}=extensionPayload
 if(!standardArchive)return {...identity,extensionPayload:extensions}
 const ignored=new Set(['assets/manifest.json','source-materials/manifest.json','outline.json','pages/manifest.json'])
 const documents=Object.fromEntries(Object.entries(standardArchive.documents??{}).filter(([path])=>!ignored.has(path)&&!path.startsWith('pages/drafts/')))
 return {...identity,extensionPayload:extensions,documents}
}
/** Changing an unrelated image inventory must not stale every page in an unattended batch.
 * Common source materials stay conservative dependencies until upstream supplies narrower evidence bindings.
 */
export function pageProjectDependencies(project,page){
 const archive=project.extensionPayload?.standardArchive
 if(!archive)return projectRuleDependencies(project)
 const ids=new Set((page.pageAssets??[]).map(a=>a.assetId))
 for(const script of page.scriptBlocks??[])for(const id of script.referencedAssetIds??[])ids.add(id)
 const records=archive.documents?.['assets/manifest.json']?.assets??[]
 let grew=true
 while(grew){grew=false;for(const record of records)if(ids.has(record.assetId))for(const parent of record.origin?.parentAssetIds??[])if(!ids.has(parent)){ids.add(parent);grew=true}}
 const assets=records.filter(a=>ids.has(a.assetId)),materials=archive.documents?.['source-materials/manifest.json']??null
 const paths=new Set([...assets.map(a=>a.relativePath),...(materials?.materials??[]).map(m=>m.relativePath)])
 const nodes=archive.documents?.['outline.json']?.nodes??[],nodeIds=new Set();let current=page.outlineNodeId??page.sourceOutlineNodeId
 while(current&&!nodeIds.has(current)){nodeIds.add(current);current=nodes.find(n=>n.outlineNodeId===current)?.parentOutlineNodeId}
 return {rules:projectRuleDependencies(project),assetIds:[...ids].sort(),assets,materials,files:(archive.files??[]).filter(f=>paths.has(f.relativePath)),outline:nodes.filter(n=>nodeIds.has(n.outlineNodeId))}
}
