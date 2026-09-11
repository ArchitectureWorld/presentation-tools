import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRepository } from '../apps/studio-local/repository.mjs'
import { createLayoutService } from '../apps/studio-local/layout-service.mjs'
import { readStandardProject } from '../packages/studio-standard-adapter/index.mjs'
import { createLayoutPage, addLiveLayoutElement } from '../packages/studio-layout-core/index.mjs'
import * as module from '../apps/studio-local/design-service.mjs'
const standard = new URL('../contracts/presentation-standard-project/examples/unformatted-project/project_01992a80-0000-7000-8000-000000000101-campus-renewal-brief/', import.meta.url)
export async function renderCandidate(fx, candidate) {
  const { createLayoutPreviewRenderer } = await import('../apps/studio-local/layout-preview.mjs')
  const input = await fx.service.previewInput({ sessionId: fx.sessionId, ...candidate })
  return createLayoutPreviewRenderer({ browserExecutable: process.env.STUDIO_PREVIEW_BROWSER_EXECUTABLE }).render({
    ...input, candidateSha: candidate.candidateSha,
    readAsset: async ref => Buffer.concat(await Array.fromAsync(await fx.repository.openBlob(ref))),
  })
}
export async function fixture(options = {}) {
  assert.equal(typeof module.createDesignService, 'function', 'guarded design service must exist')
  const root = await mkdtemp(join(tmpdir(), 'studio-design-'))
  let repository = await createRepository(join(root, 'repository'), options)
  const imported = await readStandardProject(standard, { putBlob: repository.putBlob })
  await repository.initializeFromStandardProject({ snapshot: imported.snapshot })
  let layoutService = createLayoutService({ repository, layoutRoot: join(root, 'layouts'), faultInjector: options.layoutFaultInjector })
  let time = Date.parse('2026-09-06T00:00:00Z')
  let service = module.createDesignService({ repository, layoutService, now: () => new Date(time).toISOString() })
  const pageId = repository.getState().pages[1].id
  const sessionId = 'host-session'
  const fx = {
    root, get repository() { return repository }, get service() { return service }, get layoutService() { return layoutService }, pageId, sessionId,
    expire() { time += 120_000 },
    async start(extra = {}) { return service.start({ sessionId, pageIds: [pageId], protectedPageIds: [repository.getState().pages[0].id], allowApply: false, allowVisualGeneration: false, expiresAt: '2026-09-06T00:01:00Z', ...extra }) },
    async input(run, extra = {}) {
      const ctx = await service.context({ sessionId, pageId })
      const source = ctx.sourceProjection.sources.find(row => row.kind === 'text')
      const layout = ctx.layout ?? addLiveLayoutElement(createLayoutPage({ projectId: ctx.projectId, pageId, baseDraftRevision: ctx.baseProjectRevision }), {
        type: 'text', sourceRef: source.sourceRef, frame: { x: 80, y: 80, width: 1200, height: 180, rotation: 0 }, style: { fontSize: 36, textColor: '#222222' },
      })
      return { sessionId, runId: run.runId, pageId, baseProjectRevision: ctx.baseProjectRevision, baseLayoutRevision: ctx.baseLayoutRevision,
        baseLayoutSha: ctx.baseLayoutSha, sourceStateHash: ctx.sourceStateHash, layout, designIntent: '整理本页信息层级', sourceMapping: {}, idempotencyKey: 'first', ...extra }
    },
    async reopen() { await repository.close(); repository = await createRepository(join(root, 'repository')); layoutService = createLayoutService({ repository, layoutRoot: join(root, 'layouts') }); service = module.createDesignService({ repository, layoutService, now: () => new Date(time).toISOString() }) },
    async close() { await repository.close(); await rm(root, { recursive: true, force: true }) },
  }
  return fx
}

export async function inputForPage(fx,run,pageId,extra={}) {
 const ctx=await fx.service.context({sessionId:fx.sessionId,pageId})
 const source=ctx.sourceProjection.sources.find(s=>s.payload?.role==='page_title')??ctx.sourceProjection.sources.find(s=>s.kind==='text')
 const layout=ctx.layout??addLiveLayoutElement(createLayoutPage({projectId:ctx.projectId,pageId,baseDraftRevision:ctx.baseProjectRevision}),{type:'text',sourceRef:source.sourceRef,frame:{x:80,y:80,width:1200,height:180,rotation:0},style:{fontSize:36,textColor:'#222222'}})
 return {sessionId:fx.sessionId,runId:run.runId,pageId,layout,baseProjectRevision:ctx.baseProjectRevision,baseLayoutRevision:ctx.baseLayoutRevision,baseLayoutSha:ctx.baseLayoutSha,sourceStateHash:ctx.sourceStateHash,sourceMapping:{},designIntent:'fixture technical verification only',idempotencyKey:`${pageId}-0`,...extra}
}
export async function applyCandidate(fx,candidate,observations='Checked actual fixture preview') {
 const preview=await renderCandidate(fx,candidate)
 await fx.service.recordPreview({sessionId:fx.sessionId,...candidate,preview})
 return fx.service.submitReview({sessionId:fx.sessionId,...candidate,previewFingerprint:preview.fingerprint,observations})
}
