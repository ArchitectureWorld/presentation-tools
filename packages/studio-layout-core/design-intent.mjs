/** Versioned instructions from Pre-design. Studio validates references, not design choices. */
export const DESIGN_INTENT_VERSION = '1.0.0'
const string = maxLength => ({ type:'string', minLength:1, maxLength })
const keys = {type:'array', maxItems:500, uniqueItems:true, items:string(300)}
export const DESIGN_INTENT_SCHEMA = Object.freeze({
  type:'object', additionalProperties:false,
  required:['schemaVersion','pageId','coreJudgment','evidence','readingOrder','hierarchy','visualRole','constraints'],
  properties:{
    schemaVersion:{const:DESIGN_INTENT_VERSION},pageId:string(200),coreJudgment:string(4000),
    evidence:keys,readingOrder:keys,visualRole:string(120),preferredSkeleton:string(120),
    hierarchy:{type:'array',maxItems:500,items:{type:'object',additionalProperties:false,required:['sourceKey','level'],properties:{sourceKey:string(300),level:{type:'integer',minimum:1,maximum:3}}}},
    constraints:{type:'object',additionalProperties:false,properties:{safeMargin:{type:'number',minimum:0,maximum:200},minGap:{type:'number',minimum:0,maximum:100},maxCropFraction:{type:'number',minimum:0,maximum:1}}},
  },
})
function invalid(message) { throw Object.assign(new Error(message),{code:'design_intent_invalid',status:400}) }
function object(value, allowed, required = allowed) {
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value)!==Object.prototype || Object.keys(value).some(k=>!allowed.includes(k)) || required.some(k=>!Object.hasOwn(value,k))) invalid('设计意图字段不完整或包含未知字段。')
}
function text(value,max) { if(typeof value!=='string'||!value.trim()||value.length>max)invalid('设计意图文本无效或超长。') }
export function validateDesignIntent({intent,pageId,sourceKeys=[]}) {
  if(typeof intent==='string'){text(intent,4000);return intent}
  object(intent,Object.keys(DESIGN_INTENT_SCHEMA.properties),DESIGN_INTENT_SCHEMA.required)
  if(intent.schemaVersion!==DESIGN_INTENT_VERSION||intent.pageId!==pageId)invalid('设计意图版本或页面不匹配。')
  text(intent.pageId,200);text(intent.coreJudgment,4000);text(intent.visualRole,120)
  if(Object.hasOwn(intent,'preferredSkeleton'))text(intent.preferredSkeleton,120)
  const known=new Set(sourceKeys)
  const references = rows => {
    if(!Array.isArray(rows)||rows.length>500||new Set(rows).size!==rows.length)invalid('设计意图引用重复或超出数量限制。')
    for(const key of rows){text(key,300);if(!known.has(key))invalid('设计意图引用了当前页不存在的来源。')}
  }
  references(intent.evidence);references(intent.readingOrder)
  if(!Array.isArray(intent.hierarchy)||intent.hierarchy.length>500)invalid('设计层级无效。')
  for(const row of intent.hierarchy){object(row,['sourceKey','level']);if(!Number.isInteger(row.level)||row.level<1||row.level>3)invalid('设计层级须为1至3。')}
  references(intent.hierarchy.map(row=>row.sourceKey))
  object(intent.constraints,['safeMargin','minGap','maxCropFraction'],[])
  for(const [key,value] of Object.entries(intent.constraints))if(!Number.isFinite(value)||value<0||value>({safeMargin:200,minGap:100,maxCropFraction:1})[key])invalid('设计约束数值无效。')
  return structuredClone(intent)
}
