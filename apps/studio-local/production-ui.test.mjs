import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {chromium} from 'playwright-core'
test('real browser shows a single batch summary, resume/cancel and local exception retry without approvals',async()=>{
 const browser=await chromium.launch({executablePath:process.env.STUDIO_PREVIEW_BROWSER_EXECUTABLE??'/usr/bin/chromium',headless:true});try{
  const page=await browser.newPage();await page.setContent('<button id="design-open">设计汇报</button>')
  const source=await readFile(new URL('./public/design-ui.js',import.meta.url),'utf8');await page.addScriptTag({content:source.replace('export function mountDesignUI','function mountDesignUI')})
  await page.evaluate(()=>{window.reportStudioRequestPrompt=async()=>{};window.reportStudioDesignSync({project:{id:'p',currentRevision:1},pages:[{id:'a',heading:'页A'},{id:'b',heading:'页B'}],ui:{activePageId:'a'},designRuns:[{runId:'r'}],designBatches:[{batchId:'batch',runId:'r',status:'needs_human',pages:[{pageId:'a',status:'completed'},{pageId:'b',status:'needs_human',reason:'missing image'}]}]})})
  await page.locator('#design-open').click();assert.match(await page.locator('#design-batch-summary').innerText(),/1.*2/s);assert.match(await page.locator('#design-batch-summary').innerText(),/需人工查看/)
  assert.equal(await page.locator('#design-resume').count(),1);assert.equal(await page.locator('#design-cancel').count(),1);assert.equal(await page.locator('[data-batch-retry]').count(),1)
  assert.equal(await page.locator('[data-design-accept]').count(),0)
  await page.locator('dialog form button').click()
 }finally{await browser.close()}
})
