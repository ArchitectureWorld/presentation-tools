import { DESIGN_INTENT_SCHEMA } from '../../packages/studio-layout-core/design-intent.mjs'
import { getDesignRules } from './design-rules.mjs'
import { createLayoutPage } from '../../packages/studio-layout-core/index.mjs'
import { PREVIEW_CHECKS_VERSION } from '../../packages/studio-layout-core/preview-fingerprint.mjs'
const frame = {type:'object',required:['x','y','width','height','rotation'],properties:Object.fromEntries(['x','y','width','height','rotation'].map(key=>[key,{type:'number'}]))}
export function designContextResource(context) {
  return {...context,designIntentSchema:structuredClone(DESIGN_INTENT_SCHEMA),rules:getDesignRules(),checksVersion:PREVIEW_CHECKS_VERSION,
    layoutTemplate:context.layout ?? createLayoutPage({projectId:context.projectId,pageId:context.pageId,baseDraftRevision:context.baseProjectRevision}),
    layoutSchema:{type:'object',properties:{elements:{type:'array',items:{type:'object',required:['layoutElementId','type','frame','style','zIndex','syncPolicy','elementState','lastSyncedSourceRevision'],properties:{layoutElementId:{type:'string'},type:{enum:['text','image','shape','group']},frame,style:{type:'object'},zIndex:{type:'integer'},syncPolicy:{enum:['live','detached']},elementState:{enum:['normal','orphaned']},lastSyncedSourceRevision:{type:['integer','null']},sourceRef:{type:'object',description:'live only: use exact sourceProjection.sources[].sourceRef'},localPayload:{type:'object',description:'detached only: real text/image payload; sourceMapping required for nondecorative content'},parentLayoutElementId:{type:['string','null']}}}}}},
    sourceMappingContract:'{ [layoutElementId]: [sourceProjection.sources[].key] }; live elements use sourceRef, detached text/groups/nondecorative shape labels require mapping',
  }
}
