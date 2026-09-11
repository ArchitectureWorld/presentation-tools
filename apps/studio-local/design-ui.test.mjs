import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {readFile,access} from 'node:fs/promises'
import {chromium} from 'playwright-core'
test('design panel opening is passive and explicit start preserves old input and sends selected protected scope',async()=>{
 const source=await readFile(new URL('./public/design-ui.js',import.meta.url),'utf8').catch(()=>null)
 assert.ok(source,'design panel implementation must exist')
 const requests=[];const state={project:{id:'project',currentRevision:0},ui:{activePageId:'p1'},pages:[{id:'p1',heading:'第一页面'},{id:'p2',heading:'第二页面'}],designRuns:[]}
 const server=createServer((req,res)=>{res.setHeader('content-type',req.url==='/design-ui.js'?'text/javascript; charset=utf-8':'text/html; charset=utf-8');res.end(req.url==='/design-ui.js'?source:'<button id="design-open">设计汇报</button><textarea id="agent-input">原来的未提交输入</textarea><script type="module">import {mountDesignUI} from "/design-ui.js";window.panel=mountDesignUI();</script>')});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 let browser
 try{
  const candidates=[process.env.STUDIO_PREVIEW_BROWSER_EXECUTABLE,...(process.platform==='win32'?['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe']:process.platform==='darwin'?['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']:['/usr/bin/google-chrome','/usr/bin/chromium'])].filter(Boolean)
  let executablePath
  for(const path of candidates){try{await access(path);executablePath=path;break}catch{}}
  assert.ok(executablePath,'Real browser is required; configure STUDIO_PREVIEW_BROWSER_EXECUTABLE')
  browser=await chromium.launch({executablePath,headless:true})
  const page=await browser.newPage();await page.route('**/api/**',async route=>{requests.push({url:route.request().url(),body:route.request().postDataJSON()});await route.fulfill({json:route.request().url().includes('/start')?{run:{runId:'run',pageIds:['p1']},dshPrompt:{kind:'report_studio.design',text:'设计指令'}}:state})})
  await page.goto(`http://127.0.0.1:${server.address().port}/?sessionId=s1`)
  await page.evaluate(state=>{window.reportStudioDesignSync(state);window.reportStudioRequestPrompt=async prompt=>{window.sent=prompt}},state)
  await page.locator('#design-open').click();assert.equal(requests.length,0)
  await page.locator('[data-design-protect="p2"]').check();await page.locator('#design-instruction').fill('整理当前汇报');await page.locator('#design-start').click()
  await page.waitForFunction(()=>window.sent?.text==='设计指令')
  assert.equal(requests[0].body.protectedPageIds[0],'p2');assert.deepEqual(requests[0].body.pageIds,['p1'])
  assert.equal(await page.locator('#agent-input').inputValue(),'原来的未提交输入')
  await page.evaluate(()=>window.reportStudioDesignSync({project:{currentRevision:1},pages:[{id:'p1',heading:'页'}],designRuns:[],proposals:[{id:'proposal',kind:'layout',runId:'run',status:'pending',pageId:'p1',preview:{checks:{warnings:[{code:'font_warning'}],blockers:[]}}}]}))
  assert.match(await page.locator('#design-progress').innerText(),/font_warning/)
  assert.equal(await page.locator('[data-design-accept="proposal"]').count(),0)
  assert.equal(await page.locator('#design-auto').count(),0)
  assert.equal(Object.hasOwn(requests[0].body,'allowApply'),false)
  const persisted={project:{currentRevision:2},pages:[{id:'new-page',heading:'新语义页'}],designRuns:[{runId:'run'}],proposals:[{id:'content-proposal',kind:'design.content.v1',runId:'run',status:'accepted',scopeInherited:true,newPageIds:['new-page']}]}
  await page.reload()
  await page.evaluate(state=>window.reportStudioDesignSync(state),persisted)
  await page.locator('#design-open').click()
  assert.doesNotMatch(await page.locator('#design-progress').innerText(),/新页面需要重新选择范围/)
  await page.getByRole('button',{name:'关闭设计面板'}).click()
  await page.locator('#design-open').click()
  assert.doesNotMatch(await page.locator('#design-progress').innerText(),/新页面需要重新选择范围/)
 }finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
})
