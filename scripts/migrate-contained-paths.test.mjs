import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { migrateStandardAssetReferences } from './migrate-standard-asset-references.mjs'
async function fixture(t, paths) {
  const root = await mkdtemp(join(tmpdir(), 'studio-migration-path-')); t.after(() => rm(root, { recursive:true, force:true }))
  await mkdir(join(root,'assets')); await mkdir(join(root,'pages','drafts'), {recursive:true})
  await writeFile(join(root,'project.json'), JSON.stringify({projectId:'project-test'}))
  await writeFile(join(root,'assets','manifest.json'), '{"assets":[]}')
  await writeFile(join(root,'pages','manifest.json'), JSON.stringify({pages:paths.map((draftPath,i)=>({pageId:`page-${i}`,draftPath}))}))
  await writeFile(join(root,'pages','drafts','a.json'), JSON.stringify({pageId:'page-0',pageAssets:[],scriptBlocks:[]}))
  return root
}
test('migration reads portable Windows separators on every platform', async t => {
  const root = await fixture(t,['pages\\drafts\\a.json'])
  assert.equal((await migrateStandardAssetReferences({root})).migratedPages,1)
})
for (const bad of ['../outside.json','/tmp/outside.json','C:\\outside.json','pages/../outside.json','pages//drafts/a.json','pages/drafts/a.json\0']) {
 test(`migration rejects unsafe managed path ${JSON.stringify(bad)} before changing any file`, async t => {
  const root = await fixture(t,['pages/drafts/a.json',bad]); const path=join(root,'pages','drafts','a.json'); const before=await readFile(path)
  await assert.rejects(migrateStandardAssetReferences({root}),{code:'migration_invalid_path'})
  assert.deepEqual(await readFile(path),before)
 })
}
test('migration preflights every draft before writing the first one',async t=>{
 const root=await fixture(t,['pages/drafts/a.json','pages/drafts/missing.json']);const path=join(root,'pages','drafts','a.json');const before=await readFile(path)
 await assert.rejects(migrateStandardAssetReferences({root}));assert.deepEqual(await readFile(path),before)
})
test('migration refuses a linked draft file',async t=>{
 const root=await fixture(t,['pages/drafts/link.json']); await symlink(join(root,'pages','drafts','a.json'),join(root,'pages','drafts','link.json'))
 await assert.rejects(migrateStandardAssetReferences({root}),{code:'migration_invalid_path'})
})
