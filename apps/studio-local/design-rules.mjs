// Compatibility accessor: strategy and aesthetics now live in Pre-design's Skill.
// This resource describes only the editor's execution and integrity constraints.
function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze)
    Object.freeze(value)
  }
  return value
}
const TOOL_CONSTRAINTS = deepFreeze({
  schemaVersion: 'report-studio.design-rules.v2',
  kind: 'report-studio.tool-constraints',
  owner: 'presentation-tools',
  strategyOwner: 'pre-design',
  host: 'dsh',
  execution: {
    mode: 'task_scoped_direct_apply',
    proposalApprovalRequired: false,
    preserveProtectedPages: true,
    compareAndSwapRequired: true,
    sourceReferencesRequired: true,
    persistedRevisionRequiredForSuccess: true,
  },
  preview: { actualImageRequired: true, agentCannotReportHostChecks: true, externalResourcesAllowed: false },
  assets: { registeredBeforeUse: true, verifyHash: true, provenance: 'internal', automaticVisibleOriginLabel: false },
  manualEditingAvailableWithoutPre: true,
})
export function getDesignRules() { return TOOL_CONSTRAINTS }
