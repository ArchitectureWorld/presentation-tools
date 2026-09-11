import test from 'node:test'
import assert from 'node:assert/strict'
import {getDesignRules} from './design-rules.mjs'

function assertDeepFrozen(value) {
  if (!value || typeof value !== 'object') return
  assert.equal(Object.isFrozen(value), true)
  Object.values(value).forEach(assertDeepFrozen)
}
test('compatibility accessor exposes immutable serializable neutral tool constraints',()=>{
  const rules=getDesignRules()
  assert.equal(getDesignRules.length,0)
  assert.equal(rules.schemaVersion,'report-studio.design-rules.v2')
  assert.equal(rules.kind,'report-studio.tool-constraints')
  assertDeepFrozen(rules)
  assert.deepEqual(JSON.parse(JSON.stringify(rules)),rules)
})
test('Pre owns design reasoning and Studio does not embed page strategy or aesthetics',()=>{
  const rules=getDesignRules()
  assert.equal(rules.owner,'presentation-tools')
  assert.equal(rules.strategyOwner,'pre-design')
  assert.equal(rules.host,'dsh')
  assert.equal(rules.concerns,undefined)
  assert.doesNotMatch(JSON.stringify(rules),/skeletonSelection|evidencePriority|pagePlanning|fixedTotalPages/)
  assert.equal(rules.manualEditingAvailableWithoutPre,true)
})
test('user-task direct execution retains scope CAS provenance and real preview without approval',()=>{
  const rules=getDesignRules()
  assert.equal(rules.execution.mode,'task_scoped_direct_apply')
  assert.equal(rules.execution.proposalApprovalRequired,false)
  for(const key of ['preserveProtectedPages','compareAndSwapRequired','sourceReferencesRequired','persistedRevisionRequiredForSuccess'])assert.equal(rules.execution[key],true)
  assert.equal(rules.preview.actualImageRequired,true)
  assert.equal(rules.preview.agentCannotReportHostChecks,true)
  assert.equal(rules.preview.externalResourcesAllowed,false)
  assert.equal(rules.assets.provenance,'internal')
  assert.equal(rules.assets.automaticVisibleOriginLabel,false)
  assert.equal(rules.assets.verifyHash,true)
})
