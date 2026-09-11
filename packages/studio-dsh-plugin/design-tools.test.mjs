import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Ajv from 'ajv'
import {Readable, Writable} from 'node:stream'
import {once} from 'node:events'
import {createStudioId} from '../studio-contracts/index.mjs'
import {ingestAsset, serveReferencedAsset} from '../../apps/studio-local/asset-service.mjs'
import { createStudioDshRuntime } from './lib/runtime.js'
import { readStandardProject } from '../studio-standard-adapter/index.mjs'
import { addLiveLayoutElement } from '../studio-layout-core/index.mjs'
const mod = await import('./lib/design-tools.js').catch(e => { if (e.code === 'ERR_MODULE_NOT_FOUND') return {}; throw e })
const standard = new URL('../../contracts/presentation-standard-project/examples/unformatted-project/project_01992a80-0000-7000-8000-000000000101-campus-renewal-brief/', import.meta.url)
async function fixture() {
  assert.equal(typeof mod.registerDesignTools, 'function', 'native design tools must be registered')
  const root = await mkdtemp(join(tmpdir(), 'native-design-'))
  const runtime = createStudioDshRuntime({ dataRoot: root })
  const repository = await runtime.repositoryFor('s1')
  const imported = await readStandardProject(standard, { putBlob: repository.putBlob })
  await repository.initializeFromStandardProject({ snapshot: imported.snapshot })
  const definitions = new Map()
  let modalities = ['image']; const images = []; const routes = []
  const ctx = { tools: { register: d => definitions.set(d.name, d) }, get: key => key === 'llm' ? { resolveModelInfo: async (...route) => { routes.push(route); return { inputModalities: modalities } } } : key === 'attachments' ? { saveImage: async ({data, mediaType, name}) => { const image = { attachmentId: 'attachment-test', mediaType, bytes: data.length, width: 1600, height: 900, name }; images.push(image); return image } } : undefined }
  mod.registerDesignTools(ctx, { runtime })
  const exec = { agent: { id: 's1', session: { id: 's1', requestHeader: () => ({ config: {provider:'current',model:'vision'} }) }, options: {provider:'old',model:'text'} }, signal: new AbortController().signal }
  return { runtime, repository, definitions, exec, images, routes, setModalities: v => { modalities = v }, async close() { await runtime.close(); await rm(root,{recursive:true,force:true}) } }
}
test('native design context is read only, returns source payload/schema/rules and rejects absent session identity', async () => {
  const fx = await fixture()
  try {
    const tool = fx.definitions.get('studio_get_layout_context')
    for (const exec of [{}, {agent:{}}, {agent:{id:'s1'}}, {agent:{id:'s1',session:{id:'s2'}}}]) await assert.rejects(tool.execute({pageId:'x'},exec), /Session/)
    const before = await readFile(fx.repository.controlPath, 'utf8')
    const result = await tool.execute({pageId:fx.repository.getState().pages[1].id}, fx.exec)
    assert.equal(result.rules.schemaVersion,'report-studio.design-rules.v2')
    assert.ok(result.sourceProjection.sources.some(row => row.payload.content))
    assert.ok(result.layoutSchema.properties.elements)
    assert.ok(result.layoutTemplate.layoutPageId)
    assert.equal(await readFile(fx.repository.controlPath,'utf8'),before)
    assert.equal([...fx.definitions.keys()].some(k => /start|accept/.test(k)),false)
    const imageTool=fx.definitions.get('studio_read_design_image')
    assert.ok(imageTool)
    const page=fx.repository.getState().pages[1]
    await assert.rejects(imageTool.execute({pageId:page.id},fx.exec),/布局|预览/)
    const asset=await ingestAsset({repository:fx.repository,pageId:page.id,mimeType:'image/png',originalFileName:'registered.png',request:Readable.from([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8wAAAABJRU5ErkJggg==','base64')])})
    const imageResult=await imageTool.execute({pageId:page.id,assetId:asset.assetId},fx.exec)
    assert.ok(imageTool.output.render({},imageResult).some(block=>block.type==='image'&&block.attachment.attachmentId))
    await assert.rejects(imageTool.execute({pageId:page.id,assetId:'foreign'},fx.exec),/素材/)
  } finally { await fx.close() }
})
test('unlinked manifest assets are discoverable and readable without changing page bindings', async () => {
  const fx=await fixture()
  try {
    const rows=[]
    for(const [ext,mimeType,mediaType,bytes] of [
      ['png','image/png','image',Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8wAAAABJRU5ErkJggg==','base64')],
      ['pdf','application/pdf','document',Buffer.from('%PDF-1.4\nfixture\n%%EOF')],
      ['mp4','video/mp4','video',Buffer.from('0000ftypisomfixture')],
      ['csv','text/csv','data',Buffer.from('name,value\narea,42\n')],
    ]) {
      const objectRef=await fx.repository.putBlob(Readable.from([bytes]),{mimeType,originalFileName:`unlinked.${ext}`})
      rows.push({id:createStudioId('asset'),ext,mimeType,mediaType,bytes,objectRef})
    }
    await fx.repository.transactContent({baseRevision:0,source:'human'},state=>{
      const archive=state.project.extensionPayload.standardArchive
      const seed=archive.documents['assets/manifest.json'].assets[0]
      for(const row of rows){
        const relativePath=`assets/images/${row.id}.${row.ext}`
        archive.documents['assets/manifest.json'].assets.push({...structuredClone(seed),assetId:row.id,displayName:`unlinked.${row.ext}`,relativePath,mimeType:row.mimeType,mediaType:row.mediaType,sizeBytes:row.objectRef.sizeBytes,sha256:row.objectRef.sha256,metadata:row.ext==='png'?{widthPx:1,heightPx:1}:{}})
        archive.files.push({relativePath,objectRef:structuredClone(row.objectRef),mimeType:row.mimeType,sizeBytes:row.objectRef.sizeBytes,sha256:row.objectRef.sha256})
      }
      return state
    })
    const before=await readFile(fx.repository.controlPath,'utf8')
    const pageId=fx.repository.getState().pages[1].id
    const context=await fx.definitions.get('studio_get_layout_context').execute({pageId},fx.exec)
    const imageTool=fx.definitions.get('studio_read_design_image')
    for(const row of rows){
      const matches=context.projectAssets.filter(asset=>asset.id===row.id)
      assert.equal(matches.length,1,`unlinked ${row.ext} must appear exactly once`)
      assert.equal(matches[0].previewAvailable,row.ext==='png')
      const url=new URL(matches[0].openUrl,'http://localhost')
      assert.equal(url.searchParams.get('sessionId'),'s1')
      assert.equal(url.pathname,`/report-studio/api/assets/${row.id}/content`)
      const chunks=[];const headers={}
      const response=new Writable({write(chunk,_encoding,done){chunks.push(Buffer.from(chunk));done()}})
      response.setHeader=(key,value)=>{headers[key]=value}
      const finished=once(response,'finish')
      await serveReferencedAsset({repository:fx.repository,assetId:row.id,response});await finished
      assert.deepEqual(Buffer.concat(chunks),row.bytes)
      assert.equal(headers['content-type'],row.mimeType)
      if(row.ext==='png'){
        const result=await imageTool.execute({pageId,assetId:row.id},fx.exec)
        assert.equal(imageTool.output.render({},result).find(block=>block.type==='image').attachment.bytes,row.bytes.length)
      }else{
        assert.match(matches[0].previewGap,/不计入视觉覆盖/)
        await assert.rejects(imageTool.execute({pageId,assetId:row.id},fx.exec),/图像预览/)
      }
    }
    await assert.rejects(serveReferencedAsset({repository:fx.repository,assetId:'unknown',response:{}}),/素材/)
    await assert.rejects(serveReferencedAsset({repository:await fx.runtime.repositoryFor('s2'),assetId:rows[0].id,response:{}}),/素材/)
    assert.equal(await readFile(fx.repository.controlPath,'utf8'),before,'reading must not bind assets or increment revision')
    const broken=fx.repository.getState()
    broken.project.extensionPayload.standardArchive.documents['assets/manifest.json'].assets.find(row=>row.assetId===rows[0].id).sha256='0'.repeat(64)
    await assert.rejects(serveReferencedAsset({repository:{getState:()=>broken,openBlob:()=>{throw new Error('must not open inconsistent reference')}},assetId:rows[0].id,response:{}}),/素材|一致/)
  } finally {await fx.close()}
})

test('preview gates the current native model and returns a real image block with validated attachment schema', async () => {
  const fx = await fixture()
  try {
    const pageId = fx.repository.getState().pages[1].id
    const service = await fx.runtime.designFor('s1')
    const run = await service.start({sessionId:'s1',pageIds:[pageId],expiresAt:new Date(Date.now()+60000).toISOString()})
    const context = await fx.definitions.get('studio_get_layout_context').execute({pageId}, fx.exec)
    const source = context.sourceProjection.sources.find(row => row.kind === 'text')
    const layout = addLiveLayoutElement(context.layoutTemplate,{type:'text',sourceRef:source.sourceRef,frame:{x:80,y:80,width:1300,height:200,rotation:0},style:{fontSize:36,textColor:'#222222'}})
    const args = {runId:run.runId,pageId,baseProjectRevision:0,baseLayoutRevision:null,baseLayoutSha:null,sourceStateHash:context.sourceStateHash,layout,sourceMapping:{},designIntent:'保留内容层级',idempotencyKey:'one'}
    const prepare = fx.definitions.get('studio_prepare_layout_candidate')
    await assert.rejects(prepare.execute({...args,allowApply:true},fx.exec), /权限|参数/)
    await assert.rejects(prepare.execute(args,{...fx.exec,agent:{...fx.exec.agent,id:'s2',session:{id:'s2'}}}), /范围|授权|不存在/)
    const candidate = await prepare.execute(args,fx.exec)
    const preview = fx.definitions.get('studio_render_layout_preview')
    for (const modalities of [undefined,[],['text']]) { fx.setModalities(modalities); await assert.rejects(preview.execute({candidateId:candidate.candidateId,candidateSha:candidate.candidateSha},fx.exec), /image|图像/); }
    assert.match(fx.repository.getState().layoutCandidates[0].lastError,/image|图像/)
    fx.setModalities(['image'])
    const result = await preview.execute({candidateId:candidate.candidateId,candidateSha:candidate.candidateSha},fx.exec)
    assert.deepEqual(fx.routes.at(-1).slice(0,2),['current','vision'])
    const blocks = preview.output.render({},result)
    assert.equal(blocks.find(block => block.type === 'image').attachment.attachmentId,fx.images[0].attachmentId)
    assert.ok(blocks.some(block => block.type === 'text'))
    assert.equal(new Ajv().validate(preview.output.schema,result),true)
    assert.ok(result.preview.fingerprint)
    assert.equal(JSON.stringify(result).includes('base64'),false)
    const reviewed=await fx.definitions.get('studio_submit_layout_review').execute({candidateId:candidate.candidateId,candidateSha:candidate.candidateSha,previewFingerprint:result.preview.fingerprint,observations:'已查看图像，正文位置与字号可读。'},fx.exec)
    assert.deepEqual(reviewed.validation.warnings,candidate.validation.warnings)
    await fx.runtime.acceptDesignProposal('s1',reviewed.id)
    const current=await fx.definitions.get('studio_read_design_image').execute({pageId},fx.exec)
    assert.equal(current.image.width,1600)
  } finally { await fx.close() }
})
test('native content proposal uses explicit design grant without annotation and ordinary accept cannot bypass Host',async()=>{
 const fx=await fixture()
 try{
  const service=await fx.runtime.designFor('s1');const pageId=fx.repository.getState().pages[1].id
  const run=await service.start({sessionId:'s1',pageIds:[pageId],expiresAt:new Date(Date.now()+60000).toISOString()})
  const tool=fx.definitions.get('studio_prepare_design_content');assert.ok(tool)
  const page=fx.repository.getState().pages[1]
  const result=await tool.execute({runId:run.runId,baseRevision:0,idempotencyKey:'plan',message:'保留来源和讲稿',commands:[{type:'page.design.plan',pageId,mainJudgment:'核心判断',displayedContentIds:page.contentBlocks.map(row=>row.contentBlockId),scriptOrAppendixContentIds:[],pendingGaps:[]}]},fx.exec)
  assert.equal(result.status,'pending')
  await assert.rejects(fx.runtime.acceptProposal('s1',result.proposal.id),/设计入口/)
  const accepted=await fx.runtime.acceptDesignProposal('s1',result.proposal.id);assert.equal(accepted.status,'accepted')
  const progress=await fx.runtime.designProgress('s1',run.runId);assert.ok(progress.content.proposals.some(row=>row.status==='accepted'))
 }finally{await fx.close()}
})

test('T05 native tools expose request-identity visual recovery without an approval step', async () => {
  const fx = await fixture()
  try {
    const generate = fx.definitions.get('studio_generate_design_visual')
    const adopt = fx.definitions.get('studio_adopt_design_visual')
    const resume = fx.definitions.get('studio_resume_design_visual')
    assert.ok(generate)
    assert.ok(adopt)
    assert.ok(resume)
    assert.doesNotMatch(generate.description, /批准|Proposal/)
    assert.doesNotMatch(adopt.description, /批准|Proposal/)
    assert.doesNotMatch(resume.description, /批准|Proposal/)
    assert.deepEqual(resume.parameters.required, ['runId', 'pageId', 'sourceStateHash', 'requestId'])
  } finally { await fx.close() }
})
