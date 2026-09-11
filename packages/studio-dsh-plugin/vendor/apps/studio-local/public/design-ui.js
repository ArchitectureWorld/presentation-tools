const escape=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]))
let mounted
export function mountDesignUI(){
 if(mounted)return mounted
 let state=null,runId=null,scopeKey=null,timer=null,batchId=null
 const dialog=document.createElement('dialog');dialog.id='design-panel';dialog.style.cssText='width:min(860px,92vw);max-height:85vh;overflow:auto;background:#151923;color:#edf0f5;border:1px solid #586079;border-radius:14px;padding:24px'
 dialog.innerHTML='<form method="dialog"><button style="float:right" aria-label="关闭设计面板">关闭</button></form><h2>设计汇报</h2><p>选择需要整理的页面和保护页，再交给当前 DSH 会话设计。</p><div id="design-scope"></div><p>提交本轮要求后直接修改并保存；历史候选不会自动应用。</p><p><label><input id="design-visual" type="checkbox"> 允许为所选页面补充 AI 概念图</label></p><label for="design-instruction">设计要求</label><textarea id="design-instruction" rows="3" style="display:block;width:100%" placeholder="说明这次汇报的受众、重点与需要调整的内容"></textarea><p><button id="design-start" type="button">开始设计</button></p><p id="design-status" role="status"></p><div id="design-batch-summary" role="status"></div><p><button id="design-resume" type="button">继续原任务</button> <button id="design-cancel" type="button">停止任务</button> <button id="design-export" type="button">导出已检查版本</button></p><div id="design-deliveries"></div><div id="design-progress"></div>'
 document.body.append(dialog)
 const query=selector=>dialog.querySelector(selector)
 function endpoint(path){const prefix=location.pathname.startsWith('/report-studio')?'/report-studio':'';const url=new URL(`${prefix}/api${path}`,location.origin);const sessionId=new URLSearchParams(location.search).get('sessionId');if(sessionId)url.searchParams.set('sessionId',sessionId);return url.pathname+url.search}
 async function request(path,body){const response=await fetch(endpoint(path),body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{});const result=await response.json();if(!response.ok)throw new Error(result.error?.message??result.error??'设计请求失败');return result}
 function render(){
  if(!state)return
  const nextKey=JSON.stringify(state.pages.map(page=>page.id));if(scopeKey!==nextKey){scopeKey=nextKey;query('#design-scope').innerHTML=state.pages.map(page=>`<div style="display:flex;gap:16px;margin:8px 0"><label><input type="checkbox" data-design-page="${escape(page.id)}" ${page.id===state.ui?.activePageId?'checked':''}> ${escape(page.heading||page.title||page.id)}</label><label><input type="checkbox" data-design-protect="${escape(page.id)}"> 保护此页</label></div>`).join('')}
  if(!runId)runId=state.designRuns?.at(-1)?.runId??null
  const batch=(state.designBatches??[]).find(b=>b.batchId===batchId)??(state.designBatches??[]).filter(b=>b.runId===runId).at(-1)
  if(batch)batchId=batch.batchId
  const statuses={active:'处理中',completed:'已完成',completed_with_locked_pages:'已完成可自动处理部分',needs_human:'需人工查看',blocked_external:'需人工查看',cancelled:'已停止'}
  query('#design-batch-summary').innerHTML=batch?`<strong>${escape(statuses[batch.status]??batch.status)}</strong><p>已验证保存 ${(batch.pages??[]).filter(p=>p.status==='completed').length} / ${(batch.pages??[]).length} 页；锁定跳过 ${(batch.pages??[]).filter(p=>p.status==='skipped_locked').length} 页</p>${(batch.pages??[]).filter(p=>p.status==='needs_human').map(p=>`<p>${escape(state.pages.find(page=>page.id===p.pageId)?.heading??p.pageId)}：${escape(p.reason)} <button data-batch-retry="${escape(p.pageId)}" type="button">重试此页</button></p>`).join('')}`:''
  query('#design-resume').disabled=!batch||batch.status==='cancelled'
  query('#design-cancel').disabled=!batch||batch.status==='cancelled'
  const lastError=state.designRuns?.find(run=>run.runId===runId)?.lastError
  if(lastError)query('#design-status').textContent=`需要处理：${lastError}`
  const proposals=(state.proposals??[]).filter(row=>row.runId===runId).map(row=>({...row,scopeConfirmationRequired:row.scopeConfirmationRequired||(row.status==='accepted'&&row.newPageIds?.length>0&&!row.scopeInherited)}))
  const candidates=(state.layoutCandidates??[]).filter(row=>row.runId===runId)
  const label={pending:'历史候选（只读）',applying:'正在保存',ready:'图片已生成',failed:'执行失败，可重新提交',link_failed:'挂接失败，可重试',approved:'已批准，等待登记素材',accepted:'已保存',stale:'版本冲突，需重新设计',needs_review:'需要人工处理',needs_revision:'需要返修',previewed:'预览已完成',candidate:'候选已创建',applied:'已保存'}
  query('#design-progress').innerHTML=(batch?'<details><summary>查看运行记录</summary>':'')+proposals.map(row=>`<article style="border-top:1px solid #586079;padding:12px 0"><strong>${escape(label[row.status]??row.status)}</strong><p>${escape(row.message??(typeof row.designIntent==='object'?row.designIntent.coreJudgment:row.designIntent)??'')}</p>${row.preview||row.kind==='design.visual.v1'?`<img style="width:100%;height:auto" alt="候选真实预览" src="${escape(endpoint(`/design/image?proposalId=${encodeURIComponent(row.id)}`))}">`:''}<pre style="white-space:pre-wrap">${escape(JSON.stringify(row.preview?.checks??row.pendingGaps??{},null,2))}</pre>${row.scopeConfirmationRequired?'<p>新页面需要重新选择范围并开始设计。</p>':''}</article>`).join('')+candidates.filter(row=>!row.proposalId).map(row=>`<p>${escape(row.pageId)} · ${escape(label[row.status]??row.status)}</p><pre style="white-space:pre-wrap">${escape(JSON.stringify({validation:row.validation,checks:row.preview?.checks},null,2))}</pre>${row.preview?`<img style="width:100%" alt="候选真实预览" src="${escape(endpoint(`/design/image?candidateId=${encodeURIComponent(row.candidateId)}`))}">`:''}`).join('')+(batch?'</details>':'')
 }
 async function refresh(){try{state=await request('/state');render();window.reportStudioApplyExternalState?.(state)}catch(error){query('#design-status').textContent=error.message}}
 async function sendPrompt(result){if(result.dshPrompt){if(!window.reportStudioRequestPrompt)throw new Error('请在 DSH 会话内打开 Report Studio 后提交设计。');await window.reportStudioRequestPrompt(result.dshPrompt)}}
 document.querySelector('#design-open')?.addEventListener('click',()=>{render();dialog.showModal();if(runId&&!timer)timer=setInterval(refresh,2000)})
 dialog.addEventListener('close',()=>{clearInterval(timer);timer=null})
 query('#design-start').addEventListener('click',async()=>{const button=query('#design-start');button.disabled=true;try{
  const result=await request('/design/start',{pageIds:[...dialog.querySelectorAll('[data-design-page]:checked')].map(node=>node.dataset.designPage),protectedPageIds:[...dialog.querySelectorAll('[data-design-protect]:checked')].map(node=>node.dataset.designProtect),allowVisualGeneration:query('#design-visual').checked,instruction:query('#design-instruction').value})
  runId=result.run.runId;batchId=result.batch?.batchId??null;await sendPrompt(result);query('#design-status').textContent='已交给当前 DSH 会话的 Pre Skill，检查后直接保存。';if(!timer)timer=setInterval(refresh,2000)
 }catch(error){query('#design-status').textContent=`设计未启动：${error.message}`}finally{button.disabled=false}})


 async function control(operation,extra={}){
  if(!batchId)return
  try{const result=await request(`/production/${operation}`,{batchId,...extra});await sendPrompt(result);query('#design-status').textContent=result.batch?.reason??(operation==='cancel'?'已停止任务':'已继续原任务');await refresh()}
  catch(error){query('#design-status').textContent=error.message}
 }
 query('#design-resume').addEventListener('click',()=>control('resume'))
 query('#design-cancel').addEventListener('click',()=>control('cancel'))
 dialog.addEventListener('click',event=>{const retry=event.target.closest('[data-batch-retry]');if(retry)void control('retry',{pageId:retry.dataset.batchRetry})})
 query('#design-export').addEventListener('click',async()=>{
  const button=query('#design-export');button.disabled=true
  try{const result=await request('/production/export',{formats:['html','pdf','pptx']});query('#design-deliveries').innerHTML=`<p>已检查版本 ${Number(result.revision)} · 图像式交付；PPTX不含可编辑文字对象，源文件供Studio继续编辑。</p>`+[...result.files.map(f=>f.name),'manifest.json'].map(name=>`<a style="margin-right:12px" download="${escape(name)}" href="${escape(endpoint(`/delivery/file?deliveryId=${encodeURIComponent(result.deliveryId)}&name=${encodeURIComponent(name)}`))}">${escape(name)}</a>`).join('')}
  catch(error){query('#design-status').textContent=error.message}finally{button.disabled=false}
 })

 window.reportStudioDesignSync=next=>{state=next;render()}
 window.addEventListener('report-studio-state',event=>window.reportStudioDesignSync(event.detail))
 mounted={dialog};return mounted
}
if(typeof document!=='undefined'&&document.querySelector('#design-open'))mountDesignUI()
